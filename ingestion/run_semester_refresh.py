"""Refresh USC course data for one or more terms, and probe for newly live terms.

    cd ingestion
    python run_semester_refresh.py probe
    python run_semester_refresh.py refresh --terms 20263,20271
    python run_semester_refresh.py refresh --no-db          # scrape + guards only
    python run_semester_refresh.py refresh --only CSCI --skip-profs   # cheap smoke run, never prunes

`refresh` runs, for each term: Stage 1 (scrape_programs) → Stage 2
(scrape_sections) → a shrink guard → load_courses.py --prune → move the term's
`latest` link. Then load_profs.py once over every loaded catalog. `probe` asks
USC which terms are live (one request) and reports a term the first time it
appears. Neither ever changes SEMESTER or restarts anything: switching the live
term stays a deliberate manual step.

Terms come from --terms, else $ACTIVE_SEMESTERS (comma list), else $SEMESTER.
Only terms USC lists as Active are refreshed (archived terms lose sections, and
the load prunes), unless --allow-inactive.

Exit codes (cron alerts on non-zero):
    0  everything succeeded
    1  a term or the profs step failed (other terms may have loaded; see the summary)
    2  configuration or preflight error; nothing ran
    3  another run holds the lock

Output lives under --runs-dir (default $REFRESH_RUNS_DIR, else ingestion/runs/):
    state.json                  probe state (Active terms seen before)
    logs/<stamp>.log            every step's output for one invocation
    logs/<stamp>.json           the run summary
    <term>/<stamp>/             programs_<term>.json, usc_<term>_courses.json, its .summary.json
    <term>/latest -> <stamp>    the last snapshot that loaded (or passed the guards, with --no-db)
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.scrapers.scrape_programs import write_json_atomically
from app.scrapers.usc_api import UscApi, UscApiError, normalize_term

INGESTION_DIR = Path(__file__).resolve().parent
RMP_CLI = INGESTION_DIR.parent / "rate_my_prof" / "dist" / "prof_lookup_cli.js"
DEFAULT_RUNS_DIR = INGESTION_DIR / "runs"

EXIT_OK, EXIT_FAILED, EXIT_CONFIG, EXIT_LOCKED = 0, 1, 2, 3
KEEP_RUNS_PER_TERM = 8
SHRINK_LIMIT = 0.95  # a new catalog with < 95% of the last good snapshot's sections isn't loaded (user, 2026-11-13)
TIMEOUTS = {  # seconds; a hung step must not hold the lock forever
    "programs": 5 * 60,
    "sections": 60 * 60,
    "load_courses": 30 * 60,
    "load_profs": 8 * 60 * 60,
}
STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_STAMP = re.compile(r"^\d{8}T\d{6}Z$")


# ─── configuration ───────────────────────────────────────────────────────────

def parse_terms(value: str) -> list[str]:
    """'20263, 20271' → ['20263', '20271']: validated, deduplicated, order kept."""
    terms = [normalize_term(t) for t in value.split(",") if t.strip()]
    if not terms:
        raise ValueError(f"no term codes in {value!r}")
    return list(dict.fromkeys(terms))


def configured_terms(arg: str | None, env) -> tuple[list[str], str]:
    """The terms to work on and where they came from. Never falls back to a hardcoded term."""
    for source, value in (("--terms", arg), ("ACTIVE_SEMESTERS", env.get("ACTIVE_SEMESTERS")),
                          ("SEMESTER", env.get("SEMESTER"))):
        if value and value.strip():
            return parse_terms(value), source
    raise ValueError("no terms configured: pass --terms, or set ACTIVE_SEMESTERS or SEMESTER")


def preflight(no_db: bool, skip_profs: bool, env, which=None, rmp_cli: Path | None = None) -> list[str]:
    """Problems that would make the run fail later. Checked before any request is made."""
    which = which or shutil.which
    rmp_cli = rmp_cli or RMP_CLI
    problems = []
    if not no_db:
        missing = [v for v in ("USC_DB_USER", "USC_DB_PASSWORD") if not env.get(v)]
        if missing:
            problems.append(f"missing {', '.join(missing)} (the loaders read the DB target from the environment)")
        if not skip_profs:
            if not which("node"):
                problems.append("`node` is not on PATH (load_profs.py runs the RateMyProfessors CLI); "
                                "or pass --skip-profs")
            if not rmp_cli.exists():
                problems.append(f"{rmp_cli} is missing: run `npm ci && npm run build` in rate_my_prof/ "
                                "(dist/ is gitignored); or pass --skip-profs")
    return problems


# ─── probe ───────────────────────────────────────────────────────────────────

def load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def probe(active: list[str], state: dict, configured: list[str], now: datetime) -> tuple[dict, dict]:
    """Compare USC's Active terms with what we've seen before. Returns (new state, result).

    A term is reported as new only the first time it's seen. The very first probe
    (no state yet) seeds the state without reporting anything as new.
    """
    seen = dict(state.get("seen_active") or {})
    initial = not state
    new_terms = [] if initial else [t for t in active if t not in seen]
    today = now.date().isoformat()
    for t in active:
        seen.setdefault(t, today)
    result = {
        "active": active,
        "initial": initial,
        "new_terms": new_terms,
        "no_longer_active": [t for t in state.get("last_active") or [] if t not in active],
        "active_not_configured": [t for t in active if t not in configured],
        "configured_not_active": [t for t in configured if t not in active],
    }
    new_state = {"seen_active": dict(sorted(seen.items())), "last_active": active,
                 "last_probe": now.isoformat(timespec="seconds")}
    return new_state, result


def run_probe(api, runs_dir: Path, configured: list[str], now: datetime) -> dict:
    """One request to /api/Terms/Active; saves state.json. Raises UscApiError."""
    state_path = runs_dir / "state.json"
    new_state, result = probe(api.active_terms(), load_state(state_path), configured, now)
    write_json_atomically(state_path, new_state)
    return result


def describe_probe(result: dict) -> list[str]:
    lines = [f"USC Active terms: {', '.join(result['active']) or '(none)'}"
             + (" (first probe: state seeded)" if result["initial"] else "")]
    if result["new_terms"]:
        lines.append(f"★ NEW term(s) live on USC: {', '.join(result['new_terms'])}")
    if result["no_longer_active"]:
        lines.append(f"  no longer Active: {', '.join(result['no_longer_active'])}")
    if result["active_not_configured"]:
        lines.append(f"  Active but not configured for refresh: {', '.join(result['active_not_configured'])}")
    if result["configured_not_active"]:
        lines.append(f"  configured but NOT Active on USC: {', '.join(result['configured_not_active'])}")
    return lines


# ─── steps and snapshots ─────────────────────────────────────────────────────

class StepRunner:
    """Runs one pipeline step as a subprocess in ingestion/, appending its output to the run log."""

    def __init__(self, log_path: Path):
        self.log_path = log_path

    def __call__(self, name: str, argv: list[str], timeout: float) -> int:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "a") as log:
            log.write(f"\n===== {name} @ {utc_now().isoformat(timespec='seconds')}: {' '.join(argv)}\n")
            log.flush()
            try:
                rc = subprocess.run(argv, cwd=INGESTION_DIR, stdout=log, stderr=subprocess.STDOUT,
                                    timeout=timeout, env={**os.environ, "PYTHONUNBUFFERED": "1"}).returncode
            except subprocess.TimeoutExpired:
                log.write(f"\n✖ {name} timed out after {timeout:.0f} s and was killed\n")
                rc = 124
            log.write(f"===== {name} exit {rc}\n")
        return rc


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def snapshot_sections(snapshot_dir: Path, term: str) -> int | None:
    """Section count of a snapshot, from its Stage 2 summary (None if there's no usable snapshot)."""
    summary = snapshot_dir / f"usc_{term}_courses.summary.json"
    try:
        return int(json.loads(summary.read_text())["sections"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def point_latest(term_dir: Path, run_dir: Path) -> None:
    """Atomically repoint <term>/latest at run_dir (a relative link, so the tree can move)."""
    tmp = term_dir / "latest.tmp"
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    os.symlink(run_dir.name, tmp)
    os.replace(tmp, term_dir / "latest")


def prune_old_runs(term_dir: Path, keep: int = KEEP_RUNS_PER_TERM) -> list[Path]:
    """Delete all but the `keep` newest run dirs of a term. Never deletes latest's target."""
    latest = term_dir / "latest"
    protected = latest.resolve() if latest.is_symlink() else None
    runs = sorted((p for p in term_dir.iterdir() if p.is_dir() and not p.is_symlink() and _STAMP.match(p.name)),
                  key=lambda p: p.name)
    removed = []
    for old in runs[:-keep] if keep else runs:
        if protected and old.resolve() == protected:
            continue
        shutil.rmtree(old)
        removed.append(old)
    return removed


def shrink_problem(sections: int, previous: int | None, limit: float = SHRINK_LIMIT) -> str | None:
    if previous and sections < limit * previous:
        return (f"catalog shrank to {sections} sections from {previous} in the last good snapshot "
                f"(< {limit:.0%}); not loaded. Check USC, then re-run with --allow-shrink if it's real")
    return None


def refresh_term(term: str, runs_dir: Path, stamp: str, runner, *,
                 no_db: bool, allow_shrink: bool, only: str | None = None) -> dict:
    """Scrape, guard and load one term. Never raises for a step failure; returns its result.

    With `only` (a smoke run over a few programs) the catalog is partial by design,
    so it's loaded without pruning, skips the shrink guard, and never becomes `latest`.
    """
    term_dir = runs_dir / term
    run_dir = term_dir / stamp
    run_dir.mkdir(parents=True, exist_ok=True)
    programs = run_dir / f"programs_{term}.json"
    catalog = run_dir / f"usc_{term}_courses.json"
    py = sys.executable
    result = {"status": "failed", "failed_step": None, "error": None, "run_dir": str(run_dir),
              "catalog": str(catalog), "partial": bool(only),
              "prev_sections": snapshot_sections(term_dir / "latest", term)}

    def fail(step, error):
        result.update(failed_step=step, error=error)
        return result

    if runner("programs", [py, "-m", "app.scrapers.scrape_programs", "--term", term, "--out", str(programs)],
              TIMEOUTS["programs"]):
        return fail("programs", "Stage 1 (scrape_programs) failed; see the log")
    rc = runner("sections", [py, "-m", "app.scrapers.scrape_sections", "--term", term,
                             "--programs-json", str(programs), "--out", str(catalog),
                             *(["--only", only] if only else [])], TIMEOUTS["sections"])
    stage2 = run_dir / f"usc_{term}_courses.summary.json"
    if stage2.exists():
        s = json.loads(stage2.read_text())
        result.update(courses=s.get("courses"), sections=s.get("sections"),
                      edge_cases=len(s.get("edge_cases") or []), requests=s.get("requests"),
                      scrape_seconds=s.get("runtime_seconds"),
                      programs_failed=len(s.get("programs_failed") or []))
    if rc or not catalog.exists():
        return fail("sections", "Stage 2 (scrape_sections) failed; nothing was loaded. See the log and "
                                f"{stage2.name}")

    sections = result.get("sections")
    if not isinstance(sections, int):
        return fail("guard", f"{stage2.name} has no section count")
    problem = None if only else shrink_problem(sections, result["prev_sections"])
    if problem and not allow_shrink:
        return fail("guard", problem)

    if not no_db:
        if runner("load_courses", [py, "database/load_courses.py", "--json-file", str(catalog),
                                   *([] if only else ["--prune"])], TIMEOUTS["load_courses"]):
            return fail("load_courses", "load_courses.py failed; its transaction rolled back, the DB is unchanged")
    if not only:
        point_latest(term_dir, run_dir)
    result["status"] = "ok"
    return result


# ─── commands ────────────────────────────────────────────────────────────────

@contextlib.contextmanager
def run_lock(runs_dir: Path):
    """Yields True if we hold the lock, False if another run does."""
    runs_dir.mkdir(parents=True, exist_ok=True)
    with open(runs_dir / ".lock", "w") as fd:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)


def resolve_runs_dir(arg: str | None, env) -> Path:
    return Path(arg or env.get("REFRESH_RUNS_DIR") or DEFAULT_RUNS_DIR)


def cmd_probe(args, env, api, now: datetime) -> int:
    try:
        terms, _ = configured_terms(args.terms, env)
    except ValueError as e:
        print(f"✖ {e}", file=sys.stderr)
        return EXIT_CONFIG
    runs_dir = resolve_runs_dir(args.runs_dir, env)
    with run_lock(runs_dir) as locked:
        if not locked:
            print(f"✖ another run holds {runs_dir / '.lock'}", file=sys.stderr)
            return EXIT_LOCKED
        try:
            result = run_probe(api, runs_dir, terms, now)
        except UscApiError as e:
            print(f"✖ probe failed: {e}", file=sys.stderr)
            return EXIT_FAILED
    print("\n".join(describe_probe(result)))
    return EXIT_OK


def cmd_refresh(args, env, api, runner_factory, now: datetime) -> int:
    try:
        terms, source = configured_terms(args.terms, env)
    except ValueError as e:
        print(f"✖ {e}", file=sys.stderr)
        return EXIT_CONFIG
    problems = preflight(args.no_db, args.skip_profs, env)
    if problems:
        for p in problems:
            print(f"✖ {p}", file=sys.stderr)
        return EXIT_CONFIG

    runs_dir = resolve_runs_dir(args.runs_dir, env)
    with run_lock(runs_dir) as locked:
        if not locked:
            print(f"✖ another run holds {runs_dir / '.lock'}", file=sys.stderr)
            return EXIT_LOCKED

        stamp = now.strftime(STAMP_FORMAT)
        log_path = runs_dir / "logs" / f"{stamp}.log"
        summary_path = runs_dir / "logs" / f"{stamp}.json"
        runner = runner_factory(log_path)
        summary = {"started": now.isoformat(timespec="seconds"), "terms_source": source,
                   "options": {k: getattr(args, k)
                               for k in ("no_db", "skip_profs", "allow_inactive", "allow_shrink", "only")},
                   "log": str(log_path), "terms": {}, "profs": {"status": "skipped"}, "events": []}
        print(f"Refreshing {', '.join(terms)} (from {source}); log: {log_path}")

        try:
            probe_result = run_probe(api, runs_dir, terms, now)
        except UscApiError as e:
            summary.update(probe={"error": str(e)}, exit_code=EXIT_FAILED,
                           finished=utc_now().isoformat(timespec="seconds"))
            summary["events"].append({"event": "probe_failed", "error": str(e)})
            write_json_atomically(summary_path, summary)
            print(f"✖ probe failed, nothing refreshed: {e}", file=sys.stderr)
            return EXIT_FAILED
        summary["probe"] = probe_result
        summary["events"] += [{"event": "new_term", "term": t} for t in probe_result["new_terms"]]
        for line in describe_probe(probe_result):
            print(line)

        for term in terms:
            if term not in probe_result["active"] and not args.allow_inactive:
                res = {"status": "failed", "failed_step": "probe",
                       "error": f"{term} is not Active on USC (archived terms lose sections, and the load "
                                "prunes); pass --allow-inactive to refresh it anyway"}
            else:
                try:
                    res = refresh_term(term, runs_dir, stamp, runner, no_db=args.no_db,
                                       allow_shrink=args.allow_shrink, only=args.only)
                    prune_old_runs(runs_dir / term)
                except Exception as e:  # a bug or a corrupt file: fail this term, keep going, still report
                    res = {"status": "failed", "failed_step": "orchestrator", "error": f"{type(e).__name__}: {e}"}
            summary["terms"][term] = res
            if res["status"] == "ok":
                print(f"✔ {term}: {res.get('courses')} courses, {res.get('sections')} sections "
                      f"(previous {res.get('prev_sections') or 'none'}), {res.get('edge_cases')} edge cases"
                      + (" (not loaded: --no-db)" if args.no_db else " loaded")
                      + (" (partial --only run: not pruned, latest not moved)" if args.only else ""))
            else:
                summary["events"].append({"event": "term_failed", "term": term,
                                          "step": res["failed_step"], "error": res["error"]})
                print(f"✖ {term} failed at {res['failed_step']}: {res['error']}", file=sys.stderr)

        loaded = [r["catalog"] for r in summary["terms"].values() if r["status"] == "ok"]
        if args.no_db or args.skip_profs:
            summary["profs"] = {"status": "skipped", "reason": "--no-db" if args.no_db else "--skip-profs"}
        elif not loaded:
            summary["profs"] = {"status": "skipped", "reason": "no term loaded"}
        else:
            rc = runner("load_profs", [sys.executable, "database/load_profs.py", "--json-file", *loaded],
                        TIMEOUTS["load_profs"])
            summary["profs"] = {"status": "ok" if rc == 0 else "failed", "exit_code": rc}
            if rc:
                summary["events"].append({"event": "profs_failed", "exit_code": rc})
                print(f"✖ load_profs.py failed (exit {rc}); see the log", file=sys.stderr)
            else:
                print("✔ professor ratings refreshed")

        failed = any(r["status"] != "ok" for r in summary["terms"].values()) or summary["profs"]["status"] == "failed"
        code = EXIT_FAILED if failed else EXIT_OK
        summary.update(exit_code=code, finished=utc_now().isoformat(timespec="seconds"))
        write_json_atomically(summary_path, summary)
        print(f"{'✖' if failed else '✔'} done (exit {code}); summary: {summary_path}")
        return code


def main(argv=None, *, env=None, api=None, runner_factory=StepRunner, now=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    for name, help_ in (("probe", "report which terms USC lists as Active (1 request)"),
                        ("refresh", "scrape and load the configured terms")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("--terms", help="comma-separated term codes (default: $ACTIVE_SEMESTERS, else $SEMESTER)")
        p.add_argument("--runs-dir", help="output root (default: $REFRESH_RUNS_DIR, else ingestion/runs)")
        if name == "refresh":
            p.add_argument("--no-db", action="store_true", help="scrape and check only; don't load anything")
            p.add_argument("--skip-profs", action="store_true", help="don't run load_profs.py")
            p.add_argument("--allow-inactive", action="store_true",
                           help="also refresh configured terms USC doesn't list as Active")
            p.add_argument("--allow-shrink", action="store_true",
                           help=f"load even if a catalog has < {SHRINK_LIMIT:.0%} of the last snapshot's sections")
            p.add_argument("--only", help="smoke run: only these program codes (e.g. CHEM,CSCI). Loads "
                                          "without pruning and never moves `latest`")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env
    api = api or UscApi()
    now = now or utc_now()
    if args.command == "probe":
        return cmd_probe(args, env, api, now)
    return cmd_refresh(args, env, api, runner_factory, now)


if __name__ == "__main__":
    sys.exit(main())
