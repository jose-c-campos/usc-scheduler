from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.core.database import get_db
from .conftest import db_session as _mem_session_fixture
from .conftest import _engine, Base, add_test_rows
from sqlalchemy.orm import sessionmaker

SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
# ──────────────────────────────────────────────────────────────
# 1) Override the DB dependency *before* we spin up TestClient
# ──────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _override_db(_mem_session_fixture):
    async def _dummy_dep():
        db = SessionLocal()
        add_test_rows(db)  # seed minimal data
        db.commit()  # ensure data is committed
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _dummy_dep
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=_engine)


# ──────────────────────────────────────────────────────────────
# 2) Build the client only after overrides are in place
# ──────────────────────────────────────────────────────────────
@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_endpoint_returns_ranked_schedules(client):
    resp = client.get(
        "/v1/schedules/",
        params={
            "courses": "CSCI201,EE109",
            "term": "20253",
            "limit": 2,
            "w_rating": 5,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list) and len(data) == 2
    assert all(len(schedule) == 2 for schedule in data)
