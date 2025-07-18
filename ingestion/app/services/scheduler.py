# backend/app/services/scheduler.py
from __future__ import annotations
from dataclasses import dataclass
from datetime import time as dt_time
from collections import defaultdict
from typing import List, Dict
from sqlalchemy.orm import Session, joinedload
from ..models.section import Section
from .ranking import score

# ──────────────────────────────────────────────────────────────
# 1)  Helper dataclass to keep a lecture + its required LAB/DIS
# ----------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Bundle:
    lecture: Section
    extras: tuple[Section, ...] = ()

    @property
    def all_blocks(self) -> tuple[Section, ...]:
        return (self.lecture, *self.extras)


# ──────────────────────────────────────────────────────────────
# 2)  Basic overlap check  (same day AND overlapping clock span)
# ----------------------------------------------------------------
def _conflicts(a: Section, b: Section) -> bool:
    if set(a.days) & set(b.days):            # share at least one weekday
        return not (a.end_time <= b.start_time or b.end_time <= a.start_time)
    return False


# ──────────────────────────────────────────────────────────────
# 3)  Depth-first search with pruning
# ----------------------------------------------------------------
def _search(bundles_by_course: Dict[int, List[Bundle]], course_ids: List[int], idx: int, slate: List[Bundle], solutions: List[List[Bundle]], max_out: int) -> None:
    if len(solutions) >= max_out:
        return
    if idx == len(course_ids):
        solutions.append(slate.copy())
        return

    for bundle in bundles_by_course[course_ids[idx]]:
        # prune if any block collides with the current slate
        if any(
            _conflicts(block, s_block)
            for block in bundle.all_blocks
            for s in slate
            for s_block in s.all_blocks
        ):
            continue
        slate.append(bundle)
        _search(bundles_by_course, course_ids, idx + 1, slate, solutions, max_out)
        slate.pop()


# ──────────────────────────────────────────────────────────────
# 4)  Public API
# ----------------------------------------------------------------
def generate(db: Session, *, course_codes: list[str], term: str, max_results: int = 20, ranking_weights: dict | None=None) -> list[list[Bundle]]:
    """
    Return up to `max_results` non-conflicting schedules for the
    given list of course codes (e.g. ["CSCI201", "EE109"]) in a term.
    """
    ranking_weights = ranking_weights or {}

    # 1) Pull *all* sections for that term in one shot
    sections = (
        db.query(Section)
        .filter(Section.term_code == term)
        .options(
            joinedload(Section.professor),
            joinedload(Section.course),
        )
        .all()
    )

    # 2) Keep only the sections whose course code the user asked for
    wanted_sections = [
        sec for sec in sections
        if f"{sec.course.dept}{sec.course.number}" in course_codes
    ]

    # 3) Build lecture-bundles exactly like before
    bundles_by_course: dict[int, list[Bundle]] = defaultdict(list)
    for sec in wanted_sections:
        if sec.component != "LEC":
            continue
        extras = tuple(
            sorted(
                [child for child in wanted_sections if child.parent_id == sec.id],
                key=lambda s: s.section_id,
            )
        )
        bundles_by_course[sec.course_id].append(Bundle(sec, extras))

    # 4) Preserve user order & dedupe
    course_ids: list[int] = []
    seen: set[int] = set()
    for code in course_codes:
        for sec in wanted_sections:
            if f"{sec.course.dept}{sec.course.number}" == code:
                if sec.course_id not in seen:
                    course_ids.append(sec.course_id)
                    seen.add(sec.course_id)
                break

    # 5) DFS search
    solutions: list[list[Bundle]] = []
    _search(bundles_by_course, course_ids, 0, [], solutions, max_results)
    solutions.sort(key=lambda s: score(s, **ranking_weights), reverse=True)
    return solutions[:max_results]
