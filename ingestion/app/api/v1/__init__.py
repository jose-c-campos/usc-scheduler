"""
v1 API package: exposes a single object:  `api_router`
so that `backend.app.main` can do:

    from .api.v1 import api_router
"""

from fastapi import APIRouter

# Import individual route modules
from .routes.schedules import router as schedules_router   # noqa: E402  (import after FastAPI)

# Compose them into one router that main.py can mount
api_router = APIRouter()
api_router.include_router(schedules_router)
