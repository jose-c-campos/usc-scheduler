"""Phase 3: the refresh orchestrator, and the loader changes it relies on.

No network, no subprocesses, no database. The orchestrator takes a fake USC API
and a fake step runner that writes the files each real step would. The loaders'
SQL is exercised against a real Postgres by hand (see the handoff, Phase 3).
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

import run_semester_refresh as rsr
from database import load_courses, load_profs

NOW = datetime(2026, 11, 13, 21, 0, 0, tzinfo=timezone.utc)
LATER = datetime(2026, 11, 20, 21, 0, 0, tzinfo=timezone.utc)
DB_ENV = {"USC_DB_USER": "u", "USC_DB_PASSWORD": "p"}


# ─── fakes ───────────────────────────────────────────────────────────────────

class FakeApi:
    def __init__(self, active=("20263", "20271"), error=None):
        self.active, self.error, self.calls = list(active), error, 0

    def active_terms(self):
        self.calls += 1
        if self.error:
            raise rsr.UscApiError(self.error)
        return self.active


def term_of(argv):
    """The term a per-term step works on: Stage 1/2 take --term, load_courses a usc_<term>_courses.json."""
    if "--term" in argv:
        return argv[argv.index("--term") + 1]
    if "database/load_courses.py" in argv:
        return Path(argv[argv.index("--json-file") + 1]).name.split("_")[1]
    return None


class FakeRunner:
    """Stands in for the pipeline steps. `fail` holds step names or (step, term) pairs.

    Stage 2 writes `catalogs[term]` if given (see catalog()), else a catalog with no sections, and a
    summary claiming `sections[term]` sections (else the catalog's own count, else 100) and listing
    `cancelled[term]` as the sections USC marked cancelled.
    """

    def __init__(self, sections=None, fail=(), stage2_writes_catalog=True, catalogs=None, cancelled=None):
        self.sections = sections or {}
        self.fail = set(fail)
        self.stage2_writes_catalog = stage2_writes_catalog
        self.catalogs = catalogs or {}
        self.cancelled = cancelled or {}
        self.calls = []
        self.log_path = None

    def factory(self, log_path):
        self.log_path = log_path
        return self

    def steps(self, term=None):
        """Step names in call order; with a term, only that term's steps (load_profs has none)."""
        return [name for name, argv in self.calls if term is None or term_of(argv) == term]

    def __call__(self, name, argv, timeout):
        self.calls.append((name, list(argv)))
        term = argv[argv.index("--term") + 1] if "--term" in argv else None
        failing = name in self.fail or (name, term) in self.fail
        if name == "programs" and not failing:
            out = Path(argv[argv.index("--out") + 1])
            out.write_text(json.dumps([{"code": "CSCI", "school": "ENGV", "name": "CS",
                                        "href": f"https://classes.usc.edu/term/{term}/program/CSCI/school/ENGV"}]))
        if name == "sections":
            out = Path(argv[argv.index("--out") + 1])
            written = self.catalogs.get(term, {"CSCI 101": {"title": "t", "sections": [], "has_bundled_sections": False}})
            n = self.sections.get(term)
            if n is None:
                n = sum(len(c["sections"]) for c in written.values()) if term in self.catalogs else 100
            out.with_name(out.stem + ".summary.json").write_text(json.dumps({
                "term": term, "courses": 10, "sections": n, "requests": 1, "runtime_seconds": 1.0,
                "programs_failed": [{"program": "CSCI"}] if failing else [],
                "cancelled_sections": self.cancelled.get(term, []),
                "edge_cases": [{"code": "CHEM 332", "kind": "multiple_meeting_times", "note": "x"}]}))
            if not failing and self.stage2_writes_catalog:
                out.write_text(json.dumps(written))
        return 1 if failing else 0


def catalog(**subjects):
    """A catalog with one course per subject holding n sections: catalog(CHEM=2) has CHEM 101 with CHEM000, CHEM001."""
    return {f"{s} 101": {"title": "t", "has_bundled_sections": False,
                         "sections": [{"sectionNumber": f"{s}{i:03d}"} for i in range(n)]}
            for s, n in subjects.items()}


def keys(**subjects):
    """The (course code, section number) set of catalog(**subjects), as removal_check takes it."""
    return {(code, s["sectionNumber"]) for code, c in catalog(**subjects).items() for s in c["sections"]}


def refresh(tmp_path, *extra, api=None, runner=None, env=None, now=NOW):
    api = api or FakeApi()
    runner = runner or FakeRunner()
    argv = ["refresh", "--runs-dir", str(tmp_path), "--terms", "20263,20271", *extra]
    code = rsr.main(argv, env={**DB_ENV, **(env or {})}, api=api, runner_factory=runner.factory, now=now)
    return code, runner, api


def last_summary(runs_dir: Path) -> dict:
    return json.loads(sorted((runs_dir / "logs").glob("*.json"))[-1].read_text())


@pytest.fixture(autouse=True)
def rmp_cli_present(monkeypatch, tmp_path_factory):
    """Pretend node and the built RMP CLI exist, unless a test says otherwise."""
    cli = tmp_path_factory.mktemp("rmp") / "prof_lookup_cli.js"
    cli.write_text("")
    monkeypatch.setattr(rsr, "RMP_CLI", cli)
    monkeypatch.setattr(rsr.shutil, "which", lambda name: f"/usr/bin/{name}")


# ─── configuration ───────────────────────────────────────────────────────────

def test_parse_terms_dedupes_and_keeps_order():
    assert rsr.parse_terms(" 20271, 20263 ,20271,") == ["20271", "20263"]


@pytest.mark.parametrize("bad", ["", " , ", "2027", "20271,fall"])
def test_parse_terms_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        rsr.parse_terms(bad)


def test_terms_precedence_is_flag_then_active_semesters_then_semester():
    env = {"ACTIVE_SEMESTERS": "20263,20271", "SEMESTER": "20261"}
    assert rsr.configured_terms("20262", env) == (["20262"], "--terms")
    assert rsr.configured_terms(None, env) == (["20263", "20271"], "ACTIVE_SEMESTERS")
    assert rsr.configured_terms(None, {"SEMESTER": "20261"}) == (["20261"], "SEMESTER")


def test_no_terms_anywhere_is_an_error_not_a_default():
    with pytest.raises(ValueError, match="no terms configured"):
        rsr.configured_terms(None, {"ACTIVE_SEMESTERS": " "})


def test_preflight_wants_db_credentials_node_and_the_built_rmp_cli(tmp_path):
    missing_cli = tmp_path / "nope.js"
    problems = rsr.preflight(False, False, {}, which=lambda n: None, rmp_cli=missing_cli)
    assert len(problems) == 3
    assert "USC_DB_USER, USC_DB_PASSWORD" in problems[0]
    assert "node" in problems[1] and "npm ci && npm run build" in problems[2]


def test_preflight_skip_profs_and_no_db_need_less(tmp_path):
    missing_cli = tmp_path / "nope.js"
    assert rsr.preflight(False, True, DB_ENV, which=lambda n: None, rmp_cli=missing_cli) == []
    assert rsr.preflight(True, False, {}, which=lambda n: None, rmp_cli=missing_cli) == []


# ─── probe ───────────────────────────────────────────────────────────────────

def test_first_probe_seeds_state_without_reporting_new_terms():
    state, result = rsr.probe(["20262", "20271"], {}, ["20271"], NOW)
    assert result["initial"] and result["new_terms"] == []
    assert result["active_not_configured"] == ["20262"]
    assert state["seen_active"] == {"20262": "2026-11-13", "20271": "2026-11-13"}


def test_a_new_term_is_reported_once():
    state, _ = rsr.probe(["20262", "20271"], {}, [], NOW)
    state, result = rsr.probe(["20262", "20271", "20272"], state, [], LATER)
    assert result["new_terms"] == ["20272"] and not result["initial"]
    assert state["seen_active"]["20272"] == "2026-11-20"
    assert state["seen_active"]["20262"] == "2026-11-13"  # first-seen date kept
    _, again = rsr.probe(["20262", "20271", "20272"], state, [], LATER)
    assert again["new_terms"] == []


def test_probe_lists_terms_that_left_active_and_configured_terms_that_are_not_active():
    state, _ = rsr.probe(["20262", "20271"], {}, [], NOW)
    _, result = rsr.probe(["20271"], state, ["20253", "20271"], LATER)
    assert result["no_longer_active"] == ["20262"]
    assert result["configured_not_active"] == ["20253"]


def test_probe_command_writes_state_and_exits_zero(tmp_path, capsys):
    code = rsr.main(["probe", "--runs-dir", str(tmp_path), "--terms", "20253"],
                    env={}, api=FakeApi(["20271"]), now=NOW)
    assert code == 0
    assert json.loads((tmp_path / "state.json").read_text())["last_active"] == ["20271"]
    out = capsys.readouterr().out
    assert "first probe" in out and "configured but NOT Active on USC: 20253" in out


def test_probe_command_fails_loudly_when_usc_does(tmp_path):
    code = rsr.main(["probe", "--runs-dir", str(tmp_path), "--terms", "20271"],
                    env={}, api=FakeApi(error="HTTP 503"), now=NOW)
    assert code == 1 and not (tmp_path / "state.json").exists()


# ─── snapshots ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("new,prev,trips", [(950, 1000, False), (949, 1000, True), (1200, 1000, False),
                                            (10, None, False), (5, 0, False)])
def test_shrink_guard(new, prev, trips):
    assert (rsr.shrink_problem(new, prev) is not None) == trips


def test_removal_guard_passes_a_first_load_and_normal_churn():
    assert rsr.removal_check(None, keys(CSCI=10), set()) == (None, {})
    previous = keys(CSCI=970, CHEM=30)
    new = {k for k in previous if k[1] not in {"CSCI000", "CSCI001", "CSCI002", "CSCI003", "CSCI004"}} | keys(MATH=10)
    assert rsr.removal_check(previous, new, set()) == (None, {"removed": 5, "removed_cancelled": 0})


def test_removal_guard_stops_a_vanished_subject_the_shrink_guard_misses():
    """USC answering for a department "successfully" but empty: no step fails, and the total barely moves."""
    previous, new = keys(CSCI=980, CHEM=20), keys(CSCI=1000)
    assert rsr.shrink_problem(1000, 1000) is None  # the total didn't even drop, and 20 is under the total limit
    problem, counts = rsr.removal_check(previous, new, set())
    assert problem.startswith("half or more of a subject's sections would go (CHEM 20 of 20)")
    assert problem.endswith("re-run with --allow-shrink if it's real") and counts["removed"] == 20


def test_sections_usc_cancelled_are_explained_removals():
    cancelled = {f"CHEM{i:03d}" for i in range(30)}
    assert rsr.removal_check(keys(CSCI=970, CHEM=30), keys(CSCI=970), cancelled) == \
        (None, {"removed": 30, "removed_cancelled": 30})


def test_many_unexplained_removals_trip_even_when_spread_thin():
    previous = keys(**{f"S{i:02d}": 20 for i in range(50)})          # 1,000 sections in 50 subjects
    new = {(code, n) for code, n in previous if int(n[-3:]) >= 3}    # 3 gone from each: 150, 15% of each
    problem, _ = rsr.removal_check(previous, new, set())
    assert problem.startswith("150 sections would be deleted that USC didn't mark cancelled (limit 25)")
    assert "subject" not in problem


def test_removal_guard_names_the_worst_subjects_first_and_caps_the_list():
    previous = keys(CSCI=500, **{f"S{i}": 10 for i in range(7)}, BIG=40)
    problem, _ = rsr.removal_check(previous, keys(CSCI=500), set())
    assert "half or more of 8 subjects' sections would go (BIG 40 of 40, S0 10 of 10, S1 10 of 10" in problem
    assert ", …)" in problem and problem.startswith("110 sections would be deleted")


def test_subjects_under_the_minimum_are_left_to_the_total_limit():
    assert rsr.removal_check(keys(CSCI=970, ABC=4), keys(CSCI=970), set()) == \
        (None, {"removed": 4, "removed_cancelled": 0})


def test_point_latest_is_a_relative_link_that_can_be_repointed(tmp_path):
    a, b = tmp_path / "20261113T000000Z", tmp_path / "20261120T000000Z"
    a.mkdir(), b.mkdir()
    rsr.point_latest(tmp_path, a)
    rsr.point_latest(tmp_path, b)
    latest = tmp_path / "latest"
    assert latest.is_symlink() and str(latest.readlink()) == b.name
    assert not (tmp_path / "latest.tmp").exists()


def test_old_runs_are_pruned_but_latest_target_is_kept(tmp_path):
    runs = [tmp_path / f"2026111{i}T000000Z" for i in range(5)]
    for r in runs:
        r.mkdir()
    rsr.point_latest(tmp_path, runs[0])  # e.g. every later run failed its guard
    removed = rsr.prune_old_runs(tmp_path, keep=2)
    assert sorted(removed) == runs[1:3]
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([runs[0].name, runs[3].name, runs[4].name, "latest"])


# ─── refresh ─────────────────────────────────────────────────────────────────

def test_refresh_happy_path_runs_every_step_in_order(tmp_path):
    code, runner, api = refresh(tmp_path)
    assert code == 0 and api.calls == 1
    assert runner.steps() == ["programs", "sections", "load_courses", "programs", "sections", "load_courses",
                              "load_profs"]
    stamp = NOW.strftime(rsr.STAMP_FORMAT)
    for term in ("20263", "20271"):
        catalog = tmp_path / term / stamp / f"usc_{term}_courses.json"
        assert catalog.exists()
        assert (tmp_path / term / "latest").resolve() == (tmp_path / term / stamp).resolve()
        load = next(argv for name, argv in runner.calls if name == "load_courses" and str(catalog) in argv)
        assert "--prune" in load
        # load_courses.py must read the right term from this path (Phase 1: basename only).
        assert load_courses.resolve_semester(str(catalog)) == term
    profs = next(argv for name, argv in runner.calls if name == "load_profs")
    assert sum(a.endswith("_courses.json") for a in profs) == 2
    summary = last_summary(tmp_path)
    assert summary["exit_code"] == 0 and summary["events"] == []
    assert summary["terms"]["20271"]["sections"] == 100 and summary["terms"]["20271"]["edge_cases"] == 1
    assert runner.log_path == tmp_path / "logs" / f"{stamp}.log"


def test_inactive_term_is_not_scraped_unless_allowed(tmp_path):
    code, runner, _ = refresh(tmp_path, api=FakeApi(["20271"]))
    assert code == 1
    assert runner.steps("20263") == []
    assert runner.steps("20271") == ["programs", "sections", "load_courses"]
    summary = last_summary(tmp_path)
    assert summary["terms"]["20263"]["failed_step"] == "probe"
    assert {"event": "term_failed", "term": "20263", "step": "probe",
            "error": summary["terms"]["20263"]["error"]} in summary["events"]
    assert summary["profs"]["status"] == "ok"  # the term that did load still gets ratings

    code, runner, _ = refresh(tmp_path, "--allow-inactive", api=FakeApi(["20271"]), now=LATER)
    assert code == 0 and runner.steps("20263") == ["programs", "sections", "load_courses"]


def test_shrunken_catalog_is_not_loaded_and_latest_stays(tmp_path):
    refresh(tmp_path, runner=FakeRunner(sections={"20271": 1000}))
    first = (tmp_path / "20271" / "latest").resolve()

    code, runner, _ = refresh(tmp_path, runner=FakeRunner(sections={"20271": 800}), now=LATER)
    assert code == 1
    assert runner.steps("20271") == ["programs", "sections"]
    assert (tmp_path / "20271" / "latest").resolve() == first
    t = last_summary(tmp_path)["terms"]["20271"]
    assert t["failed_step"] == "guard" and t["prev_sections"] == 1000 and "800" in t["error"]

    code, runner, _ = refresh(tmp_path, "--allow-shrink", runner=FakeRunner(sections={"20271": 800}),
                              now=datetime(2026, 11, 21, tzinfo=timezone.utc))
    assert code == 0 and "load_courses" in runner.steps("20271")


def test_a_vanished_subject_is_not_loaded_and_latest_stays(tmp_path):
    refresh(tmp_path, runner=FakeRunner(catalogs={"20271": catalog(CSCI=970, CHEM=30)}))
    first = (tmp_path / "20271" / "latest").resolve()

    code, runner, _ = refresh(tmp_path, runner=FakeRunner(catalogs={"20271": catalog(CSCI=990)}), now=LATER)
    assert code == 1
    assert runner.steps("20271") == ["programs", "sections"]  # never reached load_courses, so nothing was pruned
    assert (tmp_path / "20271" / "latest").resolve() == first
    t = last_summary(tmp_path)["terms"]["20271"]
    assert t["failed_step"] == "guard" and "CHEM 30 of 30" in t["error"] and t["removed"] == 30
    assert runner.steps("20263") == ["programs", "sections", "load_courses"]  # the other term still loads

    code, runner, _ = refresh(tmp_path, "--allow-shrink", runner=FakeRunner(catalogs={"20271": catalog(CSCI=990)}),
                              now=datetime(2026, 11, 21, tzinfo=timezone.utc))
    assert code == 0 and "load_courses" in runner.steps("20271")


def test_cancelled_removals_load_and_show_in_the_history_line(tmp_path):
    refresh(tmp_path, runner=FakeRunner(catalogs={"20271": catalog(CSCI=970, CHEM=30)}))
    runner = FakeRunner(catalogs={"20271": catalog(CSCI=980)}, cancelled={"20271": [f"CHEM{i:03d}" for i in range(30)]})
    code, runner, _ = refresh(tmp_path, runner=runner, now=LATER)
    assert code == 0 and "load_courses" in runner.steps("20271")
    t = last_summary(tmp_path)["terms"]["20271"]
    assert (t["removed"], t["removed_cancelled"]) == (30, 30)
    line = (tmp_path / "logs" / "history.log").read_text().splitlines()[-1]
    assert "20271 ok 980 sections (-20; 30 removed, 30 of them cancelled by USC)" in line


def test_only_runs_skip_the_removal_guard(tmp_path):
    refresh(tmp_path, runner=FakeRunner(catalogs={"20271": catalog(CSCI=970, CHEM=30)}))
    code, runner, _ = refresh(tmp_path, "--only", "CSCI", runner=FakeRunner(catalogs={"20271": catalog(CSCI=970)}),
                              now=LATER)
    assert code == 0 and "load_courses" in runner.steps("20271")


def test_an_unreadable_catalog_is_not_loaded(tmp_path):
    refresh(tmp_path, runner=FakeRunner(catalogs={"20271": catalog(CSCI=100)}))
    code, runner, _ = refresh(tmp_path, runner=FakeRunner(sections={"20271": 100}, catalogs={"20271": [1, 2]}),
                              now=LATER)
    assert code == 1 and runner.steps("20271") == ["programs", "sections"]
    t = last_summary(tmp_path)["terms"]["20271"]
    assert t["failed_step"] == "guard" and "can't be read" in t["error"]


def test_stage2_failure_loads_nothing_and_skips_profs(tmp_path):
    code, runner, _ = refresh(tmp_path, runner=FakeRunner(fail={"sections"}))
    assert code == 1
    assert "load_courses" not in runner.steps() and "load_profs" not in runner.steps()
    assert not (tmp_path / "20271" / "latest").exists()
    summary = last_summary(tmp_path)
    assert summary["terms"]["20271"]["failed_step"] == "sections"
    assert summary["terms"]["20271"]["programs_failed"] == 1
    assert summary["profs"] == {"status": "skipped", "reason": "no term loaded"}


def test_one_failed_term_does_not_stop_the_next(tmp_path):
    code, runner, _ = refresh(tmp_path, runner=FakeRunner(fail={("programs", "20263")}))
    assert code == 1
    assert runner.steps("20271") == ["programs", "sections", "load_courses"]
    assert last_summary(tmp_path)["terms"]["20271"]["status"] == "ok"


def test_an_unexpected_error_in_one_term_is_contained_and_reported(tmp_path):
    class CorruptSummary(FakeRunner):
        def __call__(self, name, argv, timeout):
            rc = super().__call__(name, argv, timeout)
            if name == "sections" and term_of(argv) == "20263":
                out = Path(argv[argv.index("--out") + 1])
                out.with_name(out.stem + ".summary.json").write_text("{not json")
            return rc

    code, runner, _ = refresh(tmp_path, runner=CorruptSummary())
    summary = last_summary(tmp_path)
    assert code == 1 and summary["terms"]["20263"]["failed_step"] == "orchestrator"
    assert summary["terms"]["20271"]["status"] == "ok"


def test_load_failure_keeps_latest_where_it_was(tmp_path):
    code, runner, _ = refresh(tmp_path, runner=FakeRunner(fail={"load_courses"}))
    assert code == 1 and not (tmp_path / "20271" / "latest").exists()
    assert last_summary(tmp_path)["terms"]["20271"]["failed_step"] == "load_courses"


def test_no_db_scrapes_and_moves_latest_without_loading(tmp_path):
    runner = FakeRunner()
    code = rsr.main(["refresh", "--runs-dir", str(tmp_path), "--terms", "20271", "--no-db"],
                    env={}, api=FakeApi(), runner_factory=runner.factory, now=NOW)  # no DB env needed
    assert code == 0
    assert runner.steps() == ["programs", "sections"]
    assert (tmp_path / "20271" / "latest").is_symlink()
    assert last_summary(tmp_path)["profs"] == {"status": "skipped", "reason": "--no-db"}


def test_only_is_a_smoke_run_that_never_prunes_or_moves_latest(tmp_path):
    refresh(tmp_path, runner=FakeRunner(sections={"20271": 1000}))
    first = (tmp_path / "20271" / "latest").resolve()
    # 5 sections would trip the shrink guard on a full run.
    code, runner, _ = refresh(tmp_path, "--only", "CSCI", runner=FakeRunner(sections={"20271": 5}), now=LATER)
    assert code == 0
    sections = next(argv for name, argv in runner.calls if name == "sections" and term_of(argv) == "20271")
    assert sections[-2:] == ["--only", "CSCI"]
    load = next(argv for name, argv in runner.calls if name == "load_courses" and term_of(argv) == "20271")
    assert "--prune" not in load
    assert (tmp_path / "20271" / "latest").resolve() == first
    assert last_summary(tmp_path)["terms"]["20271"]["partial"] is True


def test_profs_failure_fails_the_run_after_terms_loaded(tmp_path):
    code, _, _ = refresh(tmp_path, runner=FakeRunner(fail={"load_profs"}))
    summary = last_summary(tmp_path)
    assert code == 1 and all(t["status"] == "ok" for t in summary["terms"].values())
    assert {"event": "profs_failed", "exit_code": 1} in summary["events"]


def test_new_term_event_reaches_the_summary(tmp_path):
    refresh(tmp_path, "--skip-profs", api=FakeApi(["20263", "20271"]))
    refresh(tmp_path, "--skip-profs", api=FakeApi(["20263", "20271", "20272"]), now=LATER)
    assert {"event": "new_term", "term": "20272"} in last_summary(tmp_path)["events"]


def test_probe_failure_refreshes_nothing(tmp_path):
    code, runner, _ = refresh(tmp_path, api=FakeApi(error="HTTP 503"))
    assert code == 1 and runner.calls == []
    assert last_summary(tmp_path)["events"][0]["event"] == "probe_failed"


def test_config_and_preflight_errors_exit_2_before_any_request(tmp_path):
    api = FakeApi()
    assert rsr.main(["refresh", "--runs-dir", str(tmp_path)], env={}, api=api, now=NOW) == 2
    assert rsr.main(["refresh", "--runs-dir", str(tmp_path), "--terms", "20271"], env={}, api=api, now=NOW) == 2
    assert api.calls == 0


def test_a_second_run_exits_3_while_the_lock_is_held(tmp_path):
    with rsr.run_lock(tmp_path) as held:
        assert held
        code, runner, api = refresh(tmp_path)
    assert code == 3 and api.calls == 0 and runner.calls == []
    assert refresh(tmp_path)[0] == 0  # released afterwards


# ─── load_courses.py (fake cursor; the real SQL is checked against Postgres by hand) ──

class FakeCursor:
    def __init__(self, stale_course_ids=()):
        self.executed = []
        self.rowcount = 0
        self._next_id = 0
        self._stale = [(i,) for i in stale_course_ids]

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))
        self.rowcount = 2 if sql.lstrip().startswith("DELETE") else 0

    def fetchone(self):
        self._next_id += 1
        return (self._next_id,)

    def fetchall(self):
        return self._stale

    def statements(self, prefix):
        return [(s, p) for s, p in self.executed if s.startswith(prefix)]


def catalog_with_an_invalid_section():
    return {"CHEM 105A": {"title": "General Chemistry", "has_bundled_sections": True, "sections": [
        {"sectionNumber": "17218", "units": "4.0", "type": "Lecture", "schedule": "TBA", "registered": {}},
        {"sectionNumber": "17220", "units": "0.0", "type": "Quiz", "schedule": "TBA", "registered": {},
         "parent_section_number": "17218"},
        {"sectionNumber": "17299", "units": "4.0", "type": None, "schedule": "TBA"},  # invalid: no type
    ]}}


def test_an_invalid_section_is_skipped_and_counted_not_a_crash():
    cur = FakeCursor()
    stats = load_courses.load_catalog(cur, catalog_with_an_invalid_section(), "20271", log=lambda *_: None)
    assert stats["invalid_sections_skipped"] == 1
    assert stats["sections"] == 2 and stats["parent_links"] == 1


def test_parent_links_are_cleared_before_they_are_relinked():
    cur = FakeCursor()
    load_courses.load_catalog(cur, catalog_with_an_invalid_section(), "20271", log=lambda *_: None)
    clear, link = cur.statements("UPDATE sections")
    assert "= NULL" in clear[0] and "SELECT id FROM sections" in link[0]
    assert not cur.statements("DELETE")  # no pruning unless asked


def test_prune_deletes_only_what_the_catalog_no_longer_has():
    cur = FakeCursor(stale_course_ids=[41])
    stats = load_courses.load_catalog(cur, catalog_with_an_invalid_section(), "20271", prune=True,
                                      log=lambda *_: None)
    deletes = cur.statements("DELETE")
    assert deletes[0][1] == (1, ["17218", "17220"])            # this course's sections not in the file
    assert deletes[1][1] == ([41],) and deletes[2][1] == ([41],)  # then stale courses' sections, then courses
    select = cur.statements("SELECT id FROM courses")[0]
    assert select[1][0] == "20271" and list(select[1][1]) == ["CHEM 105A"]  # scoped to this semester
    assert stats["sections_pruned"] == 2 and stats["courses_pruned"] == 2


def test_prune_refuses_an_empty_catalog_before_touching_the_db(tmp_path, monkeypatch):
    empty = tmp_path / "usc_20271_courses.json"
    empty.write_text("{}")
    monkeypatch.setattr(load_courses.psycopg2, "connect", lambda **kw: pytest.fail("connected"))
    with pytest.raises(ValueError, match="refusing to prune"):
        load_courses.main(["--json-file", str(empty), "--prune"])


# ─── load_profs.py ───────────────────────────────────────────────────────────

def test_load_profs_takes_several_catalogs_and_dedupes_instructors():
    args = load_profs.parse_args(["--json-file", "a.json", "b.json"])
    assert args.json_file == ["a.json", "b.json"]
    a = {"X 1": {"sections": [{"instructors": ["Ada Lovelace ", "Alan Turing"]}]}}
    b = {"Y 2": {"sections": [{"instructors": ["Ada Lovelace", ""]}, {"instructors": None}]}}
    assert load_profs.collect_instructors([a, b]) == {"Ada Lovelace", "Alan Turing"}


@pytest.mark.parametrize("total,ok,fatal,code", [(10, 3, False, 0), (10, 0, False, 1), (0, 0, False, 0),
                                                  (10, 9, True, 1)])
def test_load_profs_exit_code(total, ok, fatal, code):
    assert load_profs.exit_code(total, ok, fatal) == code


# ─── Phase 5: the DB preflight ───────────────────────────────────────────────

def test_preflight_opens_one_db_connection_with_the_loaders_defaults(db_connects):
    assert rsr.preflight(False, True, DB_ENV) == []
    assert db_connects == [{"dbname": "usc_sched", "user": "u", "password": "p", "host": "localhost",
                            "port": 5432, "connect_timeout": rsr.DB_CONNECT_TIMEOUT}]
    db_connects.clear()
    env = {**DB_ENV, "USC_DB_HOST": "172.18.0.2", "USC_DB_PORT": "5433", "USC_DB_NAME": "other"}
    assert rsr.preflight(False, True, env) == []
    assert db_connects[0]["host"] == "172.18.0.2" and db_connects[0]["port"] == 5433
    assert db_connects[0]["dbname"] == "other"


def test_no_db_and_missing_credentials_never_connect(db_connects):
    assert rsr.preflight(True, False, {}) == []
    assert len(rsr.preflight(False, True, {})) == 1  # just the missing credentials
    assert db_connects == []


def test_an_unreachable_db_is_a_config_error_before_any_usc_request(tmp_path, db_connects):
    db_connects.error = Exception('connection to server at "172.18.0.2", port 5432 failed: Connection refused\n'
                                  '\tIs the server running on that host and accepting TCP/IP connections?')
    code, runner, api = refresh(tmp_path, "--skip-profs", env={"USC_DB_HOST": "172.18.0.2"})
    assert code == 2 and api.calls == 0 and runner.calls == []
    [event] = last_summary(tmp_path)["events"]
    assert event == {"event": "config_failed", "problems": [
        "can't connect to Postgres at 172.18.0.2:5432: connection to server at \"172.18.0.2\", port 5432 "
        "failed: Connection refused"]}


def test_a_db_error_never_carries_the_password(db_connects):
    db_connects.error = Exception("bad things with p4ssw0rd-xyz in them")
    [problem] = rsr.preflight(False, True, {**DB_ENV, "USC_DB_PASSWORD": "p4ssw0rd-xyz"})
    assert "p4ssw0rd-xyz" not in problem and "<redacted>" in problem


def test_a_bad_port_is_reported_not_a_crash():
    [problem] = rsr.preflight(False, True, {**DB_ENV, "USC_DB_PORT": "five"})
    assert problem.startswith("can't connect to Postgres at localhost:five")


# ─── Phase 5: the profs command ──────────────────────────────────────────────

def profs(tmp_path, *extra, runner=None, env=None, now=LATER):
    runner, api = runner or FakeRunner(), FakeApi()
    argv = ["profs", "--runs-dir", str(tmp_path), "--terms", "20263,20271", *extra]
    code = rsr.main(argv, env={**DB_ENV, **(env or {})}, api=api, runner_factory=runner.factory, now=now)
    assert api.calls == 0  # profs never asks USC anything
    return code, runner


def test_profs_runs_load_profs_over_each_terms_latest_catalog(tmp_path):
    refresh(tmp_path, "--skip-profs")
    code, runner = profs(tmp_path)
    assert code == 0 and runner.steps() == ["load_profs"]
    [(_, argv)] = runner.calls
    stamp = NOW.strftime(rsr.STAMP_FORMAT)
    expected = [str((tmp_path / t / stamp / f"usc_{t}_courses.json").resolve()) for t in ("20263", "20271")]
    assert argv[argv.index("--json-file") + 1:] == expected
    summary = last_summary(tmp_path)
    assert summary["command"] == "profs" and summary["exit_code"] == 0 and summary["events"] == []
    assert summary["profs"] == {"status": "ok", "exit_code": 0} and summary["missing_terms"] == []
    assert list(summary["catalogs"]) == ["20263", "20271"]
    assert runner.log_path == tmp_path / "logs" / f"{LATER.strftime(rsr.STAMP_FORMAT)}.log"


def test_profs_skips_a_term_with_no_catalog_and_names_it(tmp_path):
    rsr.main(["refresh", "--runs-dir", str(tmp_path), "--terms", "20271", "--skip-profs"], env=DB_ENV,
             api=FakeApi(), runner_factory=FakeRunner().factory, now=NOW)
    code, runner = profs(tmp_path)
    assert code == 0
    [(_, argv)] = runner.calls
    assert [a for a in argv if a.endswith("_courses.json")] == [
        str((tmp_path / "20271" / NOW.strftime(rsr.STAMP_FORMAT) / "usc_20271_courses.json").resolve())]
    assert last_summary(tmp_path)["missing_terms"] == ["20263"]


def test_profs_with_no_catalog_at_all_is_a_config_error(tmp_path):
    code, runner = profs(tmp_path)
    assert code == 2 and runner.calls == []
    [event] = last_summary(tmp_path)["events"]
    assert event["event"] == "config_failed" and "run `refresh` first" in event["problems"][-1]


def test_profs_needs_node_and_the_rmp_cli(tmp_path, monkeypatch):
    refresh(tmp_path, "--skip-profs")
    monkeypatch.setattr(rsr.shutil, "which", lambda name: None)
    code, runner = profs(tmp_path)
    assert code == 2 and runner.calls == []
    assert "`node` is not on PATH" in last_summary(tmp_path)["events"][0]["problems"][0]


def test_profs_failure_exits_1_with_an_event(tmp_path):
    refresh(tmp_path, "--skip-profs")
    code, _ = profs(tmp_path, runner=FakeRunner(fail={"load_profs"}))
    assert code == 1 and last_summary(tmp_path)["events"] == [{"event": "profs_failed", "exit_code": 1}]


def test_profs_respects_the_lock(tmp_path):
    refresh(tmp_path, "--skip-profs")
    with rsr.run_lock(tmp_path):
        code, runner = profs(tmp_path)
    assert code == 3 and runner.calls == []
