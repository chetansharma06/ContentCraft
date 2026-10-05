from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.ingestion import ingest_products, load_products


def main() -> int:
    data_directory = Path(__file__).resolve().parent
    for filename in ("sample_products.csv", "tricky_products.csv"):
        dataset = data_directory / filename
        valid_rows, rejected_rows = load_products(dataset)
        print(f"{filename}: {len(valid_rows)} valid, {len(rejected_rows)} rejected")
        for rejected in rejected_rows:
            reasons = "; ".join(rejected.reasons)
            print(f"  row {rejected.row_number}: {reasons}")

    result = ingest_products(data_directory / "sample_products.csv")
    print(f"Seeded {result.inserted_count} valid products into SQLite")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())