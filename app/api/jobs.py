from collections.abc import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session, select

from app.api.dependencies import get_content_generator
from app.api.schemas import JobBatchResponse, JobCreateRequest, JobRead
from app.core.config import settings
from app.db.models import ContentItem, GenerationJob, Product, QCResult
from app.db.session import engine, get_session
from app.generation.batch import BatchGenerationProcessor, select_variants
from app.generation.generator import ContentGenerator
from app.qc.pipeline import QCPipeline

router = APIRouter(prefix="/jobs", tags=["generation jobs"])
SessionFactory = Callable[[], Session]


def _session_factory_for(bind) -> SessionFactory:
    return lambda: Session(bind=bind, expire_on_commit=False)


async def run_generation_jobs(
    job_ids: list[int],
    product_ids: list[int],
    category: str,
    language: str,
    generator: ContentGenerator,
    session_factory: SessionFactory,
    tones: list[str] | None = None,
    content_angles: list[str] | None = None,
) -> None:
    with session_factory() as session:
        products = session.exec(
            select(Product).where(Product.id.in_(product_ids))
        ).all()
        products_by_id = {product.id: product for product in products}
        jobs_by_product = {
            job.product_id: job.id
            for job in session.exec(
                select(GenerationJob).where(GenerationJob.id.in_(job_ids))
            ).all()
        }

    ordered_products = [products_by_id[product_id] for product_id in product_ids]
    ordered_job_ids = [jobs_by_product[product_id] for product_id in product_ids]
    processor = BatchGenerationProcessor(
        generator,
        session_factory=session_factory,
        category=category,
        language=language,
        variants=select_variants(tones, content_angles),
    )
    result = await processor.process(ordered_products, job_ids=ordered_job_ids)
    qc_pipeline = QCPipeline(session_factory=session_factory)
    for product_result in result.products:
        product = products_by_id.get(product_result.product_id)
        if product is None:
            continue
        for content in product_result.content_items:
            try:
                qc_pipeline.run(content, product, requested_language=language)
            except Exception as error:
                with session_factory() as session:
                    stored_content = session.get(ContentItem, content.id)
                    if stored_content is not None:
                        stored_content.approval_status = "QC_FLAGGED"
                        session.add(stored_content)
                        session.add(
                            QCResult(
                                content_item_id=content.id,
                                status="QC_FLAGGED",
                                score=0,
                                issues=[f"QC execution failed: {error}"],
                            )
                        )
                        session.commit()


@router.post("", response_model=JobBatchResponse, status_code=202)
def create_jobs(
    request: JobCreateRequest,
    background_tasks: BackgroundTasks,
    generator: ContentGenerator = Depends(get_content_generator),
    session: Session = Depends(get_session),
) -> JobBatchResponse:
    product_ids = list(dict.fromkeys(request.product_ids))
    products = session.exec(
        select(Product).where(Product.id.in_(product_ids))
    ).all()
    products_by_id = {product.id: product for product in products}
    missing = [product_id for product_id in product_ids if product_id not in products_by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f"Products not found: {missing}")

    jobs = [
        GenerationJob(
            product_id=product_id,
            prompt=f"Generate {request.category} content in {request.language}",
            status="pending",
        )
        for product_id in product_ids
    ]
    session.add_all(jobs)
    session.commit()
    for job in jobs:
        session.refresh(job)

    bind = session.get_bind()
    session_factory = _session_factory_for(bind)
    background_tasks.add_task(
        run_generation_jobs,
        [job.id for job in jobs],
        product_ids,
        request.category,
        request.language,
        generator,
        session_factory,
        request.tones,
        request.content_angles,
    )
    return JobBatchResponse(jobs=[JobRead.model_validate(job) for job in jobs])


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: int, session: Session = Depends(get_session)) -> GenerationJob:
    job = session.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Generation job not found")
    return job