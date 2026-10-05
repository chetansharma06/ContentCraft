from pathlib import Path

from openpyxl import Workbook
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db.models import Product
from app.ingestion import ingest_products, load_products


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIRECTORY = PROJECT_ROOT / "data"


def test_load_sample_products_parses_json_and_keywords():
    valid_rows, rejected_rows = load_products(DATA_DIRECTORY / "sample_products.csv")

    assert len(valid_rows) == 3
    assert rejected_rows == []
    assert valid_rows[0].specifications["lumens"] == 800
    assert valid_rows[0].keywords == ["lighting", "desk", "home office"]


def test_tricky_dataset_preserves_rejection_reasons():
    valid_rows, rejected_rows = load_products(DATA_DIRECTORY / "tricky_products.csv")

    assert len(valid_rows) == 1
    assert [row.row_number for row in rejected_rows] == [3, 4, 5, 6]
    assert "Product name is required" in rejected_rows[0].reasons
    assert "Price must be a finite non-negative number" in rejected_rows[1].reasons
    assert "Specifications must contain a valid JSON object" in rejected_rows[2].reasons
    assert "Price must be a finite non-negative number" in rejected_rows[3].reasons


def test_ingest_persists_valid_rows_only(tmp_path):
    database_engine = create_engine(
        f"sqlite:///{tmp_path / 'ingestion.db'}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(database_engine)

    with Session(database_engine) as session:
        result = ingest_products(DATA_DIRECTORY / "tricky_products.csv", session)
        stored_products = session.exec(select(Product)).all()

    assert result.inserted_count == 1
    assert len(result.rejected_rows) == 4
    assert [product.name for product in stored_products] == ["Travel Mug"]


def test_load_xlsx_products(tmp_path):
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["name", "price", "specifications", "keywords"])
    worksheet.append(["Canvas Pouch", 9.5, '{"material": "cotton"}', "travel;storage"])
    path = tmp_path / "products.xlsx"
    workbook.save(path)

    valid_rows, rejected_rows = load_products(path)

    assert len(valid_rows) == 1
    assert valid_rows[0].price == 9.5
    assert valid_rows[0].specifications == {"material": "cotton"}
    assert valid_rows[0].keywords == ["travel", "storage"]
    assert rejected_rows == []