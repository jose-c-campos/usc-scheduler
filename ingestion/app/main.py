from fastapi import FastAPI
from .api.v1 import api_router

app = FastAPI(title="USC WebReg Scheduler API")
app.include_router(api_router, prefix="/v1")
