from __future__ import annotations
from typing import Optional, List
from datetime import time as dt_time
from sqlalchemy import Integer, String, ForeignKey, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

class Section(Base):
    __tablename__ = "sections"

    id:         Mapped[int]     = mapped_column(Integer, primary_key=True)
    term_code:  Mapped[str]     = mapped_column(String(6), index=True)
    section_id: Mapped[str]     = mapped_column(String(6), index=True)
    component: Mapped[str]      = mapped_column(String(4))          # LEC / LAB / DIS
    days:       Mapped[str]     = mapped_column(String(7))          # MWF, etc.
    start_time: Mapped[dt_time] = mapped_column(Time)
    end_time:   Mapped[dt_time] = mapped_column(Time)
    location:    Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    seats_total: Mapped[Optional[int]] = mapped_column(Integer,    nullable=True)
    seats_open:  Mapped[Optional[int]] = mapped_column(Integer,    nullable=True)

    parent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("sections.id"), nullable=True
    )

    # FKs
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    prof_id:   Mapped[int] = mapped_column(ForeignKey("professors.id"))

    # ⬇ CHANGE: str → model names
    course:     Mapped["Course"]     = relationship("Course",     back_populates="sections")
    professor:  Mapped["Professor"]  = relationship("Professor",  back_populates="sections")
    children:   Mapped[List["Section"]] = relationship("Section", remote_side=[id])
