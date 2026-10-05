import os
import tempfile
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlmodel import Session

from app.api.schemas import ProductRead, ProductUploadResponse, RejectedRowRead
from app.db.models import Product
from app.db.session import get_session
from app.ingestion import load_products

router = APIRouter(prefix="/products", tags=["products"])


@router.post("/upload", response_model=ProductUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_products(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> ProductUploadResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Upload a CSV or XLSX file")

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary_file:
            temporary_path = temporary_file.name
            temporary_file.write(await file.read())
        valid_rows, rejected_rows = load_products(temporary_path)
    except (OSError, ValueError, UnicodeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    finally:
        await file.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)

    session.add_all(valid_rows)
    session.commit()
    for product in valid_rows:
        session.refresh(product)

    return ProductUploadResponse(
        inserted_count=len(valid_rows),
        products=[ProductRead.model_validate(product) for product in valid_rows],
        rejected_rows=[RejectedRowRead.model_validate(asdict(row)) for row in rejected_rows],
    )


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, session: Session = Depends(get_session)) -> Product:
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return product