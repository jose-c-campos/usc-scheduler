# backend/app/scrapers/usc_courses.py
"""
Scrape each *program page* that was discovered by usc_programs.py and extract
(course-code, title, units). Works with the HTML saved via “Save Page As →
Complete Web Page”, i.e. the file layout you uploaded (Angular content already
rendered).

Usage
-----
python -m backend.app.scrapers.usc_courses 20253 \
       --programs-json programs_20253.json \
       --sleep 0.2
"""

from __future__ import annotations
import json, time, argparse
from pathlib import Path
from typing import Dict, List
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    )
}
TIMEOUT = 25


# ────────────────────────────────────────────────────────────
# HTML helpers
# ────────────────────────────────────────────────────────────
def _clean(txt: str | None) -> str:
    return (txt or "").replace("\xa0", " ").strip()


def parse_program_html(html: str) -> List[dict]:
    """
    Given the full HTML of ONE program page, return a list of
    {'code': 'CSCI 100', 'title': 'Explorations in Computing', 'units': '4.0'}.
    """
    soup = BeautifulSoup(html, "html.parser")
    courses: List[dict] = []

    # Each course lives in a <mat-expansion-panel-header …>
    for hdr in soup.select("mat-expansion-panel-header"):
        code_title = hdr.select_one("mat-panel-title .item-description")
        units_el   = hdr.select_one(".course-units")

        if code_title is None:
            continue

        full = _clean(code_title.text)
        # Split "CSCI 100 - Explorations in Computing"
        if " - " in full:
            code, title = full.split(" - ", 1)
        else:
            parts = full.split(" ", 1)
            code = parts[0]
            title = parts[1] if len(parts) == 2 else ""

        units_raw = _clean(units_el.text) if units_el else ""
        units     = units_raw.split(" ")[0] if units_raw else None

        courses.append({"code": code, "title": title, "units": units})

    return courses


def fetch_html(url: str) -> str:
    """Download and return HTML for a remote page."""
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


# ────────────────────────────────────────────────────────────
# Main crawl routine
# ────────────────────────────────────────────────────────────
def crawl_all(program_pages: Dict[str, str], sleep: float = 0.3) -> Dict[str, List[dict]]:
    """
    program_pages: {"CSCI": "https://classes.…/program/CSCI/school/ENGR", …}
                   (can also point at local *.html* files)
    Returns:       {"CSCI": [ {code, title, units}, …], …}
    """
    catalogue: Dict[str, List[dict]] = {}

    for subj, page in sorted(program_pages.items()):
        print(f"📄 {subj:<5}", end=" … ")

        try:
            if page.startswith("http"):
                html = fetch_html(page)
            else:
                html = Path(page).read_text(encoding="utf-8")

            courses = parse_program_html(html)
            catalogue[subj] = courses
            print(f"{len(courses):>3} classes")

        except Exception as exc:
            print("FAILED:", exc)

        time.sleep(sleep)

    return catalogue


def load_program_index(path: str) -> Dict[str, str]:
    """programs_20253.json → {'CSCI': 'https://…/CSCI/…', …}"""
    with open(path, "r") as fh:
        records = json.load(fh)          # list[dict(code, school, href)]
    return {r["code"].upper(): r["href"] for r in records}


# ────────────────────────────────────────────────────────────
# CLI entry-point
# ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("term", help="term code, e.g. 20253")
    ap.add_argument("--programs-json", default="programs_20253.json",
                    help="file produced by usc_programs.py")
    ap.add_argument("--sleep", type=float, default=0.25,
                    help="delay between page fetches (seconds)")
    args = ap.parse_args()

    pages = load_program_index(args.programs_json)
    print(f"Loaded {len(pages)} programs from {args.programs_json}\n")

    catalogue = crawl_all(pages, sleep=args.sleep)

    out_path = Path(f"usc_{args.term}_courses.json")
    out_path.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False))
    print(f"\n✅  Saved course catalogue → {out_path.resolve()}")
