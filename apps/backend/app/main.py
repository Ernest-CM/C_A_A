from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import ASCENDING, DESCENDING

import httpx

from app.api.router import api_router
from app.core.config import settings
from app.services.mongo import get_db


def create_app() -> FastAPI:
    app = FastAPI(title="Departmental Study Buddy API")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["*"] ,
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    @app.on_event("startup")
    async def _startup() -> None:
        db = get_db()
        await db.users.create_index([("email", ASCENDING)], unique=True)
        await db.files.create_index([("user_id", ASCENDING), ("deleted_at", ASCENDING), ("created_at", DESCENDING)])
        await db.extracted_pages.create_index([("user_id", ASCENDING), ("file_id", ASCENDING), ("page_number", ASCENDING)])

    @app.get("/health")
    async def health() -> dict[str, object]:
        ollama_url = getattr(settings, "ollama_url", None)
        ollama_model = getattr(settings, "ollama_model", None)

        ollama_reachable = False
        if ollama_url:
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    res = await client.get(f"{ollama_url.rstrip('/')}/api/tags")
                    ollama_reachable = res.status_code == 200
            except Exception:
                ollama_reachable = False

        return {
            "status": "ok",
            "ollama": {
                "url": ollama_url,
                "model": ollama_model,
                "reachable": ollama_reachable,
            },
        }

    return app


app = create_app()
