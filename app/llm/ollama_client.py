"""Ollama implementation of the provider-independent LLM client."""

import inspect
from typing import Any, AsyncIterator

try:
    import ollama
except ImportError:  # pragma: no cover - optional provider dependency
    ollama = None

from app.core.config import settings
from app.llm.client import LLMClient


class OllamaClient(LLMClient):
    """Client for local or self-hosted Ollama models."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str = "llama2",
        client: Any | None = None,
        **kwargs: Any,
    ) -> None:
        self.base_url = base_url or settings.OLLAMA_BASE_URL
        if client is None:
            if ollama is None:
                raise ImportError(
                    "ollama is required for OllamaClient. "
                    "Install with: pip install ollama"
                )
            client = ollama.AsyncClient(host=self.base_url)
        self.client = client
        super().__init__(model=model, **kwargs)

    async def generate(self, prompt: str, **kwargs: Any) -> str:
        response = await self.client.generate(
            model=self.model,
            prompt=prompt,
            **kwargs,
        )
        return response["response"]

    async def generate_stream(
        self, prompt: str, **kwargs: Any
    ) -> AsyncIterator[str]:
        stream = self.client.generate(
            model=self.model,
            prompt=prompt,
            stream=True,
            **kwargs,
        )
        if inspect.isawaitable(stream):
            stream = await stream
        async for chunk in stream:
            yield chunk["response"]


OllamaLLM = OllamaClient