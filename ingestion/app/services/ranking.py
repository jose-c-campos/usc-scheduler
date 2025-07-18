from statistics import mean, median
from datetime import time as dt_time
from typing import List, Optional, TYPE_CHECKING
if TYPE_CHECKING:
    from .scheduler import Bundle

def score(schedule: List["Bundle"],
          *,
          w_overall_rating=3.0,
          w_take_again=1.0,
          w_difficulty=1.0,
          w_course_rating=2.0,
          w_morning=1.0,           # set to 0 if no pref
          w_lecture_style=1.0,     # +1 for short, –1 for long (or vice-versa)
          w_time_on_campus=1.0,
          w_free_days=1.0,
          prefer_morning: Optional[bool] = None,   # True, False, or None
          prefer_long_lectures: Optional[bool] = None,
) -> float: 
    lectures = [b.lecture for b in schedule]

    # RateMyPrfessor Aggregates
    overall  = mean([lec.professor.current_rating or 0 for lec in lectures])
    take_pct = mean([lec.professor.take_again or 0 for lec in lectures])
    diff_raw = mean([lec.professor.difficulty or 0 for lec in lectures])
    difficulty = 5 - diff_raw    # invert: higher difficulty => lower score

    # 2) Course-specific rating (fallback to overall)
    course_rates = [
        getattr(lec.professor, "course_ratings", {}).get(
            lec.course_id, lec.professor.current_rating or 0
        ) for lec in lectures
    ]
    course_rating = mean(course_rates)

    # 3) Morning / afternoon preference
    earliest = min(blk.start_time for b in schedule for blk in b.all_blocks)
    latest   = max(blk.end_time   for b in schedule for blk in b.all_blocks)
    morning_bonus = 0
    if prefer_morning is True  and latest <= dt_time(12,0): morning_bonus = 1
    if prefer_morning is False and earliest >= dt_time(12,0): morning_bonus = 1
    if prefer_morning is False and earliest <  dt_time(9,0):  morning_bonus = -1
    if prefer_morning is True  and latest   >  dt_time(17,0): morning_bonus = -1

    # 4) Lecture-style preference
    avg_len = mean([
        (blk.end_time.hour*60+blk.end_time.minute) -
        (blk.start_time.hour*60+blk.start_time.minute)
        for lec in lectures for blk in [lec]            # lecture block itself
    ])
    style_bonus = (1 if prefer_long_lectures else -1) if prefer_long_lectures is not None else 0
    style_score = style_bonus * avg_len / 60            # scale hours

     # 5) Time on campus and free days
    weekdays = set(d for b in schedule for d in b.lecture.days)
    free_days = 5 - len(weekdays)

    hours_on_campus = 0
    for day in weekdays:
        day_blocks = [
            (blk.start_time, blk.end_time)
            for b in schedule for blk in b.all_blocks
            if day in blk.days
        ]
        start = min(s for s,_ in day_blocks)
        end   = max(e for _,e in day_blocks)
        hours_on_campus += ((end.hour*60+end.minute) - (start.hour*60+start.minute)) / 60

    # 6) Weighted sum (higher better)
    return (
        w_overall_rating * overall +
        w_take_again     * (take_pct / 20) +         # 0–100 ➜ 0–5
        w_difficulty     * difficulty +
        w_course_rating  * course_rating +
        w_morning        * morning_bonus +
        w_lecture_style  * style_score +
        w_free_days      * free_days +
        w_time_on_campus * (-hours_on_campus)
    )