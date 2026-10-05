"""LLM clients and configuration-based provider selection."""

from app.core.config import Settings, settings
from app.llm.base import BaseLLM
from app.llm.client import LLMClient
from app.llm.mock import MockClient, MockLLM


def get_llm_client(
    provider: str | None = None,
    config: Settings | None = None,
) -> LLMClient:
    """Create a client for an explicit or configured provider."""
    selected_config = config or settings
    selected_provider = (provider or selected_config.LLM_PROVIDER).lower()

    if selected_provider == "mock":
        return MockClient()
    if selected_provider == "gemini":
        from app.llm.gemini_client import GeminiClient

        return GeminiClient(api_key=selected_config.GEMINI_API_KEY)
    if selected_provider == "ollama":
        from app.llm.ollama_client import OllamaClient

        return OllamaClient(base_url=selected_config.OLLAMA_BASE_URL)
    raise ValueError(f"Unknown LLM provider: {selected_provider!r}")


get_llm = get_llm_client

__all__ = [
    "BaseLLM",
    "LLMClient",
    "MockClient",
    "MockLLM",
    "get_llm",
    "get_llm_client",
]