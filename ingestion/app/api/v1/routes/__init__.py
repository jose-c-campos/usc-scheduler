from fastapi import APIRouter
from ..routes.schedules import router as schedules_router

api_router = APIRouter()
api_router.include_router(schedules_router)
