"""Scrapers built on USC's JSON API (Phase 2). No network: a fake API stands in.

The fixture is real API output (fetched 2026-11-13), trimmed. The key contract
is that the strings we write are the ones load_courses.py already parses, so
several tests run our output through its parse_schedule().
"""
import copy
import json
from pathlib import Path

import pytest
import requests

from app.scrapers import scrape_programs, scrape_sections
from app.scrapers.scrape_programs import map_programs
from app.scrapers.scrape_sections import (
    assign_parents,
    format_schedule,
    format_time_range,
    format_units,
    map_course,
)
from app.scrapers.usc_api import UscApi, UscApiError, normalize_term
from database.load_courses import parse_schedule

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "usc_api_courses_sample.json").read_text())


def course(term, code):
    return copy.deepcopy(next(c for c in FIXTURE[term] if c["fullCourseName"] == code))


def mapped(term, code):
    return map_course(course(term, code))


def by_number(course_dict):
    return {s["sectionNumber"]: s for s in course_dict["sections"]}


# ─── time / schedule text (must match the old site text load_courses parses) ─

@pytest.mark.parametrize("start,end,text", [
    ("10:00", "11:50", "10:00-11:50 am"),
    ("14:00", "15:50", "2:00-3:50 pm"),
    ("12:00", "12:50", "12:00-12:50 pm"),      # noon is pm
    ("11:00", "12:20", "11:00 am-12:20 pm"),   # crosses noon: meridiem on both ends
    ("09:30", "12:20", "9:30 am-12:20 pm"),    # no leading zero
    ("00:30", "01:20", "12:30-1:20 am"),       # midnight hour
    ("18:00", "20:50:00", "6:00-8:50 pm"),     # tolerate seconds
])
def test_time_ranges_match_old_site_text(start, end, text):
    assert format_time_range(start, end) == text


@pytest.mark.parametrize("entries,text", [
    (None, "TBA"),
    ([], "TBA"),
    ([{"days": [], "startTime": "TBA", "endTime": "TBA"}], "TBA"),
    ([{"days": [], "startTime": None, "endTime": None}], "TBA"),
    ([{"days": ["Fri"], "startTime": "TBA", "endTime": "TBA"}], "Fri, TBA"),
    ([{"days": ["Mon", "Wed", "Fri"], "startTime": "09:00", "endTime": "09:50"}], "Mon, Wed, Fri, 9:00-9:50 am"),
    # same time on separate entries → one string, days merged
    ([{"days": ["Mon"], "startTime": "10:00", "endTime": "10:50"},
      {"days": ["Wed"], "startTime": "10:00", "endTime": "10:50"}], "Mon, Wed, 10:00-10:50 am"),
    # a TBA meeting next to a timed one is dropped (the old text was 'Tue, 6:00-7:50 pmTBA')
    ([{"days": ["Tue"], "startTime": "18:00", "endTime": "19:50"},
      {"days": [], "startTime": "TBA", "endTime": "TBA"}], "Tue, 6:00-7:50 pm"),
])
def test_format_schedule(entries, text):
    assert format_schedule(entries) == (text, False)


def test_different_meeting_times_keep_the_first_and_are_flagged():
    text, multi = format_schedule(course("20271", "CHEM 332")["sections"][0]["schedule"])
    assert (text, multi) == ("Tue, 10:00-11:50 am", True)


@pytest.mark.parametrize("text,parsed", [
    ("Mon, Wed, 10:00-11:50 am", (["Mon", "Wed"], "10:00 am", "11:50 am")),
    ("Tue, Thu, 11:00 am-12:20 pm", (["Tue", "Thu"], "11:00 am", "12:20 pm")),
    ("Fri, TBA", (["Fri"], None, None)),
    ("TBA", (None, None, None)),
])
def test_load_courses_parses_what_we_write(text, parsed):
    assert parse_schedule(text) == parsed


def test_every_fixture_schedule_survives_load_courses_parsing():
    for term in ("20271", "20253"):
        for c in FIXTURE[term]:
            for s in map_course(copy.deepcopy(c))[1]["sections"]:
                days, start, end = parse_schedule(s["schedule"])
                assert (start is None) == (end is None), s
                if start:
                    assert start.endswith(("am", "pm")) and end.endswith(("am", "pm")), s


@pytest.mark.parametrize("units,text", [
    (["4.0"], "4.0"),
    (["1.0", "2.0", "3.0", "4.0"], "1.0 - 4.0"),   # old site text for a range, with spaces
    (["2.0", "10.0", "1.0"], "1.0 - 10.0"),        # numeric, not string, min/max
    ([], ""),
    (None, ""),
])
def test_format_units(units, text):
    assert format_units(units) == text


def test_variable_units_from_real_data():
    _, c, _ = mapped("20271", "CSCI 590")
    assert c["sections"][0]["units"] == "1.0 - 12.0"


# ─── lab/quiz → lecture pairing rules ────────────────────────────────────────

def test_rules_1_and_2_chem_105a_quizzes_locked_labs_free():
    # The live page (screenshot 2026-11-13): Bertolini lecture + quiz are 'A',
    # Moon lecture + quiz are 'B', labs have no letter and go with either.
    _, c, edges = mapped("20271", "CHEM 105A")
    s = by_number(c)
    assert s["17220"]["parent_section_number"] == "17218"   # quiz A → Bertolini
    assert s["17221"]["parent_section_number"] == "17219"   # quiz B → Moon
    assert s["17232"]["parent_section_number"] is None      # labs pair with any lecture
    assert s["17222"]["parent_section_number"] is None
    assert s["17218"]["parent_section_number"] is None and s["17219"]["parent_section_number"] is None
    assert c["has_bundled_sections"] is True and edges == []


def test_rule_3_one_shared_letter_means_any_combination():
    _, c, edges = mapped("20271", "CSCI 102")   # 2 lectures, labs, quiz: all 'A'
    assert all(s["parent_section_number"] is None for s in c["sections"])
    assert c["has_bundled_sections"] is False and edges == []


def test_rule_4_shared_letter_with_other_letters_nests_and_is_reported():
    _, c, edges = mapped("20253", "CSCI 450")   # 'R': 1 lecture; 'Z': 2 lectures
    s = by_number(c)
    assert s["30503"]["parent_section_number"] == "30454"   # R → its only lecture (rule 1)
    assert s["30504"]["parent_section_number"] == "30500"   # Z → nearest Z lecture above
    assert s["30546"]["parent_section_number"] == "30545"
    assert [e["kind"] for e in edges] == ["shared_letter_multi_group"]
    assert edges[0]["code"] == "CSCI 450" and "30500" in edges[0]["note"]


def test_letter_with_no_lecture_gets_no_parent():
    secs = [{"sisSectionId": "1", "rnrMode": "Lab", "linkCode": "C"},
            {"sisSectionId": "2", "rnrMode": "Lecture", "linkCode": "A"}]
    assert assign_parents(secs) == ({"1": None, "2": None}, False)


def test_rule_4_uses_first_lecture_when_none_listed_above():
    secs = [{"sisSectionId": "q", "rnrMode": "Quiz", "linkCode": "Z"},
            {"sisSectionId": "l1", "rnrMode": "Lecture", "linkCode": "Z"},
            {"sisSectionId": "l2", "rnrMode": "Lecture", "linkCode": "Z"},
            {"sisSectionId": "l3", "rnrMode": "Lecture", "linkCode": "R"}]
    parents, rule_4 = assign_parents(secs)
    assert parents["q"] == "l1" and rule_4


# ─── map_course ──────────────────────────────────────────────────────────────

def test_output_has_the_load_courses_contract():
    code, c, _ = mapped("20271", "CHEM 105A")
    assert code == "CHEM 105A" and c["title"] == "General Chemistry"
    s = by_number(c)["17218"]
    assert s == {
        "sectionNumber": "17218", "units": "4.0", "type": "Lecture",
        "schedule": "Mon, Wed, Fri, 9:00-9:50 am", "location": "",
        "instructors": ["Thomas Bertolini"],
        "registered": {"current": 33, "capacity": 200},
        "d_clearance": False, "bundle_key": "A", "parent_section_number": None,
    }


def test_cross_listed_code_has_no_tag_and_titles_are_tidied():
    code, _, _ = mapped("20253", "CSCI 450")
    assert code == "CSCI 450"                        # the old scraper produced 'CSCI 450 (EE 450)'
    _, c, _ = mapped("20253", "CSCI 401")
    assert c["title"] == " ".join(c["title"].split()) and "  " not in c["title"]


def test_cancelled_and_typeless_sections_are_skipped_and_counted():
    raw = course("20271", "CHEM 105A")
    raw["sections"][0]["isCancelled"] = True
    raw["sections"][1]["rnrMode"] = None
    stats = {"cancelled_skipped": 0, "sections_skipped_missing_id_or_type": 0}
    _, c, _ = map_course(raw, stats)
    assert len(c["sections"]) == 4
    assert stats == {"cancelled_skipped": 1, "sections_skipped_missing_id_or_type": 1}


def test_multiple_meeting_times_are_reported():
    _, _, edges = mapped("20271", "CHEM 332")
    assert [(e["code"], e["kind"]) for e in edges] == [("CHEM 332", "multiple_meeting_times")]
    assert "17508" in edges[0]["note"]


def synthetic(code, *sections):
    """A minimal API course: sections as (id, type, link letter)."""
    return {"fullCourseName": code, "name": "t",
            "sections": [{"sisSectionId": i, "rnrMode": t, "linkCode": l} for i, t, l in sections]}


def test_mixed_lecture_types_are_reported():
    # Spring 2027 BUAD 307: standalone Lecture/Discussion sections next to Lecture + Discussion bundles.
    _, _, edges = map_course(synthetic("BUAD 307", ("14851", "Lecture/Discussion", None),
                                       ("14800", "Lecture", "J"), ("14802", "Discussion", "J")))
    assert edges == [{"code": "BUAD 307", "kind": "mixed_lecture_types",
                      "note": "Lecture ×1, Lecture/Discussion ×1"}]


def test_compound_lecture_letters_leave_children_unlocked_and_are_reported():
    _, c, edges = map_course(synthetic("X 1", ("1", "Lecture/Lab", "A"), ("2", "Lab", "A"),
                                       ("3", "Lecture/Lab", "B"), ("4", "Lab", "B")))
    assert all(s["parent_section_number"] is None for s in c["sections"])  # the gap itself
    assert [e["kind"] for e in edges] == ["compound_lecture_unlocked"]
    assert edges[0]["note"] == "sections 2 (Lab A), 4 (Lab B)"


def test_one_compound_letter_is_any_combination_and_not_reported():
    # Spring 2027 CHEM 115B / TAC 115: every lecture-like section shares one letter.
    _, _, edges = map_course(synthetic("TAC 115", ("1", "Lecture/Lab", "A"), ("2", "Lecture/Lab", "A"),
                                       ("3", "Quiz", "A"), ("4", "Lecture/Lab", None)))
    assert edges == []


def test_schema_change_fails_loudly():
    raw = course("20271", "CSCI 590")
    del raw["fullCourseName"]
    with pytest.raises(UscApiError):
        map_course(raw)


# ─── Stage 1 mapping ─────────────────────────────────────────────────────────

def test_map_programs_one_entry_per_school():
    api = [
        {"prefix": "ACCT", "name": "Accounting", "schools": [{"prefix": "ACTN"}]},
        {"prefix": "ANAT", "name": "Anatomy ", "schools": [{"prefix": "MEDK"}, {"prefix": "DNTR"}]},
    ]
    assert map_programs(api, "20271") == [
        {"code": "ACCT", "school": "ACTN", "name": "Accounting",
         "href": "https://classes.usc.edu/term/20271/program/ACCT/school/ACTN"},
        {"code": "ANAT", "school": "MEDK", "name": "Anatomy",
         "href": "https://classes.usc.edu/term/20271/program/ANAT/school/MEDK"},
        {"code": "ANAT", "school": "DNTR", "name": "Anatomy",
         "href": "https://classes.usc.edu/term/20271/program/ANAT/school/DNTR"},
    ]


def test_program_without_a_school_fails_loudly():
    with pytest.raises(UscApiError):
        map_programs([{"prefix": "XYZ", "name": "?", "schools": []}], "20271")


# ─── API client (fake transport) ─────────────────────────────────────────────

class FakeResponse:
    def __init__(self, status=200, payload=None, text=None):
        self.status_code, self._payload, self.url = status, payload, "https://classes.usc.edu/x"
        self.headers = {"content-type": "application/json" if text is None else "text/html"}
        self._text = text

    def json(self):
        if self._text is not None:
            raise ValueError("not json")
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls, self.headers = list(responses), [], {}

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def make_api(responses, delay=0.0):
    sleeps = []
    api = UscApi(session=FakeSession(responses), delay=delay, backoff=1.0,
                 sleep=sleeps.append, clock=lambda: 100.0)
    return api, sleeps


def test_retries_server_errors_and_timeouts_then_succeeds():
    api, sleeps = make_api([FakeResponse(503), requests.Timeout("slow"), FakeResponse(200, {"courses": []})])
    assert api.courses("20271", "DRNS", "CHEM") == []
    assert api.requests_made == 3 and sleeps == [1.0, 2.0]      # exponential backoff


def test_gives_up_after_retries():
    api, _ = make_api([FakeResponse(500)] * 4)
    with pytest.raises(UscApiError, match="after 4 attempts"):
        api.programs("20271")


def test_client_errors_are_not_retried():
    api, _ = make_api([FakeResponse(404)])
    with pytest.raises(UscApiError, match="404"):
        api.programs("20271")
    assert api.requests_made == 1


def test_non_json_200_fails_loudly():
    api, _ = make_api([FakeResponse(200, text="<html>")])
    with pytest.raises(UscApiError, match="not JSON"):
        api.programs("20271")


def test_requests_are_spaced_by_delay():
    api, sleeps = make_api([FakeResponse(200, [])] * 2, delay=0.5)
    api.programs("20271")
    api.programs("20271")
    assert sleeps == [0.5]   # frozen clock: the second call waits the full delay


def test_null_course_list_means_no_courses():
    api, _ = make_api([FakeResponse(200, {"courses": None})])
    assert api.courses("20271", "X", "Y") == []


def test_active_terms():
    payload = [{"termCode": 20271, "status": "Active"}, {"termCode": 20262, "status": "Active"},
               {"termCode": 20261, "status": "Archived"}]
    api, _ = make_api([FakeResponse(200, payload)])
    assert api.active_terms() == ["20262", "20271"]


@pytest.mark.parametrize("bad", ["2027", "202711", "abcde", None])
def test_normalize_term_rejects_non_codes(bad):
    with pytest.raises(ValueError):
        normalize_term(bad)


# ─── CLIs end to end (fake API) ──────────────────────────────────────────────

class StubApi:
    """Serves fixture courses per program; programs named in `fail` raise."""

    def __init__(self, courses_by_program, fail=(), programs=None):
        self.courses_by_program, self.fail, self._programs = courses_by_program, set(fail), programs
        self.requests_made = 0

    def courses(self, term, school, program):
        self.requests_made += 1
        if program in self.fail:
            raise UscApiError(f"{program}: HTTP 503 after 4 attempts")
        return copy.deepcopy(self.courses_by_program.get(program, []))

    def programs(self, term):
        self.requests_made += 1
        return self._programs


def write_programs(tmp_path, term="20271", codes=(("CHEM", "DRNS"), ("CSCI", "ENGV"))):
    path = tmp_path / f"programs_{term}.json"
    path.write_text(json.dumps([
        {"code": c, "school": s, "name": c, "href": f"https://classes.usc.edu/term/{term}/program/{c}/school/{s}"}
        for c, s in codes
    ]))
    return path


def chem_and_csci():
    return {"CHEM": [course("20271", "CHEM 105A"), course("20271", "CHEM 332")],
            "CSCI": [course("20271", "CSCI 102")]}


def test_stage_2_writes_catalog_and_summary(tmp_path):
    out = tmp_path / "usc_20271_courses.json"
    rc = scrape_sections.main(["--term", "20271", "--programs-json", str(write_programs(tmp_path)),
                               "--out", str(out)], api=StubApi(chem_and_csci()))
    assert rc == 0
    catalog = json.loads(out.read_text())
    assert sorted(catalog) == ["CHEM 105A", "CHEM 332", "CSCI 102"]
    summary = json.loads((tmp_path / "usc_20271_courses.summary.json").read_text())
    assert summary["programs_failed"] == [] and summary["courses"] == 3
    assert [e["code"] for e in summary["edge_cases"]] == ["CHEM 332"]


def test_stage_2_any_failed_program_means_no_catalog(tmp_path):
    out = tmp_path / "usc_20271_courses.json"
    rc = scrape_sections.main(["--term", "20271", "--programs-json", str(write_programs(tmp_path)),
                               "--out", str(out)], api=StubApi(chem_and_csci(), fail={"CSCI"}))
    assert rc == 1 and not out.exists()
    summary = json.loads((tmp_path / "usc_20271_courses.summary.json").read_text())
    assert [f["program"] for f in summary["programs_failed"]] == ["CSCI"]


def test_stage_2_same_program_under_two_schools_is_fetched_once_per_school_and_kept_once(tmp_path):
    out = tmp_path / "usc_20271_courses.json"
    api = StubApi({"CHEM": [course("20271", "CHEM 105A")]})
    progs = write_programs(tmp_path, codes=(("CHEM", "DRNS"), ("CHEM", "OTHR")))
    assert scrape_sections.main(["--term", "20271", "--programs-json", str(progs), "--out", str(out)], api=api) == 0
    assert api.requests_made == 2 and list(json.loads(out.read_text())) == ["CHEM 105A"]


def test_stage_2_refuses_a_programs_file_for_another_term(tmp_path):
    progs = write_programs(tmp_path, term="20263")
    rc = scrape_sections.main(["--term", "20271", "--programs-json", str(progs),
                               "--out", str(tmp_path / "usc_20271_courses.json")], api=StubApi({}))
    assert rc == 2


def test_stage_2_requires_the_basename_load_courses_reads(tmp_path):
    rc = scrape_sections.main(["--term", "20271", "--programs-json", str(write_programs(tmp_path)),
                               "--out", str(tmp_path / "catalog.json")], api=StubApi({}))
    assert rc == 2


def test_stage_2_only_filters_programs(tmp_path):
    out = tmp_path / "usc_20271_courses.json"
    api = StubApi(chem_and_csci())
    rc = scrape_sections.main(["--term", "20271", "--programs-json", str(write_programs(tmp_path)),
                               "--out", str(out), "--only", "csci"], api=api)
    assert rc == 0 and api.requests_made == 1 and list(json.loads(out.read_text())) == ["CSCI 102"]


def test_stage_1_writes_programs(tmp_path):
    out = tmp_path / "programs_20271.json"
    api = StubApi({}, programs=[{"prefix": "CHEM", "name": "Chemistry", "schools": [{"prefix": "DRNS"}]}])
    assert scrape_programs.main(["--term", "20271", "--out", str(out)], api=api) == 0
    assert json.loads(out.read_text())[0]["href"].endswith("/term/20271/program/CHEM/school/DRNS")


def test_stage_1_empty_term_writes_nothing(tmp_path):
    out = tmp_path / "programs_20281.json"
    assert scrape_programs.main(["--term", "20281", "--out", str(out)], api=StubApi({}, programs=[])) == 1
    assert not out.exists()
