from __future__ import annotations  
from typing import Optional
from sqlalchemy import String, Integer, Float
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

class Professor(Base):
    __tablename__ = "professors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    dept: Mapped[str] = mapped_column(String(10), index=True)
    rmp_slug: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    # Latest cached aggregate ratings
    current_rating:       Mapped[Optional[float]] = mapped_column(Float,   nullable=True)
    current_rating_count: Mapped[Optional[int]]   = mapped_column(Integer, nullable=True)
    take_again:           Mapped[Optional[float]] = mapped_column(Float,   nullable=True)
    difficulty:           Mapped[Optional[float]] = mapped_column(Float,   nullable=True)

    # Relationships
    sections: Mapped[list["Section"]] = relationship("Section", back_populates="professor")
    snapshots: Mapped[list["RatingSnapshot"]] = relationship("RatingSnapshot", back_populates="professor", cascade="all, delete-orphan",  foreign_keys="RatingSnapshot.professor_id")
