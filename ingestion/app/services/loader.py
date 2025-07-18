from __future__ import annotations
"""Loader: translate SectionData objects into ORM rows.

This module is *synchronous* and expects a **sync** SQLAlchemy Session.  The
calling script (or FastAPI background task) should manage the session/commit.

Typical usage in scripts/scrape.py:

    from app.scrapers.usc import crawl_term
    from app.services.loader import bulk_upsert_sections
    from app.core.database import get_session

    with get_session() as db:
        secs = crawl_term("20253")
        stats = bulk_upsert_sections(db, secs, term_code="20253")
        db.commit()
        print(stats)
"""

from collections import Counter
from datetime import time as dt_time
from typing import Iterable, Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.course import Course
from app.models.professor import Professor
from app.models.section import Section
from backend.app.scrapers.usc_courses import SectionData

__all__ = ["bulk_upsert_sections"]

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_or_create_course(db: Session, sd: SectionData) -> Course:
    stmt = select(Course).where(
        Course.dept == sd.dept, Course.number == sd.course_number
    )
    course = db.scalar(stmt)
    if course is None:
        course = Course(dept=sd.dept, number=sd.course_number, title=sd.course_title)
        db.add(course)
    elif course.title != sd.course_title:
        course.title = sd.course_title  # keep latest catalogue title
    return course


def _get_or_create_prof(db: Session, sd: SectionData) -> Professor:
    # We only have name & dept; use those as a fuzzy key.
    stmt = select(Professor).where(
        Professor.name == sd.instructor, Professor.dept == sd.dept
    )
    prof = db.scalar(stmt)
    if prof is None:
        prof = Professor(name=sd.instructor, dept=sd.dept)
        db.add(prof)
    return prof


def _parse_time(t: dt_time | None) -> dt_time | None:
    # ORM column expects datetime.time or None; SectionData already uses that type.
    return t


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def bulk_upsert_sections(
    db: Session,
    sections: Iterable[SectionData],
    *,
    term_code: str,
) -> Mapping[str, int]:
    """Insert or update Course, Professor, Section rows.

    Returns a Counter‑like mapping of how many rows were *created* or *updated*.
    """
    stats: Counter[str] = Counter()

    for sd in sections:
        course = _get_or_create_course(db, sd)
        prof = _get_or_create_prof(db, sd)

        stmt = select(Section).where(
            Section.section_id == sd.section_id, Section.term_code == term_code
        )
        sec = db.scalar(stmt)

        if sec is None:
            sec = Section(
                term_code=term_code,
                section_id=sd.section_id,
                component=sd.component,
                days=sd.days,
                start_time=_parse_time(sd.start_time),
                end_time=_parse_time(sd.end_time),
                course=course,
                professor=prof,
            )
            db.add(sec)
            stats["sections_created"] += 1
        else:
            # Update mutable fields if they changed (location/seats omitted for now)
            changed = False
            for attr, new_val in [
                ("component", sd.component),
                ("days", sd.days),
                ("start_time", _parse_time(sd.start_time)),
                ("end_time", _parse_time(sd.end_time)),
            ]:
                if getattr(sec, attr) != new_val:
                    setattr(sec, attr, new_val)
                    changed = True
            if changed:
                stats["sections_updated"] += 1
    return stats
