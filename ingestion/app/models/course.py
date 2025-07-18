from __future__ import annotations 
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

class Course(Base):
    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dept: Mapped[str] = mapped_column(String(10), index=True)
    number: Mapped[str] = mapped_column(String(8), index=True)
    title: Mapped[str] = mapped_column(String(100), index=True)

    sections: Mapped[list["Section"]] = relationship("Section", back_populates="course", cascade="all, delete-orphan")
