"""Stage 2: every course and section for a term → usc_<term>_courses.json.

    cd ingestion
    python -m app.scrapers.scrape_sections --term 20271 \
        --programs-json app/scraped_data/programs_20271.json \
        --out app/scraped_data/usc_20271_courses.json

One API request per program (about 2 s each) instead of driving Chrome through
every course panel. The output keeps the exact contract load_courses.py reads,
so the database side doesn't change. Keep the usc_<term>_courses.json basename:
load_courses.py takes the term from it.

Also writes <out stem>.summary.json: counts, failures, and edge cases worth a
human look (see EDGE_CASE_KINDS). The catalog is written only if every program
succeeded; on any failure the script exits 1 and leaves --out untouched.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

from .scrape_programs import write_json_atomically
from .usc_api import UscApi, UscApiError, normalize_term

EDGE_CASE_KINDS = {
    "shared_letter_multi_group": (
        "Several lectures share a link letter and the course has other letters too. "
        "Each section was locked to the lecture listed above it (stricter than USC: "
        "some valid combinations may be hidden)."
    ),
    "multiple_meeting_times": (
        "A section meets at different times on different days. Only the first meeting "
        "was kept, because the schedule column holds one time range."
    ),
    "mixed_lecture_types": (
        "The course has more than one lecture-like type (e.g. 'Lecture' and "
        "'Lecture/Discussion'), usually alternative formats. The C++ engine requires one "
        "section of every type, so it combines the formats: generated schedules carry an "
        "extra class, or some formats are never offered."
    ),
    "compound_lecture_unlocked": (
        "A section's link letter belongs to a compound lecture type ('Lecture/Lab', "
        "'Lecture/Discussion') and the course has several lecture letters. Only plain "
        "'Lecture' sections act as parents, so this section isn't locked and may be paired "
        "with the wrong lecture."
    ),
}


def is_lecture_like(rnr_mode: str) -> bool:
    """What the C++ engine anchors on: any type containing 'Lecture'."""
    return "Lecture" in rnr_mode


# ─── field formatting (the strings load_courses.py parses) ───────────────────

_CLOCK = re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$")


def is_clock_time(value) -> bool:
    """USC sends 'HH:MM' for real times and the literal 'TBA' (or null) otherwise."""
    return isinstance(value, str) and bool(_CLOCK.match(value.strip()))


def format_time(hhmm: str) -> tuple[str, str]:
    """'14:00' → ('2:00', 'pm'); '00:30' → ('12:30', 'am'). Accepts HH:MM[:SS]."""
    h, m = (int(x) for x in hhmm.split(":")[:2])
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValueError(f"bad time {hhmm!r}")
    return f"{(h - 1) % 12 + 1}:{m:02d}", ("am" if h < 12 else "pm")


def format_time_range(start: str, end: str) -> str:
    """'10:00','11:50' → '10:00-11:50 am'; '09:30','12:20' → '9:30 am-12:20 pm'.

    Matches the old scraper's text exactly: the meridiem is written once when
    both ends share it, on both ends otherwise.
    """
    (s, sm), (e, em) = format_time(start), format_time(end)
    return f"{s}-{e} {em}" if sm == em else f"{s} {sm}-{e} {em}"


def format_schedule(entries: list[dict] | None) -> tuple[str, bool]:
    """API schedule entries → ('Mon, Wed, 10:00-11:50 am', had_multiple_times).

    - No entries, or no days and no times → 'TBA'.
    - Days but no times → 'Fri, TBA' (as the old site text did).
    - Several entries with the same times → one string with the days merged.
    - A TBA entry next to timed ones is dropped.
    - Entries with genuinely different times → the first timed entry only,
      flagged so the caller can record it.
    """
    entries = entries or []
    timed = [e for e in entries if is_clock_time(e.get("startTime")) and is_clock_time(e.get("endTime"))]
    if not timed:
        days = [d for e in entries for d in (e.get("days") or [])]
        return (f"{', '.join(dict.fromkeys(days))}, TBA" if days else "TBA"), False

    times = list(dict.fromkeys((e["startTime"], e["endTime"]) for e in timed))
    first = times[0]
    days = [d for e in timed if (e["startTime"], e["endTime"]) == first for d in (e.get("days") or [])]
    days = list(dict.fromkeys(days))  # dedupe, keep order
    time_range = format_time_range(*first)
    text = f"{', '.join(days)}, {time_range}" if days else time_range
    return text, len(times) > 1


def format_units(units: list | None) -> str:
    """['4.0'] → '4.0'; ['1.0', …, '12.0'] → '1.0 - 12.0' (old site text); [] → ''."""
    vals = [str(u).strip() for u in (units or []) if str(u).strip()]
    if not vals:
        return ""
    if len(vals) == 1:
        return vals[0]
    nums = sorted(vals, key=float)
    return f"{nums[0]} - {nums[-1]}"


def format_instructors(instructors: list | None) -> list[str]:
    out = []
    for i in instructors or []:
        name = " ".join(f"{i.get('firstName') or ''} {i.get('lastName') or ''}".split())
        if name:
            out.append(name)
    return out


# ─── lab/quiz/discussion → lecture pairing ───────────────────────────────────

def assign_parents(sections: list[dict]) -> tuple[dict[str, str | None], bool]:
    """Work out each section's parent lecture from USC's link letters.

    Agreed rule (verified against the live CHEM 105A page, 2026-11-13):
      1. letter matches exactly one lecture  → locked to that lecture
      2. no letter                           → no parent (pairs with any lecture)
      3. 2+ lectures share the course's only letter → no parent (any combination)
      4. 2+ lectures share a letter and the course has other letters
         → nearest lecture *above* it with that letter (as the page nests it)
    A letter with no lecture at all → no parent.

    Returns ({sisSectionId: parent sisSectionId or None}, hit_rule_4).
    The C++ engine discards a lecture that ends up with no labs of a required
    type, so rule 2 matters: the old row-order scraper attached every shared
    lab to the last lecture and hid the others.
    """
    lectures_by_letter: dict[str, list[str]] = defaultdict(list)
    letters = set()
    for s in sections:
        letter = s.get("linkCode")
        if letter:
            letters.add(letter)
            if s.get("rnrMode") == "Lecture":
                lectures_by_letter[letter].append(s["sisSectionId"])

    parents: dict[str, str | None] = {}
    hit_rule_4 = False
    last_lecture_by_letter: dict[str, str] = {}
    for s in sections:
        sid, letter = s["sisSectionId"], s.get("linkCode")
        if s.get("rnrMode") == "Lecture":
            parents[sid] = None
            if letter:
                last_lecture_by_letter[letter] = sid
            continue
        candidates = lectures_by_letter.get(letter, []) if letter else []
        if len(candidates) == 1:                       # rule 1
            parents[sid] = candidates[0]
        elif len(candidates) >= 2 and len(letters) > 1:  # rule 4
            parents[sid] = last_lecture_by_letter.get(letter, candidates[0])
            hit_rule_4 = True
        else:                                           # rules 2 and 3, letter without a lecture
            parents[sid] = None
    return parents, hit_rule_4


# ─── course mapping ──────────────────────────────────────────────────────────

def map_course(api_course: dict, stats: dict | None = None) -> tuple[str, dict, list[dict]]:
    """One API course → (code, our course dict, edge cases).

    Raises UscApiError if the course is missing keys we rely on (a schema
    change, which must fail loudly). Problems with a single section's values
    are counted in `stats` and the section is skipped.
    """
    stats = stats if stats is not None else defaultdict(int)
    try:
        code = " ".join(api_course["fullCourseName"].split())
        title = " ".join((api_course["name"] or "").split())
        raw_sections = api_course["sections"] or []
    except (KeyError, AttributeError, TypeError) as e:
        raise UscApiError(f"course missing an expected field ({e}): {str(api_course)[:200]}") from e
    if not code:
        raise UscApiError(f"course with an empty fullCourseName: {str(api_course)[:200]}")

    live = []
    for s in raw_sections:
        if s.get("isCancelled"):
            stats["cancelled_skipped"] += 1
            continue
        if not s.get("sisSectionId") or not s.get("rnrMode"):
            # load_courses.py would abort the whole load on a section without a type.
            stats["sections_skipped_missing_id_or_type"] += 1
            continue
        live.append(s)

    parents, hit_rule_4 = assign_parents(live)
    edge_cases = []
    if hit_rule_4:
        groups = defaultdict(list)
        for s in live:
            if s.get("rnrMode") == "Lecture" and s.get("linkCode"):
                groups[s["linkCode"]].append(s["sisSectionId"])
        detail = "; ".join(f"{k}: lectures {', '.join(v)}" for k, v in sorted(groups.items()))
        edge_cases.append({"code": code, "kind": "shared_letter_multi_group", "note": detail})

    lecture_types = defaultdict(int)
    for s in live:
        if is_lecture_like(s["rnrMode"]):
            lecture_types[s["rnrMode"]] += 1
    if len(lecture_types) > 1:
        edge_cases.append({"code": code, "kind": "mixed_lecture_types",
                           "note": ", ".join(f"{t} ×{n}" for t, n in sorted(lecture_types.items()))})

    lecture_letters = {s["linkCode"] for s in live if s.get("linkCode") and is_lecture_like(s["rnrMode"])}
    compound_letters = {s["linkCode"] for s in live
                        if s.get("linkCode") and is_lecture_like(s["rnrMode"]) and s["rnrMode"] != "Lecture"}
    unlocked = [s for s in live if not is_lecture_like(s["rnrMode"]) and s.get("linkCode") in compound_letters
                and parents[s["sisSectionId"]] is None]
    if unlocked and len(lecture_letters) > 1:
        edge_cases.append({"code": code, "kind": "compound_lecture_unlocked", "note": "sections " + ", ".join(
            f"{s['sisSectionId']} ({s['rnrMode']} {s['linkCode']})" for s in unlocked)})

    sections = []
    for s in live:
        schedule, multi = format_schedule(s.get("schedule"))
        if multi:
            all_times = "; ".join(
                f"{','.join(e.get('days') or [])} {e.get('startTime')}-{e.get('endTime')}"
                for e in s.get("schedule") or []
            )
            edge_cases.append({"code": code, "kind": "multiple_meeting_times",
                               "note": f"section {s['sisSectionId']}: {all_times} → kept '{schedule}'"})
        current, capacity = s.get("registeredSeats"), s.get("totalSeats")
        if current is None or capacity is None:
            stats["sections_missing_seat_counts"] += 1
        sections.append({
            "sectionNumber": str(s["sisSectionId"]),
            "units": format_units(s.get("units")),
            "type": s["rnrMode"],
            "schedule": schedule,
            "location": "",  # TODO: rooms need a USC login ("Sign In to View"); not in the public API
            "instructors": format_instructors(s.get("instructors")),
            "registered": {"current": current, "capacity": capacity},
            "d_clearance": bool(s.get("hasDClearance")),
            "bundle_key": s.get("linkCode"),  # USC's link letter; unused by the engine today
            "parent_section_number": parents[s["sisSectionId"]],
        })

    course = {
        "title": title,
        "sections": sections,
        "has_bundled_sections": any(x["parent_section_number"] for x in sections),
    }
    return code, course, edge_cases


# ─── the run ─────────────────────────────────────────────────────────────────

def load_programs(path: Path, term: str) -> list[dict]:
    programs = json.loads(path.read_text())
    if not isinstance(programs, list) or not programs:
        raise ValueError(f"{path}: expected a non-empty list of programs")
    for p in programs:
        if not p.get("code") or not p.get("school"):
            raise ValueError(f"{path}: program entry without code/school: {p}")
        # Guard against pairing one term's directory with another term's scrape.
        if f"/term/{term}/" not in (p.get("href") or ""):
            raise ValueError(f"{path}: entry {p['code']} is not for term {term} (href {p.get('href')!r})")
    return programs


def scrape(api: UscApi, term: str, programs: list[dict], log=print) -> tuple[dict, dict]:
    """Fetch and map every program. Returns (catalog, summary). Never raises for one program."""
    term = normalize_term(term)
    started = time.monotonic()
    catalog: dict[str, dict] = {}
    stats: dict = defaultdict(int)
    edge_cases: list[dict] = []
    failures: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for i, p in enumerate(programs, 1):
        key = (p["code"], p["school"])
        if key in seen:
            continue
        seen.add(key)
        try:
            api_courses = api.courses(term, p["school"], p["code"])
            mapped = [map_course(c, stats) for c in api_courses]
        except UscApiError as e:
            failures.append({"program": p["code"], "school": p["school"], "error": str(e)})
            log(f"[{i:3}/{len(programs)}] {p['code']:<6} {p['school']:<5} ✖ {e}")
            continue
        n_sections = 0
        for code, course, edges in mapped:
            n_sections += len(course["sections"])
            if code in catalog:
                # Same course listed under two schools/programs (e.g. ANAT). Keep the first.
                if catalog[code] != course:
                    stats["duplicate_courses_differing"] += 1
                stats["duplicate_courses_skipped"] += 1
                continue
            catalog[code] = course
            edge_cases.extend(edges)
        log(f"[{i:3}/{len(programs)}] {p['code']:<6} {p['school']:<5} {len(mapped):4} courses {n_sections:5} sections")

    sections = [s for c in catalog.values() for s in c["sections"]]
    summary = {
        "term": term,
        "programs_total": len(seen),
        "programs_failed": failures,
        "courses": len(catalog),
        "sections": len(sections),
        "sections_with_parent": sum(1 for s in sections if s["parent_section_number"]),
        "courses_with_bundles": sum(1 for c in catalog.values() if c["has_bundled_sections"]),
        "requests": api.requests_made,
        "runtime_seconds": round(time.monotonic() - started, 1),
        **dict(sorted(stats.items())),
        "edge_case_kinds": EDGE_CASE_KINDS,
        "edge_cases": edge_cases,
    }
    return catalog, summary


def summary_path(out: Path) -> Path:
    return out.with_name(out.stem + ".summary.json")


def main(argv=None, api: UscApi | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--term", required=True, help="USC term code, e.g. 20271")
    ap.add_argument("--programs-json", required=True, help="programs_<term>.json from scrape_programs.py")
    ap.add_argument("--out", required=True, help="output path; keep the usc_<term>_courses.json basename")
    ap.add_argument("--delay", type=float, default=0.5, help="minimum seconds between requests (default 0.5)")
    ap.add_argument("--only", help="comma-separated program codes to scrape (smoke tests), e.g. CHEM,CSCI")
    args = ap.parse_args(argv)

    term = normalize_term(args.term)
    out = Path(args.out)
    if f"usc_{term}_courses" not in out.name:
        print(f"✖ --out must be named usc_{term}_courses.json (load_courses.py reads the term from it)", file=sys.stderr)
        return 2
    try:
        programs = load_programs(Path(args.programs_json), term)
    except (OSError, ValueError) as e:
        print(f"✖ {e}", file=sys.stderr)
        return 2
    if args.only:
        wanted = {c.strip().upper() for c in args.only.split(",") if c.strip()}
        programs = [p for p in programs if p["code"] in wanted]
        if not programs:
            print(f"✖ none of {sorted(wanted)} are in {args.programs_json}", file=sys.stderr)
            return 2

    api = api or UscApi(delay=args.delay)
    catalog, summary = scrape(api, term, programs)
    write_json_atomically(summary_path(out), summary)

    print(f"\n{summary['courses']} courses, {summary['sections']} sections, "
          f"{summary['requests']} requests in {summary['runtime_seconds']} s")
    for kind in EDGE_CASE_KINDS:
        hits = [e for e in summary["edge_cases"] if e["kind"] == kind]
        if hits:
            print(f"⚠ {len(hits)} edge case(s) '{kind}': {', '.join(sorted({e['code'] for e in hits}))}")
    if summary["programs_failed"]:
        print(f"✖ {len(summary['programs_failed'])} program(s) failed; {out} NOT written. "
              f"See {summary_path(out)}", file=sys.stderr)
        return 1
    if not catalog:
        print(f"✖ no courses scraped; {out} NOT written", file=sys.stderr)
        return 1
    write_json_atomically(out, catalog)
    print(f"✔ {out}  (summary: {summary_path(out)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
