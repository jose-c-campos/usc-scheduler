from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.database import get_db          # async dependency
from ....services import scheduler            # the DFS + ranking module

router = APIRouter(prefix="/schedules", tags=["schedules"])

@router.get("/", summary="Get ranked schedules")
async def get_schedules(
    courses: str = Query(..., examples="CSCI201,EE109"),
    term: str    = Query(..., examples="20253"),
    limit: int   = Query(10, ge=1, le=50),
    rating_w: float = Query(3.0, alias="w_rating"),
    take_again_w: float = Query(1.0, alias="w_take_again"),
    difficulty_w: float = Query(1.0, alias="w_difficulty"),
    morning: Optional[bool] = Query(None, description="true / false / omit"),
    db: AsyncSession = Depends(get_db),
):
    ranking_weights = {
        "w_overall_rating": rating_w,
        "w_take_again": take_again_w,
        "w_difficulty": difficulty_w,
        "prefer_morning": morning,
    }

    ses = db.sync_session if hasattr(db, "sync_session") else db

    # convert AsyncSession ➜ regular Session for pure-sync algorithm
    schedules = scheduler.generate(
        ses,
        course_codes=[c.strip() for c in courses.split(",")],
        term=term,
        max_results=limit,
        ranking_weights=ranking_weights,
    )

    # crude serializer so the endpoint is testable
    def dump(b):
        return {
            "section_id": b.lecture.section_id,
            "course": f"{b.lecture.course.dept}{b.lecture.course.number}",
            "prof": b.lecture.professor.name,
            "days": b.lecture.days,
            "start": b.lecture.start_time.isoformat(timespec="minutes"),
            "end": b.lecture.end_time.isoformat(timespec="minutes"),
        }

    return [
        [dump(bundle) for bundle in schedule]   # one schedule = list of bundles
        for schedule in schedules
    ]
