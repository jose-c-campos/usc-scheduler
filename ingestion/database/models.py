# backend/db/models.py
from sqlalchemy import (
    Column, Integer, String, Boolean, Numeric, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship, declarative_base

Base = declarative_base()

class Term(Base):
    __tablename__ = "terms"
    id   = Column(Integer, primary_key=True)
    code = Column(String, unique=True, nullable=False)   # 20253, 20261 …
    name = Column(String)

    courses = relationship("Course", back_populates="term")

class Course(Base):
    __tablename__ = "courses"
    id       = Column(Integer, primary_key=True)
    term_id  = Column(Integer, ForeignKey("terms.id"), nullable=False)
    code     = Column(String, nullable=False)            # AME 201
    title    = Column(String)

    term     = relationship("Term", back_populates="courses")
    sections = relationship("Section", back_populates="course")

    __table_args__ = (UniqueConstraint("term_id", "code"),)

class Section(Base):
    __tablename__ = "sections"
    id = Column(Integer, primary_key=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    number = Column(String, nullable=False)
    units = Column(Numeric)
    type = Column(String)
    schedule = Column(String)
    location = Column(String)
    d_clearance = Column(Boolean, default=False)
    instructors = Column(ARRAY(String))
    num_students_enrolled = Column(Integer)
    num_seats = Column(Integer)
    
    # New fields for section bundling
    parent_section_id = Column(Integer, ForeignKey("sections.id"), nullable=True)
    bundle_key = Column(String, nullable=True)
    
    # Relationships
    course = relationship("Course", back_populates="sections")
    child_sections = relationship("Section", 
                                backref=backref("parent_section", remote_side=[id]),
                                foreign_keys=[parent_section_id])

class SectionInstructor(Base):
    __tablename__ = "section_instructors"
    section_id = Column(Integer, ForeignKey("sections.id"), primary_key=True)
    name       = Column(String, primary_key=True)
