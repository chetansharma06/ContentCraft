import asyncio

import pytest
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.llm import LLMClient, MockClient, get_llm_client
from app.llm.gemini_client import GeminiClient
from app.llm.ollama_client import OllamaClient


class ProductCopy(BaseModel):
    title: str
    keywords: list[str]


def test_mock_client_runs_offline():
    client = get_llm_client(config=Settings(LLM_PROVIDER="mock"))

    assert isinstance(client, MockClient)
    assert isinstance(client, LLMClient)
    assert asyncio.run(client.generate("write a title")).startswith("[MOCK]")


def test_mock_structured_output_is_validated_by_pydantic():
    client = MockClient(response='{"title": "Travel Mug", "keywords": ["coffee"]}')

    result = asyncio.run(
        client.generate_structured("Write product copy", ProductCopy)
    )

    assert result == ProductCopy(title="Travel Mug", keywords=["coffee"])


def test_default_mock_client_returns_structured_content_from_prompt_facts():
    from app.generation.schemas import ProductDescription

    client = MockClient()
    prompt = (
        'Product facts:\n{"name": "Trail Bottle", "description": "Reusable bottle", '
        '"specifications": {"capacity_ml": 750}, "keywords": ["hydration"]}'
        "\n\nTone: friendly\nLanguage: English\nContent angle: feature-led"
    )

    result = asyncio.run(client.generate_structured(prompt, ProductDescription))

    assert isinstance(result, ProductDescription)
    assert result.title == "Trail Bottle"
    assert "750" in result.description
    assert "hydration" in result.description


def test_invalid_structured_output_raises_validation_error():
    client = MockClient(response='{"title": 42, "keywords": "coffee"}')

    with pytest.raises(ValidationError):
        asyncio.run(client.generate_structured("Write product copy", ProductCopy))


def test_gemini_configuration_requires_and_accepts_api_key():
    with pytest.raises(ValueError, match="GEMINI_API_KEY"):
        Settings(LLM_PROVIDER="gemini")

    config = Settings(LLM_PROVIDER="gemini", GEMINI_API_KEY="test-key")
    client = GeminiClient(api_key=config.GEMINI_API_KEY, model_client=object())

    assert config.LLM_PROVIDER == "gemini"
    assert client.model == "gemini-1.5-flash"


def test_ollama_configuration_uses_configured_endpoint():
    config = Settings(
        LLM_PROVIDER="ollama",
        OLLAMA_BASE_URL="http://localhost:11434",
    )
    client = OllamaClient(base_url=config.OLLAMA_BASE_URL, client=object())

    assert config.LLM_PROVIDER == "ollama"
    assert client.base_url == "http://localhost:11434"