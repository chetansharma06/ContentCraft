"""Application settings loaded from environment variables using python-dotenv
and pydantic-settings.

Never hard-code API keys. All credentials are read from environment variables
at runtime; ``.env.example`` documents the expected keys.
"""

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables from a ``.env`` file in the project root.
load_dotenv()


class Settings(BaseSettings):
    """Global application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # --- LLM configuration ---
    LLM_PROVIDER: str = "mock"
    GEMINI_API_KEY: Optional[str] = None
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # --- Application configuration ---
    DATABASE_URL: str = "sqlite:///./contentcraft.db"
    MAX_CONCURRENCY: int = 5
    MAX_RETRIES: int = 3
    DEFAULT_LANGUAGE: str = "en"

    @field_validator("LLM_PROVIDER", mode="before")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        supported = {"mock", "gemini", "ollama"}
        if value.lower() not in supported:
            raise ValueError(
                f"LLM_PROVIDER must be one of {sorted(supported)}, got {value!r}"
            )
        return value.lower()

    def __init__(self, **data: object) -> None:
        super().__init__(**data)
        self._validate_provider_config()

    def _validate_provider_config(self) -> None:
        """Ensure required credentials are present for the selected provider."""
        if self.LLM_PROVIDER == "gemini" and not self.GEMINI_API_KEY:
            raise ValueError(
                "GEMINI_API_KEY is required when LLM_PROVIDER=gemini"
            )
        if self.LLM_PROVIDER == "ollama" and not self.OLLAMA_BASE_URL:
            raise ValueError(
                "OLLAMA_BASE_URL is required when LLM_PROVIDER=ollama"
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton settings instance (cached for performance)."""
    return Settings()


settings = get_settings()
