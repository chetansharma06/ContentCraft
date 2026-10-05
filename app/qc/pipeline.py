"""Run and persist product-content quality checks before approval."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from sqlmodel import Session, select

from app.db.models import ContentItem, Product, QCResult
from app.db.session import engine
from app.qc.brand import check_brand_terms
from app.qc.compliance import DEFAULT_PROHIBITED_CLAIMS, check_prohibited_claims
from app.qc.duplicates import check_duplicates
from app.qc.factcheck import check_product_facts
from app.qc.language import check_language
from app.qc.seo import check_seo
from app.qc.structure import QCCheckResult, check_structure

BRAND_VOICE_PATH = Path(__file__).resolve().parents[1] / "prompts" / "brand_voice.yaml"
SessionFactory = Callable[[], Session]


def _default_session_factory() -> Session:
    return Session(engine)


@dataclass
class QCReport:
    status: str
    score: float
    checks: list[QCCheckResult]
    issues: list[str]
    result_id: int | None = None


class QCPipeline:
    def __init__(
        self,
        session_factory: SessionFactory = _default_session_factory,
        brand_voice_path: str | Path = BRAND_VOICE_PATH,
        duplicate_threshold: float = 0.85,
        seo_minimum_coverage: float = 0.5,
        banned_brand_terms: Sequence[str] | None = None,
        required_brand_terms: Sequence[str] | None = None,
        prohibited_claims: Sequence[str] | None = None,
    ) -> None:
        if not 0.0 <= duplicate_threshold <= 1.0:
            raise ValueError("duplicate_threshold must be between 0 and 1")
        if not 0.0 <= seo_minimum_coverage <= 1.0:
            raise ValueError("seo_minimum_coverage must be between 0 and 1")

        with Path(brand_voice_path).open("r", encoding="utf-8") as file:
            brand_config = yaml.safe_load(file) or {}
        policy = brand_config.get("qc", {})
        if not isinstance(policy, dict):
            raise ValueError("Brand voice qc policy must be a YAML mapping")

        self.session_factory = session_factory
        self.duplicate_threshold = duplicate_threshold
        self.seo_minimum_coverage = seo_minimum_coverage
        self.banned_brand_terms = list(
            policy.get("banned_brand_terms", [])
            if banned_brand_terms is None
            else banned_brand_terms
        )
        self.required_brand_terms = list(
            policy.get("required_brand_terms", [])
            if required_brand_terms is None
            else required_brand_terms
        )
        self.prohibited_claims = list(
            policy.get("prohibited_claims", DEFAULT_PROHIBITED_CLAIMS)
            if prohibited_claims is None
            else prohibited_claims
        )

    def run(
        self,
        content: ContentItem,
        product: Product,
        requested_language: str = "English",
        existing_texts: Sequence[str] | None = None,
    ) -> QCReport:
        text = f"{content.title}\n{content.body}"
        checks = [
            check_structure(content),
            check_seo(
                text,
                content.keywords or product.keywords,
                minimum_coverage=self.seo_minimum_coverage,
            ),
            check_brand_terms(
                text,
                banned_terms=self.banned_brand_terms,
                required_terms=self.required_brand_terms,
            ),
            check_product_facts(text, product),
            check_prohibited_claims(text, self.prohibited_claims),
            check_language(text, requested_language),
        ]

        corpus = list(existing_texts) if existing_texts is not None else self._load_existing_texts(content.id)
        checks.insert(
            2,
            check_duplicates(text, corpus, threshold=self.duplicate_threshold),
        )
        passed = all(check.passed for check in checks)
        status = "QC_PASSED" if passed else "QC_FLAGGED"
        score = round(sum(check.score for check in checks) / len(checks), 2)
        issues = [issue for check in checks for issue in check.issues]

        if content.id is None:
            raise ValueError("Content must be saved before QC can be persisted")
        with self.session_factory() as session:
            stored_content = session.get(ContentItem, content.id)
            if stored_content is None:
                raise ValueError("Content item was not found in the database")
            qc_result = QCResult(
                content_item_id=content.id,
                status=status,
                score=score,
                issues=issues,
            )
            stored_content.approval_status = status
            session.add(qc_result)
            session.add(stored_content)
            session.commit()
            session.refresh(qc_result)

        return QCReport(status, score, checks, issues, qc_result.id)

    def approve_content(self, content_item_id: int) -> ContentItem:
        """Approve only when the latest persisted QC run passed every check."""
        with self.session_factory() as session:
            content = session.get(ContentItem, content_item_id)
            if content is None:
                raise ValueError("Content item was not found in the database")
            latest_qc = session.exec(
                select(QCResult)
                .where(QCResult.content_item_id == content_item_id)
                .order_by(QCResult.checked_at.desc(), QCResult.id.desc())
            ).first()
            if latest_qc is None or latest_qc.status != "QC_PASSED":
                raise ValueError("Content cannot be approved without a passing QC result")
            content.approval_status = "APPROVED"
            session.add(content)
            session.commit()
            session.refresh(content)
            return content

    def _load_existing_texts(self, exclude_id: int | None) -> list[str]:
        with self.session_factory() as session:
            query = select(ContentItem)
            if exclude_id is not None:
                query = query.where(ContentItem.id != exclude_id)
            items = session.exec(query).all()
            return [f"{item.title}\n{item.body}" for item in items]