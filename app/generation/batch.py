"""Asynchronous batch generation with bounded concurrency and persistence."""

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from sqlmodel import Session, select
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings
from app.db.models import ContentItem, ContentVersion, GenerationJob, Product
from app.db.session import engine
from app.generation.generator import ContentGenerator
from app.generation.schemas import ProductDescription


TONES = (
    "warm and approachable",
    "confident and concise",
    "bright and energetic",
)
CONTENT_ANGLES = (
    (
        "feature-led",
        "Lead with the strongest supplied product feature or specification.",
    ),
    (
        "emotional",
        "Connect the documented use to a relevant feeling without claiming outcomes.",
    ),
    (
        "price-value",
        "Present the supplied price alongside documented benefits without inventing savings or comparisons.",
    ),
)


@dataclass(frozen=True)
class GenerationVariant:
    name: str
    tone: str
    content_angle: str


DEFAULT_VARIANTS = tuple(
    GenerationVariant(name=f"{angle_name}-{tone.split()[0]}", tone=tone, content_angle=angle)
    for tone in TONES
    for angle_name, angle in CONTENT_ANGLES
)


def select_variants(
    tones: Sequence[str] | None = None,
    content_angles: Sequence[str] | None = None,
) -> tuple[GenerationVariant, ...]:
    selected_tones = set(TONES if tones is None else tones)
    available_angles = tuple(angle_name for angle_name, _ in CONTENT_ANGLES)
    selected_angles = set(available_angles if content_angles is None else content_angles)
    return tuple(
        variant
        for variant in DEFAULT_VARIANTS
        if variant.tone in selected_tones
        and variant.name.rsplit("-", maxsplit=1)[0] in selected_angles
    )


@dataclass
class ProductBatchResult:
    product_id: int | None
    job_id: int | None
    status: str
    progress: int
    content_items: list[ContentItem] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)


@dataclass
class BatchGenerationResult:
    products: list[ProductBatchResult]

    @property
    def content_items(self) -> list[ContentItem]:
        return [item for result in self.products for item in result.content_items]

    @property
    def failed_products(self) -> list[ProductBatchResult]:
        return [result for result in self.products if result.status == "failed"]


class DescriptionGenerator(Protocol):
    async def generate_product_description(
        self,
        product: Product,
        category: str = "home_kitchen",
        tone: str | None = None,
        language: str | None = None,
        content_angle: str = "Emphasize the most relevant verified benefit.",
    ) -> ProductDescription: ...


SessionFactory = Callable[[], Session]


def _default_session_factory() -> Session:
    return Session(engine)


class BatchGenerationProcessor:
    def __init__(
        self,
        generator: DescriptionGenerator | ContentGenerator,
        session_factory: SessionFactory = _default_session_factory,
        max_concurrency: int | None = None,
        retry_attempts: int = 3,
        retry_wait: Any | None = None,
        variants: Sequence[GenerationVariant] = DEFAULT_VARIANTS,
        category: str = "home_kitchen",
        language: str | None = None,
    ) -> None:
        selected_concurrency = (
            settings.MAX_CONCURRENCY
            if max_concurrency is None
            else max_concurrency
        )
        if selected_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1")
        if retry_attempts < 1:
            raise ValueError("retry_attempts must be at least 1")
        if not variants:
            raise ValueError("At least one generation variant is required")

        self.generator = generator
        self.session_factory = session_factory
        self.max_concurrency = selected_concurrency
        self.retry_attempts = retry_attempts
        self.retry_wait = retry_wait or wait_exponential(multiplier=0.2, max=2)
        self.variants = tuple(variants)
        self.category = category
        self.language = language

    async def process(
        self,
        products: Sequence[Product],
        job_ids: Sequence[int] | None = None,
    ) -> BatchGenerationResult:
        """Process products concurrently while isolating per-product failures."""
        if job_ids is not None and len(job_ids) != len(products):
            raise ValueError("job_ids must have one ID for each product")
        semaphore = asyncio.Semaphore(self.max_concurrency)
        outcomes = await asyncio.gather(
            *(
                self._process_product(
                    product,
                    semaphore,
                    job_ids[index] if job_ids is not None else None,
                )
                for index, product in enumerate(products)
            ),
            return_exceptions=True,
        )
        results: list[ProductBatchResult] = []
        for product, outcome in zip(products, outcomes):
            if isinstance(outcome, asyncio.CancelledError):
                raise outcome
            if isinstance(outcome, Exception):
                results.append(
                    ProductBatchResult(
                        product_id=product.id,
                        job_id=None,
                        status="failed",
                        progress=100,
                        failures=[str(outcome)],
                    )
                )
            else:
                results.append(outcome)
        return BatchGenerationResult(products=results)

    async def _process_product(
        self,
        product: Product,
        semaphore: asyncio.Semaphore,
        job_id: int | None = None,
    ) -> ProductBatchResult:
        async with semaphore:
            if product.id is None:
                return ProductBatchResult(
                    product_id=None,
                    job_id=None,
                    status="failed",
                    progress=100,
                    failures=["Product must be saved before batch generation"],
                )

            try:
                if job_id is None:
                    job_id = await asyncio.to_thread(self._create_job, product)
                else:
                    await asyncio.to_thread(self._start_job, job_id)
            except Exception as error:
                return ProductBatchResult(
                    product_id=product.id,
                    job_id=None,
                    status="failed",
                    progress=100,
                    failures=[f"Could not create generation job: {error}"],
                )

            saved_items: list[ContentItem] = []
            failures: list[str] = []
            for completed_count, variant in enumerate(self.variants, start=1):
                try:
                    description = await self._generate_with_retries(product, variant)
                    content_item = await asyncio.to_thread(
                        self._save_content_item,
                        product,
                        job_id,
                        variant,
                        description,
                    )
                    saved_items.append(content_item)
                except Exception as error:
                    failures.append(f"{variant.name}: {error}")

                progress = int(completed_count * 100 / len(self.variants))
                try:
                    await asyncio.to_thread(
                        self._update_job,
                        job_id,
                        progress=progress,
                        status="running",
                        error="\n".join(failures) or None,
                    )
                except Exception as error:
                    failures.append(f"Could not update job progress: {error}")

            if failures and saved_items:
                status = "completed_with_errors"
            elif failures:
                status = "failed"
            else:
                status = "completed"

            try:
                await asyncio.to_thread(
                    self._finish_job,
                    job_id,
                    status=status,
                    error="\n".join(failures) or None,
                )
            except Exception as error:
                failures.append(f"Could not finish generation job: {error}")
                status = "failed"

            return ProductBatchResult(
                product_id=product.id,
                job_id=job_id,
                status=status,
                progress=100,
                content_items=saved_items,
                failures=failures,
            )

    async def _generate_with_retries(
        self,
        product: Product,
        variant: GenerationVariant,
    ) -> ProductDescription:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(self.retry_attempts),
            wait=self.retry_wait,
            retry=retry_if_exception_type(Exception),
            reraise=True,
        ):
            with attempt:
                return await self.generator.generate_product_description(
                    product,
                    category=self.category,
                    tone=variant.tone,
                    language=self.language,
                    content_angle=variant.content_angle,
                )
        raise RuntimeError("Generation retries ended without a result")

    def _create_job(self, product: Product) -> int:
        angle_names = ", ".join(
            dict.fromkeys(variant.name.split("-")[0] for variant in self.variants)
        )
        tone_names = ", ".join(dict.fromkeys(variant.tone for variant in self.variants))
        prompt = (
            f"Generate {len(self.variants)} content variants using tones "
            f"{tone_names} and angles {angle_names}"
        )
        with self.session_factory() as session:
            job = GenerationJob(
                product_id=product.id,
                prompt=prompt,
                status="running",
                progress=0,
            )
            session.add(job)
            session.commit()
            session.refresh(job)
            return job.id

    def _start_job(self, job_id: int) -> None:
        with self.session_factory() as session:
            job = session.get(GenerationJob, job_id)
            if job is None:
                raise ValueError(f"Generation job {job_id} was not found")
            job.status = "running"
            job.progress = 0
            session.add(job)
            session.commit()

    def _save_content_item(
        self,
        product: Product,
        job_id: int,
        variant: GenerationVariant,
        description: ProductDescription,
    ) -> ContentItem:
        with self.session_factory() as session:
            item = ContentItem(
                product_id=product.id,
                generation_job_id=job_id,
                title=description.title,
                body=description.description,
                keywords=list(product.keywords),
                generation_context={
                    "variant": variant.name,
                    "tone": variant.tone,
                    "content_angle": variant.content_angle,
                    "language": self.language or "English",
                    "content_type": "product_description",
                },
            )
            session.add(item)
            session.flush()
            session.add(
                ContentVersion(
                    content_item_id=item.id,
                    version=1,
                    snapshot={
                        "title": item.title,
                        "body": item.body,
                        "keywords": list(item.keywords),
                        "generation_context": dict(item.generation_context),
                    },
                )
            )
            session.commit()
            session.refresh(item)
            return item

    def _update_job(
        self,
        job_id: int,
        progress: int,
        status: str,
        error: str | None,
    ) -> None:
        with self.session_factory() as session:
            job = session.exec(
                select(GenerationJob).where(GenerationJob.id == job_id)
            ).one()
            job.progress = progress
            job.status = status
            job.error = error
            session.add(job)
            session.commit()

    def _finish_job(self, job_id: int, status: str, error: str | None) -> None:
        with self.session_factory() as session:
            job = session.exec(
                select(GenerationJob).where(GenerationJob.id == job_id)
            ).one()
            job.progress = 100
            job.status = status
            job.error = error
            job.completed_at = datetime.now(timezone.utc)
            session.add(job)
            session.commit()