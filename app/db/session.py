from collections.abc import Generator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings
from app.db import models

connect_args = (
    {"check_same_thread": False}
    if settings.DATABASE_URL.startswith("sqlite")
    else {}
)
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)


def create_db() -> None:
    SQLModel.metadata.create_all(engine)
    migrations = {
        "product": {
            "price": "FLOAT NOT NULL DEFAULT 0.0",
        },
        "generationjob": {
            "progress": "INTEGER NOT NULL DEFAULT 0",
            "error": "TEXT",
        },
        "contentitem": {
            "generation_context": "JSON NOT NULL DEFAULT '{}'",
            "approval_status": "TEXT NOT NULL DEFAULT 'GENERATED'",
            "version": "INTEGER NOT NULL DEFAULT 1",
        },
    }
    for table_name, columns in migrations.items():
        existing_columns = {
            column["name"] for column in inspect(engine).get_columns(table_name)
        }
        for column_name, definition in columns.items():
            if column_name not in existing_columns:
                with engine.begin() as connection:
                    connection.execute(
                        text(
                            f"ALTER TABLE {table_name} ADD COLUMN "
                            f"{column_name} {definition}"
                        )
                    )


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session