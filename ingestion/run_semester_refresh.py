"""Refresh USC course data for one or more terms, and probe for newly live terms.

    cd ingestion
    python run_semester_refresh.py probe
    python run_semester_refresh.py refresh --terms 20263,20271
    python run_semester_refresh.py refresh --no-db          # scrape + guards only
    python run_semester_refresh.py refresh --only CSCI --skip-profs   # cheap smoke run, never prunes
    python run_semester_refresh.py profs                   # professor ratings only, from each term's latest catalog
    python run_semester_refresh.py notify --test           # check the Discord webhook

On the Lightsail box, cron runs these through cron-wrapper.sh, which loads .env.

`refresh` runs, for each term: Stage 1 (scrape_programs) → Stage 2
(scrape_sections) → the shrink and removal guards → load_courses.py --prune → move the term's
`latest` link. Then load_profs.py once over every loaded catalog. `profs` runs
only that last step, over each configured term's `latest` catalog, with no
request to USC. `probe` asks USC which terms are live (one request) and reports
a term the first time it appears. None of them ever changes SEMESTER or restarts
anything: switching the live term stays a deliberate manual step.

Terms come from --terms, else $ACTIVE_SEMESTERS (comma list), else $SEMESTER.
Only terms USC lists as Active are refreshed (archived terms lose sections, and
the load prunes), unless --allow-inactive.

Exit codes:
    0  everything succeeded
    1  a term or the profs step failed (other terms may have loaded; see the summary), or a crash
    2  configuration or preflight error (including a DB that doesn't answer); nothing ran
    3  another run holds the lock (no summary, no alert: the other run reports)

Alerts (notify_discord.py) post one Discord message per run to $DISCORD_WEBHOOK_URL:
for a new USC term, for any failure, and a ✅ for a successful `refresh` or
`profs` (user, 2026-11-15). A probe with nothing new stays quiet. Every run
appends one line to logs/history.log. Unset → alerts are off (with a warning).
--no-notify silences a manual run. Delivery never changes the exit code.

Output lives under --runs-dir (default $REFRESH_RUNS_DIR, else ingestion/runs/):
    state.json                  probe state (Active terms seen before)
    logs/history.log            one line per run: what happened, and whether an alert went out
    logs/<stamp>.log            every step's output for one refresh
    logs/<stamp>.json           the run summary (refresh and probe), with its events
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
import traceback
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import notify_discord
from app.scrapers.scrape_programs import write_json_atomically
from app.scrapers.usc_api import UscApi, UscApiError, normalize_term

INGESTION_DIR = Path(__file__).resolve().parent
RMP_CLI = INGESTION_DIR.parent / "rate_my_prof" / "dist" / "prof_lookup_cli.js"
DEFAULT_RUNS_DIR = INGESTION_DIR / "runs"

EXIT_OK, EXIT_FAILED, EXIT_CONFIG, EXIT_LOCKED = 0, 1, 2, 3
KEEP_RUNS_PER_TERM = 8
SHRINK_LIMIT = 0.95  # a new catalog with < 95% of the last good snapshot's sections isn't loaded (user, 2026-11-13)
# The removal guard (user, 2026-11-16). The shrink guard compares totals, so added sections can hide lost
# ones, and no single department reaches 5% of a term (the largest, LAW in Fall 2026, is 4.5%). So a load is also refused
# if, section by section against the last good snapshot, the sections it would delete without USC having
# marked them cancelled are more than 1% of the term (25 are always allowed), or half or more of any
# subject ("CHEM" in "CHEM 105A") that had at least 5.
REMOVAL_LIMIT, REMOVAL_FLOOR = 0.01, 25
SUBJECT_LOSS_LIMIT, SUBJECT_MIN_SECTIONS = 0.5, 5
TIMEOUTS = {  # seconds; a hung step must not hold the lock forever
    "programs": 5 * 60,
    "sections": 60 * 60,
    "load_courses": 30 * 60,
    "load_profs": 8 * 60 * 60,
}
STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
_STAMP = re.compile(r"^\d{8}T\d{6}Z$")
DB_CONNECT_TIMEOUT = 5  # seconds; preflight's one connection


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


def connect_db(**kwargs):
    """psycopg2.connect, imported only when needed. Tests replace this."""
    import psycopg2
    return psycopg2.connect(**kwargs)


def db_problem(env, connect=None) -> str | None:
    """Can the loaders reach Postgres with these settings? Opens one connection and closes it.

    Same defaults as load_courses.py and load_profs.py. Under cron the DB is a likely thing to be
    unreachable (the container is down, or its IP moved), and finding out now beats a
    25-minute scrape that fails at load.
    """
    connect = connect or connect_db
    host, port = env.get("USC_DB_HOST") or "localhost", env.get("USC_DB_PORT") or "5432"
    password = env.get("USC_DB_PASSWORD") or ""
    try:
        conn = connect(dbname=env.get("USC_DB_NAME") or "usc_sched", user=env.get("USC_DB_USER"),
                       password=password, host=host, port=int(port), connect_timeout=DB_CONNECT_TIMEOUT)
        conn.close()
    except Exception as e:  # noqa: BLE001: any failure here is a problem to report, not a crash
        detail = (str(e).strip().splitlines() or [type(e).__name__])[0].strip()
        if len(password) >= 4:  # psycopg2 doesn't echo it; this is a backstop (a 1-letter one would mangle text)
            detail = detail.replace(password, "<redacted>")
        return f"can't connect to Postgres at {host}:{port}: {detail}"
    return None


def preflight(no_db: bool, skip_profs: bool, env, which=None, rmp_cli: Path | None = None,
              connect=None) -> list[str]:
    """Problems that would make the run fail later. Checked before any request is made."""
    which = which or shutil.which
    rmp_cli = rmp_cli or RMP_CLI
    problems = []
    if not no_db:
        missing = [v for v in ("USC_DB_USER", "USC_DB_PASSWORD") if not env.get(v)]
        if missing:
            problems.append(f"missing {', '.join(missing)} (the loaders read the DB target from the environment)")
        else:
            problem = db_problem(env, connect)
            if problem:
                problems.append(problem)
        if not skip_profs:
            if not which("node"):
                problems.append("`node` is not on PATH (load_profs.py runs the RateMyProfessors CLI; "
                                "refresh can skip that step with --skip-profs)")
            if not rmp_cli.exists():
                problems.append(f"{rmp_cli} is missing: run `npm ci && npm run build` in rate_my_prof/ "
                                "(dist/ is gitignored; refresh can skip that step with --skip-profs)")
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


def catalog_sections(path: Path) -> set[tuple[str, str]] | None:
    """{(course code, section number)} of a catalog file, or None if there's no readable catalog."""
    try:
        data = json.loads(path.read_text())
        return {(code, str(s["sectionNumber"])) for code, course in data.items()
                for s in course.get("sections") or []}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def subject(code: str) -> str:
    """'CHEM 105A' → 'CHEM'."""
    return (code.split() or [code])[0]


def removal_check(previous: set | None, new: set, cancelled: set[str]) -> tuple[str | None, dict]:
    """Would loading `new` delete sections of `previous` (the last good snapshot) that USC didn't cancel?

    Returns (problem or None, counts for the summary). The load prunes whatever left the catalog.
    Sections USC marked cancelled should go. Anything else that vanished may be USC answering for a
    department "successfully" but incompletely, which the total-based shrink guard can't see.
    """
    if not previous:
        return None, {}
    removed = previous - new
    unexplained = [(code, number) for code, number in removed if number not in cancelled]
    counts = {"removed": len(removed), "removed_cancelled": len(removed) - len(unexplained)}
    problems = []
    limit = max(REMOVAL_FLOOR, int(REMOVAL_LIMIT * len(previous)))
    if len(unexplained) > limit:
        problems.append(f"{len(unexplained)} sections would be deleted that USC didn't mark cancelled (limit {limit})")
    had = Counter(subject(code) for code, _ in previous)
    lost = Counter(subject(code) for code, _ in unexplained)
    hit = sorted((s for s, n in lost.items() if had[s] >= SUBJECT_MIN_SECTIONS and n >= SUBJECT_LOSS_LIMIT * had[s]),
                 key=lambda s: (-lost[s], s))
    if hit:
        shown = ", ".join(f"{s} {lost[s]} of {had[s]}" for s in hit[:5]) + (", …" if len(hit) > 5 else "")
        whose = "a subject's" if len(hit) == 1 else f"{len(hit)} subjects'"
        problems.append(f"half or more of {whose} sections would go ({shown})")
    if not problems:
        return None, counts
    return "; ".join(problems) + "; not loaded. Check USC, then re-run with --allow-shrink if it's real", counts


def refresh_term(term: str, runs_dir: Path, stamp: str, runner, *,
                 no_db: bool, allow_shrink: bool, only: str | None = None) -> dict:
    """Scrape, guard and load one term. Never raises for a step failure; returns its result.

    With `only` (a smoke run over a few programs) the catalog is partial by design,
    so it's loaded without pruning, skips both guards, and never becomes `latest`.
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
    s = {}
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
    if not only:  # an --only catalog is partial by design: every program it skipped would look removed
        new = catalog_sections(catalog)
        if new is None:
            return fail("guard", f"{catalog.name} can't be read; not loaded")
        problem, counts = removal_check(catalog_sections(term_dir / "latest" / catalog.name), new,
                                        {str(n) for n in s.get("cancelled_sections") or []})
        result.update(counts)
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


# ─── lock and paths ──────────────────────────────────────────────────────────

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


# ─── summaries, alerts, history ──────────────────────────────────────────────

def new_summary(command: str, now: datetime, **fields) -> dict:
    return {"command": command, "started": now.isoformat(timespec="seconds"), **fields, "events": []}


def history_line(stamp: str, summary: dict) -> str:
    """One line per run for logs/history.log, e.g.
    20261115T030000Z  refresh  exit 0  12m31s  20263 ok 9110 sections (+12) · profs ok  notify quiet
    """
    clip = notify_discord.clip
    details = []
    if summary.get("command") == "profs":
        details.append(f"catalogs {','.join(summary.get('catalogs') or {}) or 'none'}")
        if summary.get("missing_terms"):
            details.append(f"no catalog {','.join(summary['missing_terms'])}")
    for term, res in (summary.get("terms") or {}).items():
        details.append(f"{term} ok {notify_discord.sections_text(res)}".rstrip() if res.get("status") == "ok"
                       else f"{term} FAILED at {res.get('failed_step')}")
    if "profs" in summary:
        details.append(f"profs {summary['profs'].get('status')}")
    probe = summary.get("probe") or {}
    if "error" in probe:
        details.append(f"probe FAILED: {clip(probe['error'], 80)}")
    elif summary.get("command") == "probe" and probe:
        details.append(f"active {','.join(probe.get('active') or []) or 'none'}")
    for e in summary.get("events") or []:
        if e.get("event") == "new_term":
            details.append(f"NEW TERM {e.get('term')}")
        elif e.get("event") == "config_failed":
            details.append(f"CONFIG FAILED: {clip('; '.join(e.get('problems') or []), 80)}")
        elif e.get("event") == "crashed":
            details.append(f"CRASHED: {clip(e.get('error'), 80)}")
    return "  ".join([stamp, summary.get("command", "?"), f"exit {summary.get('exit_code')}",
                      notify_discord.duration(summary) or "-", " · ".join(details) or "-",
                      f"notify {(summary.get('notify') or {}).get('status', '?')}"])


def _save(path: Path, summary: dict) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json_atomically(path, summary)
        return True
    except (OSError, TypeError, ValueError) as e:
        print(f"✖ couldn't write the run summary {path}: {e}", file=sys.stderr)
        return False


def finish(summary: dict, runs_dir: Path, stamp: str, *, no_notify: bool, notifier) -> None:
    """Save the summary, send the alert it needs (if any), append to history.log.

    Never raises: the run's result is already decided, and reporting it must not change it.
    """
    summary.setdefault("finished", utc_now().isoformat(timespec="seconds"))
    path = runs_dir / "logs" / f"{stamp}.json"
    saved = _save(path, summary)  # first, so a hung or killed delivery still leaves the summary
    summary["notify"] = {"status": "off"} if no_notify else notifier(summary, summary_path=path if saved else None)
    status = summary["notify"]["status"]
    if status == "sent":
        print("✔ Discord alert sent")
    elif status == "failed":
        print(f"✖ Discord alert NOT delivered: {summary['notify']['error']}", file=sys.stderr)
    elif status == "disabled":
        print(f"⚠ alerts are off: {notify_discord.ENV_VAR} is not set", file=sys.stderr)
    if saved:
        _save(path, summary)
    try:
        with open(runs_dir / "logs" / "history.log", "a") as f:
            f.write(history_line(stamp, summary) + "\n")
    except Exception as e:  # noqa: BLE001: history is a convenience; never fail the run over it
        print(f"✖ couldn't append to history.log: {e}", file=sys.stderr)


def config_failed(command: str, problems: list[str], runs_dir: Path, now: datetime, args, notifier) -> int:
    """Exit 2: nothing ran. Under cron this is usually an environment that didn't load, so say so loudly."""
    for p in problems:
        print(f"✖ {p}", file=sys.stderr)
    summary = new_summary(command, now)
    summary["events"].append({"event": "config_failed", "problems": problems})
    summary["exit_code"] = EXIT_CONFIG
    finish(summary, runs_dir, now.strftime(STAMP_FORMAT), no_notify=args.no_notify, notifier=notifier)
    return EXIT_CONFIG


def report_crash(args, env, now: datetime, notifier, error: Exception) -> None:
    """An uncaught exception: still leave a summary and send an alert. The caller re-raises."""
    try:
        summary = new_summary(args.command, now)
        summary["events"].append({"event": "crashed", "error": f"{type(error).__name__}: {error}",
                                  "traceback": traceback.format_exc()})
        summary["exit_code"] = EXIT_FAILED
        finish(summary, resolve_runs_dir(args.runs_dir, env), now.strftime(STAMP_FORMAT),
               no_notify=args.no_notify, notifier=notifier)
    except Exception as e:  # noqa: BLE001: reporting must not mask the original error
        print(f"✖ couldn't report the crash: {type(e).__name__}: {e}", file=sys.stderr)


# ─── commands ────────────────────────────────────────────────────────────────

def cmd_probe(args, env, api, now: datetime, notifier) -> int:
    runs_dir = resolve_runs_dir(args.runs_dir, env)
    try:
        terms, source = configured_terms(args.terms, env)
    except ValueError as e:
        return config_failed("probe", [str(e)], runs_dir, now, args, notifier)
    with run_lock(runs_dir) as locked:
        if not locked:
            print(f"✖ another run holds {runs_dir / '.lock'}", file=sys.stderr)
            return EXIT_LOCKED
        # Written even when nothing is new: the nightly probe is what sees a new term first,
        # and it records the term in state.json, so no later run would report it.
        summary = new_summary("probe", now, terms_source=source)
        try:
            result = run_probe(api, runs_dir, terms, now)
        except UscApiError as e:
            summary["probe"] = {"error": str(e)}
            summary["events"].append({"event": "probe_failed", "error": str(e)})
            print(f"✖ probe failed: {e}", file=sys.stderr)
            code = EXIT_FAILED
        else:
            summary["probe"] = result
            summary["events"] += [{"event": "new_term", "term": t} for t in result["new_terms"]]
            print("\n".join(describe_probe(result)))
            code = EXIT_OK
        summary["exit_code"] = code
        finish(summary, runs_dir, now.strftime(STAMP_FORMAT), no_notify=args.no_notify, notifier=notifier)
        return code


def cmd_refresh(args, env, api, runner_factory, now: datetime, notifier) -> int:
    runs_dir = resolve_runs_dir(args.runs_dir, env)
    try:
        terms, source = configured_terms(args.terms, env)
    except ValueError as e:
        return config_failed("refresh", [str(e)], runs_dir, now, args, notifier)
    problems = preflight(args.no_db, args.skip_profs, env)
    if problems:
        return config_failed("refresh", problems, runs_dir, now, args, notifier)

    with run_lock(runs_dir) as locked:
        if not locked:
            print(f"✖ another run holds {runs_dir / '.lock'}", file=sys.stderr)
            return EXIT_LOCKED

        stamp = now.strftime(STAMP_FORMAT)
        log_path = runs_dir / "logs" / f"{stamp}.log"
        summary_path = runs_dir / "logs" / f"{stamp}.json"
        runner = runner_factory(log_path)
        summary = new_summary("refresh", now, terms_source=source,
                              options={k: getattr(args, k)
                                       for k in ("no_db", "skip_profs", "allow_inactive", "allow_shrink", "only")},
                              log=str(log_path), terms={}, profs={"status": "skipped"})
        print(f"Refreshing {', '.join(terms)} (from {source}); log: {log_path}")

        try:
            probe_result = run_probe(api, runs_dir, terms, now)
        except UscApiError as e:
            summary.update(probe={"error": str(e)}, exit_code=EXIT_FAILED)
            summary["events"].append({"event": "probe_failed", "error": str(e)})
            print(f"✖ probe failed, nothing refreshed: {e}", file=sys.stderr)
            finish(summary, runs_dir, stamp, no_notify=args.no_notify, notifier=notifier)
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
        summary["exit_code"] = code
        print(f"{'✖' if failed else '✔'} done (exit {code}); summary: {summary_path}")
        finish(summary, runs_dir, stamp, no_notify=args.no_notify, notifier=notifier)
        return code


def cmd_profs(args, env, runner_factory, now: datetime, notifier) -> int:
    """load_profs.py over each configured term's `latest` catalog: ratings without a re-scrape.

    Professors aren't per semester, so the union of the terms' instructors is what to look up.
    A term with no `latest` catalog yet is skipped and named; none at all is a config error.
    """
    runs_dir = resolve_runs_dir(args.runs_dir, env)
    try:
        terms, source = configured_terms(args.terms, env)
    except ValueError as e:
        return config_failed("profs", [str(e)], runs_dir, now, args, notifier)
    found = {}
    for term in terms:
        catalog = runs_dir / term / "latest" / f"usc_{term}_courses.json"
        if catalog.exists():
            found[term] = str(catalog.resolve())  # the snapshot itself, so the summary says which one
    missing = [t for t in terms if t not in found]
    problems = preflight(False, False, env)
    if not found:
        problems.append(f"no catalog for {', '.join(terms)} under {runs_dir}: run `refresh` first")
    if problems:
        return config_failed("profs", problems, runs_dir, now, args, notifier)

    with run_lock(runs_dir) as locked:
        if not locked:
            print(f"✖ another run holds {runs_dir / '.lock'}", file=sys.stderr)
            return EXIT_LOCKED
        stamp = now.strftime(STAMP_FORMAT)
        log_path = runs_dir / "logs" / f"{stamp}.log"
        summary_path = runs_dir / "logs" / f"{stamp}.json"
        runner = runner_factory(log_path)
        summary = new_summary("profs", now, terms_source=source, log=str(log_path),
                              catalogs=found, missing_terms=missing)
        print(f"Refreshing professor ratings from {', '.join(found)} (from {source}); log: {log_path}")
        if missing:
            print(f"⚠ no catalog yet for {', '.join(missing)}: skipped", file=sys.stderr)
        rc = runner("load_profs", [sys.executable, "database/load_profs.py", "--json-file", *found.values()],
                    TIMEOUTS["load_profs"])
        summary["profs"] = {"status": "ok" if rc == 0 else "failed", "exit_code": rc}
        if rc:
            summary["events"].append({"event": "profs_failed", "exit_code": rc})
        code = EXIT_FAILED if rc else EXIT_OK
        summary["exit_code"] = code
        print(f"{'✖ load_profs.py failed' if rc else '✔ professor ratings refreshed'} (exit {code}); "
              f"summary: {summary_path}")
        finish(summary, runs_dir, stamp, no_notify=args.no_notify, notifier=notifier)
        return code


def cmd_notify(args, env, now: datetime, transport: dict) -> int:
    """`notify --test` checks the webhook; `notify --summary PATH` (re)sends or previews a run's alert."""
    if args.test:
        content = notify_discord.setup_check_message(now=now)
    else:
        path = Path(args.summary)
        try:
            summary = json.loads(path.read_text())
        except (OSError, ValueError) as e:
            print(f"✖ can't read {path}: {e}", file=sys.stderr)
            return EXIT_CONFIG
        content = notify_discord.build_message(summary, summary_path=path)
        if content is None:
            print("nothing to send: that run has nothing to report (e.g. a probe with nothing new)")
            return EXIT_OK
    if args.dry_run:
        print(content)
        return EXIT_OK
    url = notify_discord.webhook_url(env)
    if not url:
        print(f"✖ {notify_discord.ENV_VAR} is not set (see notify_discord.py for the setup steps)", file=sys.stderr)
        return EXIT_CONFIG
    try:
        notify_discord.send(url, content, **transport)
    except notify_discord.NotifyError as e:
        print(f"✖ not delivered: {notify_discord.redact(e, url)}", file=sys.stderr)
        return EXIT_FAILED
    print("✔ test message delivered: check the channel" if args.test else "✔ alert sent")
    return EXIT_OK


def main(argv=None, *, env=None, api=None, runner_factory=StepRunner, now=None, post=None, sleep=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    for name, help_ in (("probe", "report which terms USC lists as Active (1 request)"),
                        ("refresh", "scrape and load the configured terms"),
                        ("profs", "refresh professor ratings from each term's latest catalog (no USC request)")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("--terms", help="comma-separated term codes (default: $ACTIVE_SEMESTERS, else $SEMESTER)")
        p.add_argument("--runs-dir", help="output root (default: $REFRESH_RUNS_DIR, else ingestion/runs)")
        p.add_argument("--no-notify", action="store_true",
                       help=f"don't send a Discord alert for this run, even if ${notify_discord.ENV_VAR} is set")
        if name == "refresh":
            p.add_argument("--no-db", action="store_true", help="scrape and check only; don't load anything")
            p.add_argument("--skip-profs", action="store_true", help="don't run load_profs.py")
            p.add_argument("--allow-inactive", action="store_true",
                           help="also refresh configured terms USC doesn't list as Active")
            p.add_argument("--allow-shrink", action="store_true",
                           help=f"load even if a guard trips: a catalog with < {SHRINK_LIMIT:.0%} of the last "
                                "snapshot's sections, or one that would delete sections USC didn't mark cancelled")
            p.add_argument("--only", help="smoke run: only these program codes (e.g. CHEM,CSCI). Loads "
                                          "without pruning and never moves `latest`")
    n = sub.add_parser("notify", help="check the Discord webhook, or (re)send a run's alert")
    which = n.add_mutually_exclusive_group(required=True)
    which.add_argument("--test", action="store_true", help=f"send a test message to ${notify_discord.ENV_VAR}")
    which.add_argument("--summary", help="a run summary (logs/<stamp>.json) whose alert to send")
    n.add_argument("--dry-run", action="store_true", help="print the message instead of sending it")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env
    now = now or utc_now()
    transport = {k: v for k, v in (("post", post), ("sleep", sleep)) if v is not None}  # tests inject fakes
    if args.command == "notify":
        return cmd_notify(args, env, now, transport)

    def notifier(summary, summary_path=None):
        return notify_discord.notify(summary, env, summary_path=summary_path, **transport)

    try:
        if args.command == "profs":
            return cmd_profs(args, env, runner_factory, now, notifier)
        api = api or UscApi()
        if args.command == "probe":
            return cmd_probe(args, env, api, now, notifier)
        return cmd_refresh(args, env, api, runner_factory, now, notifier)
    except Exception as e:
        report_crash(args, env, now, notifier, e)
        raise


if __name__ == "__main__":
    sys.exit(main())
