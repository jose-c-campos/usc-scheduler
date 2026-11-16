"""Stage 1: USC's program directory for a term → programs_<term>.json.

    cd ingestion
    python -m app.scrapers.scrape_programs --term 20271 \
        --out app/scraped_data/programs_20271.json

Output (same shape as the hand-built programs_20253.json it replaces), in the
order USC lists programs, one entry per (program, school) pair. A program
offered by two schools (e.g. ANAT: MEDK and DNTR) appears twice, as before:

    [{"code": "CSCI", "school": "ENGV", "name": "Computer Science",
      "href": "https://classes.usc.edu/term/20271/program/CSCI/school/ENGV"}, ...]

`href` is kept for compatibility and for humans. Stage 2 uses code + school.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .usc_api import BASE_URL, UscApi, UscApiError, normalize_term


def map_programs(api_programs: list[dict], term: str) -> list[dict]:
    """Raw /api/Programs/TermCode items → our programs_<term>.json entries."""
    term = normalize_term(term)
    out = []
    for p in api_programs:
        code = (p.get("prefix") or "").strip()
        name = " ".join((p.get("name") or "").split())
        schools = p.get("schools") or []
        if not code or not schools:
            raise UscApiError(f"program without a prefix or school: {p.get('prefix')!r} {p.get('name')!r}")
        for s in schools:
            school = (s.get("prefix") or "").strip()
            if not school:
                raise UscApiError(f"program {code}: school entry without a prefix")
            out.append({
                "code": code,
                "school": school,
                "name": name,
                "href": f"{BASE_URL}/term/{term}/program/{code}/school/{school}",
            })
    return out


def write_json_atomically(path: Path, data) -> None:
    """Write via a temp file + rename, so a crash never leaves a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


def main(argv=None, api: UscApi | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--term", required=True, help="USC term code, e.g. 20271")
    ap.add_argument("--out", required=True, help="output path, e.g. app/scraped_data/programs_20271.json")
    args = ap.parse_args(argv)

    term = normalize_term(args.term)
    api = api or UscApi()
    try:
        programs = map_programs(api.programs(term), term)
    except UscApiError as e:
        print(f"✖ {e}", file=sys.stderr)
        return 1
    if not programs:
        # An unpublished or unknown term. Never write an empty directory that
        # Stage 2 would then "successfully" turn into an empty catalog.
        print(f"✖ USC returned no programs for term {term}", file=sys.stderr)
        return 1

    write_json_atomically(Path(args.out), programs)
    schools = len({p["school"] for p in programs})
    print(f"✔ {len(programs)} program entries ({schools} schools) for {term} → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
