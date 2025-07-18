import app.models
import pytest
from datetime import time as dt_time 
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from ..models.base import Base
from ..core.database import get_session         # the real factory
from ..models import course, section, professor  # import after Base is ready

# ─── fast in-memory engine ────────────────────────────────────
_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},   # ★ allow cross-thread use
    poolclass=StaticPool
)
_TestSession = sessionmaker(bind=_engine, expire_on_commit=False)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=_engine)
    session = _TestSession()

    # ↓↓↓  seed a minimal catalogue  ↓↓↓
    add_test_rows(session)

    yield session

    session.close()
    Base.metadata.drop_all(bind=_engine)


def add_test_rows(session):
    """Insert 2 courses, each with 2 lecture bundles."""
    prof1 = professor.Professor(name="Ada Lovelace", dept="CSCI")
    prof2 = professor.Professor(name="Alan Turing", dept="CSCI")
    c201 = course.Course(dept="CSCI", number="201", title="Data Structures")
    c109 = course.Course(dept="EE",   number="109", title="Intro to Embedded Sys")

    # CSCI-201  lecture A
    lec_201a = section.Section(
        term_code="20253",
        component="LEC",
        days="MWF",
        start_time=dt_time.fromisoformat("09:00"),   # ← was "09:00"
        end_time=dt_time.fromisoformat("09:50"),     # ← was "09:50"
        section_id="29900",
        course=c201,
        professor=prof1,
    )

    lab_201a = section.Section(
        term_code="20253",
        component="LAB",
        days="T",
        start_time=dt_time.fromisoformat("10:00"),
        end_time=dt_time.fromisoformat("11:50"),
        section_id="29901",
        course=c201,
        professor=prof1,
        parent_id=None,          # keep None for now
    )
    # …and likewise for lec_201b, lab_201b, lec_109 …
    lec_201b = section.Section(
        term_code="20253",
        component="LEC",
        days="TTh",
        start_time=dt_time.fromisoformat("14:00"),
        end_time=dt_time.fromisoformat("15:15"),
        section_id="29910",
        course=c201,
        professor=prof2,
    )

    lab_201b = section.Section(
        term_code="20253",
        component="LAB",
        days="W",
        start_time=dt_time.fromisoformat("16:00"),
        end_time=dt_time.fromisoformat("17:50"),
        section_id="29911",
        course=c201,
        professor=prof2,
    )

    lec_109 = section.Section(
        term_code="20253",
        component="LEC",
        days="MWF",
        start_time=dt_time.fromisoformat("11:00"),
        end_time=dt_time.fromisoformat("11:50"),
        section_id="30300",
        course=c109,
        professor=prof2,
    )


    session.add_all([prof1, prof2, c201, c109,
                     lec_201a, lab_201a, lec_201b, lab_201b, lec_109])
    session.commit()
