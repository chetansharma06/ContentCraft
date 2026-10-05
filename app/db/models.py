from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    price: float = Field(default=0.0, ge=0)
    description: str = ""
    specifications: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    keywords: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utc_now)


class GenerationJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    prompt: str
    status: str = Field(default="pending", index=True)
    progress: int = Field(default=0, ge=0, le=100)
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=_utc_now)
    completed_at: Optional[datetime] = None


class ContentItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    generation_job_id: Optional[int] = Field(
        default=None,
        foreign_key="generationjob.id",
        index=True,
    )
    title: str
    body: str
    keywords: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    image_urls: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    generation_context: dict[str, str] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    version: int = Field(default=1, ge=1)
    approval_status: str = Field(default="GENERATED", index=True)
    created_at: datetime = Field(default_factory=_utc_now)


class ContentVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content_item_id: int = Field(foreign_key="contentitem.id", index=True)
    version: int = Field(ge=1)
    snapshot: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utc_now)


class QCResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content_item_id: int = Field(foreign_key="contentitem.id", index=True)
    status: str = Field(default="pending", index=True)
    score: Optional[float] = None
    issues: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    checked_at: datetime = Field(default_factory=_utc_now)


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    action: str = Field(index=True)
    entity_type: str = Field(index=True)
    entity_id: Optional[str] = None
    details: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    created_at: datetime = Field(default_factory=_utc_now)