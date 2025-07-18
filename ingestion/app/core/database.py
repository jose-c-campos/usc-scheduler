# backend/app/core/database.py
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Generator, Final

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
)
from sqlalchemy.orm import Session, sessionmaker

from ..models.base import Base   # your declarative Base

# ──────────────────────────────────────────────────────────────
# 1) Configuration — sync and async URLs
#    env EXAMPLES:
#        postgresql+psycopg2://user:pass@localhost:5432/usc_sched
#        postgresql+asyncpg://user:pass@localhost:5432/usc_sched  ← async
#        sqlite:///./usc_sched.db                                 ← sync
#        sqlite+aiosqlite:///./usc_sched.db                       ← async
# ----------------------------------------------------------------
SYNC_DATABASE_URL: Final[str]  = os.getenv(
    "DATABASE_URL",
    "sqlite:///./usc_sched.db",
)
ASYNC_DATABASE_URL: Final[str] = (
    SYNC_DATABASE_URL.replace("postgresql+psycopg2", "postgresql+asyncpg")
                     .replace("sqlite:///", "sqlite+aiosqlite:///")
)

# ──────────────────────────────────────────────────────────────
# 2) Engines  & Session factories
# ----------------------------------------------------------------
sync_engine  = create_engine(
    SYNC_DATABASE_URL,
    future=True,
    echo=os.getenv("SQLALCHEMY_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
)
async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    future=True,
    echo=os.getenv("SQLALCHEMY_ECHO", "false").lower() == "true",
    pool_pre_ping=True,
)

SessionLocal:       sessionmaker[Session]     = sessionmaker(
    bind=sync_engine,
    expire_on_commit=False,
    autoflush=False,
    future=True,
)

AsyncSessionLocal:  async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=async_engine,
    expire_on_commit=False,
    autoflush=False,
    future=True,
)

# ──────────────────────────────────────────────────────────────
# 3) Helpers you’ll actually import elsewhere
# ----------------------------------------------------------------
def get_session() -> Session:
    """
    Synchronous session helper — perfect for unit tests or one-off scripts.

        with get_session() as db:
            ...
    """
    return SessionLocal()


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Async dependency for FastAPI:

        async def endpoint(db: AsyncSession = Depends(get_db)):
            ...
    """
    db = AsyncSessionLocal()
    try:
        yield db
    finally:
        await db.close()


def init_db() -> None:
    """
    Create all tables (idempotent). Call once during development
    or inside an Alembic 'offline' migration for SQLite demos.
    """
    Base.metadata.create_all(bind=sync_engine)
