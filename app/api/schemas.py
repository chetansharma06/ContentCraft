from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


ContentStatus = Literal[
    "GENERATED",
    "QC_PASSED",
    "QC_FLAGGED",
    "APPROVED",
    "REJECTED",
    "PUBLISHED",
]


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


class ProductRead(APIModel):
    id: int
    name: str
    price: float
    description: str
    specifications: dict[str, Any]
    keywords: list[str]


class RejectedRowRead(BaseModel):
    row_number: int
    data: dict[str, Any]
    reasons: list[str]


class ProductUploadResponse(BaseModel):
    inserted_count: int
    products: list[ProductRead]
    rejected_rows: list[RejectedRowRead]


class JobCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_ids: list[int] = Field(min_length=1)
    category: Literal["beauty", "fashion", "home_kitchen"] = "home_kitchen"
    language: str = "English"
    tones: list[Literal[
        "warm and approachable",
        "confident and concise",
        "bright and energetic",
    ]] | None = Field(default=None, min_length=1)
    content_angles: list[Literal["feature-led", "emotional", "price-value"]] | None = Field(
        default=None,
        min_length=1,
    )


class JobRead(APIModel):
    id: int
    product_id: int
    status: str
    progress: int
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class JobBatchResponse(BaseModel):
    jobs: list[JobRead]


class ContentListItem(APIModel):
    id: int
    product_id: int
    title: str
    body: str
    keywords: list[str]
    version: int
    approval_status: ContentStatus
    created_at: datetime
    language: str | None = None
    content_type: Literal["product_description"] = "product_description"
    generation_context: dict[str, str] = Field(default_factory=dict)


class ContentEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=100)
    body: str | None = Field(default=None, min_length=1)
    keywords: list[str] | None = None


class ContentVersionRead(APIModel):
    version: int
    snapshot: dict[str, Any]
    created_at: datetime


class QCRead(APIModel):
    status: str
    score: float | None
    issues: list[str]
    checked_at: datetime


class QCRulesRead(BaseModel):
    banned_brand_terms: list[str]
    prohibited_claims: list[str]


class ContentDetail(ContentListItem):
    generation_job_id: int | None
    image_urls: list[str]
    versions: list[ContentVersionRead]
    latest_qc: QCRead | None
    qc_rules: QCRulesRead


class RejectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)
    reviewed_by: str = Field(default="system", min_length=1, max_length=200)


class ContentStatusResponse(BaseModel):
    content_id: int
    status: ContentStatus


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_ids: list[int] = Field(min_length=1)
    destination: Literal["csv", "shopify", "woocommerce"] = "csv"


class AuditRead(APIModel):
    id: int
    action: str
    entity_type: str
    entity_id: str | None
    details: dict[str, Any]
    created_at: datetime


class RecentJobRead(APIModel):
    id: int
    product_id: int
    product_name: str
    status: str
    progress: int
    error: str | None
    created_at: datetime
    completed_at: datetime | None


class OverviewRead(BaseModel):
    status_counts: dict[str, int]
    qc_passed: int
    qc_flagged: int
    recent_jobs: list[RecentJobRead]
    recent_events: list[AuditRead]