from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.content import router as content_router
from app.api.jobs import router as jobs_router
from app.api.overview import router as overview_router
from app.api.products import router as products_router
from app.api.publish import router as publish_router
from app.api.review import router as review_router
from app.core.config import settings
from app.db.session import create_db


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_db()
    yield


def create_app() -> FastAPI:
    default_origins = [
        f"http://{settings.FRONTEND_HOST}:{settings.FRONTEND_PORT}",
        f"http://localhost:{settings.FRONTEND_PORT}",
    ]
    allowed_origins = (
        [origin.strip() for origin in settings.CORS_ORIGINS.split(",") if origin.strip()]
        if settings.CORS_ORIGINS
        else default_origins
    )
    application = FastAPI(
        title="ContentCraft API",
        version="1.0.0",
        description="Product content generation, quality control, review, and publishing.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(products_router)
    application.include_router(jobs_router)
    application.include_router(content_router)
    application.include_router(review_router)
    application.include_router(publish_router)
    application.include_router(overview_router)

    @application.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return application


app = create_app()