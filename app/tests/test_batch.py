import asyncio
from collections import Counter
from pathlib import Path

import pytest
from sqlmodel import Session, SQLModel, create_engine, select
from tenacity import wait_fixed

from app.db.models import ContentItem, GenerationJob, Product
from app.generation.batch import BatchGenerationProcessor, DEFAULT_VARIANTS
from app.generation.schemas import ProductDescription
from app.ingestion import load_products

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class RecordingGenerator:
    def __init__(self, fail_name: str | None = None) -> None:
        self.fail_name = fail_name
        self.active_calls = 0
        self.max_active_calls = 0
        self.attempts: Counter[str] = Counter()

    async def generate_product_description(
        self,
        product: Product,
        category: str = "home_kitchen",
        tone: str | None = None,
        language: str | None = None,
        content_angle: str = "Emphasize the most relevant verified benefit.",
    ) -> ProductDescription:
        self.active_calls += 1
        self.max_active_calls = max(self.max_active_calls, self.active_calls)
        self.attempts[product.name] += 1
        try:
            await asyncio.sleep(0.01)
            if product.name == self.fail_name:
                raise RuntimeError("simulated provider failure")
            return ProductDescription(
                title=f"{product.name} in a {tone} voice",
                description=f"{product.name} described using verified product details.",
                key_features=["Verified product detail"],
                meta_description=f"Learn about {product.name} and its verified product details.",
            )
        finally:
            self.active_calls -= 1


@pytest.fixture
def sample_product_store(tmp_path):
    database_engine = create_engine(
        f"sqlite:///{tmp_path / 'batch.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(database_engine)

    def session_factory() -> Session:
        return Session(database_engine, expire_on_commit=False)

    products, rejected = load_products(PROJECT_ROOT / "data" / "sample_products.csv")
    assert not rejected
    with session_factory() as session:
        session.add_all(products)
        session.commit()
        for product in products:
            session.refresh(product)

    yield database_engine, session_factory, products
    database_engine.dispose()


def test_batch_processes_sample_products_with_limited_concurrency_and_persists(
    sample_product_store,
):
    database_engine, session_factory, products = sample_product_store
    generator = RecordingGenerator()
    processor = BatchGenerationProcessor(
        generator,
        session_factory=session_factory,
        max_concurrency=2,
        retry_attempts=1,
        retry_wait=wait_fixed(0),
    )

    result = asyncio.run(processor.process(products))

    assert generator.max_active_calls == 2
    assert len(result.products) == len(products)
    assert len(result.content_items) == len(products) * len(DEFAULT_VARIANTS)
    assert all(product_result.status == "completed" for product_result in result.products)
    with Session(database_engine) as session:
        jobs = session.exec(select(GenerationJob)).all()
        items = session.exec(select(ContentItem)).all()

    assert len(jobs) == len(products)
    assert all(job.progress == 100 for job in jobs)
    assert all(job.status == "completed" for job in jobs)
    assert len(items) == len(products) * len(DEFAULT_VARIANTS)
    assert {item.generation_context["content_angle"] for item in items} == {
        variant.content_angle for variant in processor.variants
    }
    assert {item.generation_context["tone"] for item in items} == {
        variant.tone for variant in DEFAULT_VARIANTS
    }


def test_failed_product_does_not_stop_batch_and_retries_are_bounded(
    sample_product_store,
):
    database_engine, session_factory, products = sample_product_store
    generator = RecordingGenerator(fail_name="Trail Bottle")
    processor = BatchGenerationProcessor(
        generator,
        session_factory=session_factory,
        max_concurrency=2,
        retry_attempts=2,
        retry_wait=wait_fixed(0),
    )

    result = asyncio.run(processor.process(products))

    assert len(result.failed_products) == 1
    assert result.failed_products[0].status == "failed"
    assert result.failed_products[0].progress == 100
    assert generator.attempts["Trail Bottle"] == len(DEFAULT_VARIANTS) * 2
    assert len(result.content_items) == (len(products) - 1) * len(DEFAULT_VARIANTS)
    with Session(database_engine) as session:
        jobs = session.exec(select(GenerationJob)).all()
        items = session.exec(select(ContentItem)).all()

    failed_job = next(job for job in jobs if job.product_id == result.failed_products[0].product_id)
    assert failed_job.progress == 100
    assert failed_job.status == "failed"
    assert "simulated provider failure" in failed_job.error
    assert len(items) == (len(products) - 1) * len(DEFAULT_VARIANTS)