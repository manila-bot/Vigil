"""Vigil API. Run from backend/:  uvicorn app.main:app --reload --port 8000"""
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import config
from .db import init_db, now
from .routers import auth, demo, incidents, response, users
from .security import current_user


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield


app = FastAPI(title="Vigil API", version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
                       allow_methods=["GET", "POST", "PATCH"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


api = APIRouter(prefix="/api")


@api.get("/health")
def health():
    return {"ok": True, "time": now()}


@api.get("/system/status")
def system_status(user=Depends(current_user)):
    """What's live vs simulated — shown in the UI so nobody mistakes a mock for a real send."""
    return {
        "providers": {
            "nemotron": "live" if config.NEMOTRON_ENABLED else "disabled (mock triage)",
            "photon": "live" if config.PHOTON_ENABLED else "disabled (simulated alerts)",
        },
        "isolation": "Vigil uses its own accounts and database and does not depend on firm email, SSO or file "
                     "systems. External providers are optional and off by default.",
        "data": "All incidents, matters and logs in this demo are synthetic.",
        "server_time": now(),
    }


api.include_router(auth.router)
api.include_router(users.router)
api.include_router(incidents.router)
api.include_router(response.router)
api.include_router(demo.router)
app.include_router(api)


@app.exception_handler(404)
async def not_found(request: Request, exc):
    # Unknown /api routes stay JSON 404s; everything else falls back to the React app (client-side routing).
    path = request.url.path
    index = config.FRONTEND_DIST / "index.html"
    if not path.startswith("/api") and index.exists():
        candidate = (config.FRONTEND_DIST / path.lstrip("/")).resolve()
        if candidate.is_file() and config.FRONTEND_DIST.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)
    detail = getattr(exc, "detail", "Not found")
    return JSONResponse({"detail": detail}, status_code=404)
