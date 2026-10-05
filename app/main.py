from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.api.content import router as content_router
from app.api.jobs import router as jobs_router
from app.api.overview import router as overview_router
from app.api.products import router as products_router
from app.api.publish import router as publish_router
from app.api.review import router as review_router
from app.db.session import create_db


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_db()
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="ContentCraft API",
        version="1.0.0",
        description="Product content generation, quality control, review, and publishing.",
        lifespan=lifespan,
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