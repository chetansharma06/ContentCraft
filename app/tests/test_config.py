"""Tests for the application configuration and LLM factory."""

import pytest

from app.core.config import Settings, get_settings, settings
from app.llm import get_llm
from app.llm.base import BaseLLM
from app.llm.mock import MockLLM


def test_settings_singleton():
    assert get_settings() is settings


def test_default_settings():
    s = Settings()
    assert s.LLM_PROVIDER == "mock"
    assert s.DATABASE_URL == "sqlite:///./contentcraft.db"
    assert s.MAX_CONCURRENCY == 5
    assert s.MAX_RETRIES == 3
    assert s.DEFAULT_LANGUAGE == "en"


def test_invalid_provider_rejected():
    with pytest.raises(Exception):
        Settings(LLM_PROVIDER="bogus")


def test_gemini_requires_api_key():
    with pytest.raises(Exception):
        Settings(LLM_PROVIDER="gemini", GEMINI_API_KEY=None)


def test_get_llm_mock():
    llm = get_llm("mock")
    assert isinstance(llm, MockLLM)
    assert isinstance(llm, BaseLLM)


def test_mock_generate():
    import asyncio
    llm = MockLLM()
    result = asyncio.run(llm.generate("hello"))
    assert "hello" in result