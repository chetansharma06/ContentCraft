from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import ContentItem, Product
from app.qc.brand import check_brand_terms
from app.qc.compliance import check_prohibited_claims
from app.qc.duplicates import check_duplicates
from app.qc.factcheck import check_product_facts
from app.qc.language import check_language
from app.qc.pipeline import QCPipeline
from app.qc.seo import check_seo
from app.qc.structure import check_structure

PROJECT_ROOT = Path(__file__).resolve().parents[2]
VALID_BODY = (
    "This reusable Trail Bottle has a stainless steel body and a listed capacity "
    "of 750 ml. Its listed price is $24.50. The bottle supports everyday hydration "
    "with details stated in the product specifications."
)


@pytest.fixture
def qc_store(tmp_path):
    database_engine = create_engine(
        f"sqlite:///{tmp_path / 'qc.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(database_engine)

    def session_factory() -> Session:
        return Session(database_engine, expire_on_commit=False)

    product = Product(
        name="Trail Bottle",
        price=24.5,
        description="Reusable stainless steel bottle",
        specifications={
            "capacity_ml": 750,
            "material": "stainless steel",
            "reusable": True,
        },
        keywords=["bottle", "hydration"],
    )
    with session_factory() as session:
        session.add(product)
        session.commit()
        session.refresh(product)
        content = ContentItem(
            product_id=product.id,
            title="Reusable Trail Bottle",
            body=VALID_BODY,
            keywords=["bottle", "hydration"],
        )
        session.add(content)
        session.commit()
        session.refresh(content)

    yield database_engine, session_factory, product, content
    database_engine.dispose()


def test_valid_content_passes_and_can_be_approved(qc_store):
    database_engine, session_factory, product, content = qc_store
    pipeline = QCPipeline(session_factory=session_factory)

    report = pipeline.run(content, product, existing_texts=[])

    assert report.status == "QC_PASSED"
    assert report.score == 100
    assert report.issues == []
    with Session(database_engine) as session:
        stored_content = session.get(ContentItem, content.id)
        assert stored_content.approval_status == "QC_PASSED"

    approved = pipeline.approve_content(content.id)
    assert approved.approval_status == "APPROVED"


def test_structure_seo_stuffing_and_brand_checks():
    assert check_structure({"title": "A title", "body": "Useful details"}).passed
    assert not check_structure({"title": "", "body": ""}).passed

    stuffed = check_seo("bottle " * 20, ["bottle"])
    assert not stuffed.passed
    assert any("stuffing" in issue for issue in stuffed.issues)

    missing_keyword = check_seo("Product details are clear.", ["bottle"])
    assert not missing_keyword.passed
    assert "bottle" in missing_keyword.issues[0]

    brand = check_brand_terms(
        "This miracle cure is risk-free.",
        banned_terms=["miracle cure", "risk-free"],
        required_terms=["Trail Bottle"],
    )
    assert not brand.passed
    assert len(brand.issues) == 3


def test_duplicate_content_uses_tfidf_cosine_similarity():
    text = (
        "A reusable stainless steel bottle with a listed 750 ml capacity for "
        "everyday hydration."
    )
    duplicate = check_duplicates(text, [text])
    distinct = check_duplicates(text, ["A compact reading lamp with adjustable light."])

    assert not duplicate.passed
    assert duplicate.details["similarity"] == pytest.approx(1.0)
    assert distinct.passed


def test_unsupported_claims_numbers_units_and_language_are_flagged(qc_store):
    _, _, product, _ = qc_store

    facts = check_product_facts(
        "Guaranteed to cure issues, with 900 litres of capacity and costs $99.",
        product,
    )
    assert not facts.passed
    assert any("900" in issue for issue in facts.issues)
    assert any("Unit litres" in issue for issue in facts.issues)
    assert any("99" in issue for issue in facts.issues)

    compliance = check_prohibited_claims("Guaranteed to cure issues.")
    assert not compliance.passed

    language = check_language(
        "Este producto es una botella reutilizable de acero inoxidable para uso diario.",
        "English",
    )
    assert not language.passed
    assert language.details["detected"] == "es"


def test_pipeline_flags_failures_and_prevents_approval(qc_store):
    _, session_factory, product, content = qc_store
    pipeline = QCPipeline(session_factory=session_factory)
    content.title = "Miracle Bottle guaranteed to cure"
    content.body = "Guaranteed cure: 900 litres for $99."
    content.keywords = ["bottle"]

    report = pipeline.run(
        content,
        product,
        requested_language="English",
        existing_texts=[f"{content.title}\n{content.body}"],
    )

    assert report.status == "QC_FLAGGED"
    assert report.score < 100
    with pytest.raises(ValueError, match="cannot be approved"):
        pipeline.approve_content(content.id)