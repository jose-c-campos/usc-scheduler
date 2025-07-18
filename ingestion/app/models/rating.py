# backend/app/models/rating.py
from __future__ import annotations 
from sqlalchemy import Integer, Float, DateTime, ForeignKey
from datetime import timezone
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
from .base import Base

class RatingSnapshot(Base):
    __tablename__ = "rating_snapshots"

    id:         Mapped[int]       = mapped_column(Integer, primary_key=True)
    fetched_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))   # tz-aware timestamp)
    rating:     Mapped[float]     = mapped_column(Float)
    take_again: Mapped[float]     = mapped_column(Float)
    difficulty: Mapped[float]     = mapped_column(Float)
    professor_id: Mapped[int]     = mapped_column(Integer, ForeignKey("professors.id", ondelete="CASCADE"), index=True)

    professor:     Mapped["Professor"] = relationship("Professor", back_populates="snapshots", foreign_keys=[professor_id])
