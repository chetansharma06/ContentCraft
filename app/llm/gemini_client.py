"""Google Gemini implementation of the provider-independent LLM client."""

import asyncio
from typing import Any, AsyncIterator

try:
    import google.generativeai as genai
    from google.generativeai import GenerativeModel
    from google.generativeai.types import GenerationConfig
except ImportError:  # pragma: no cover - optional provider dependency
    genai = None
    GenerativeModel = None
    GenerationConfig = None

from app.core.config import settings
from app.llm.client import LLMClient


class GeminiClient(LLMClient):
    """Gemini client; the SDK is only required when this provider is selected."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "gemini-1.5-flash",
        model_client: Any | None = None,
        **kwargs: Any,
    ) -> None:
        api_key = api_key or settings.GEMINI_API_KEY
        if not api_key:
            raise ValueError("GEMINI_API_KEY is required for GeminiClient")

        generation_config = kwargs.pop("generation_config", None)
        if model_client is None:
            if genai is None or GenerativeModel is None or GenerationConfig is None:
                raise ImportError(
                    "google-generativeai is required for GeminiClient. "
                    "Install with: pip install google-generativeai"
                )
            genai.configure(api_key=api_key)
            if generation_config is None:
                generation_config = GenerationConfig(temperature=0.7)
            model_client = GenerativeModel(
                model,
                generation_config=generation_config,
            )

        self._model = model_client
        super().__init__(model=model, **kwargs)

    async def generate(self, prompt: str, **kwargs: Any) -> str:
        response = await asyncio.to_thread(
            self._model.generate_content,
            prompt,
            stream=False,
            **kwargs,
        )
        return response.text

    async def generate_stream(
        self, prompt: str, **kwargs: Any
    ) -> AsyncIterator[str]:
        response = await asyncio.to_thread(
            self._model.generate_content,
            prompt,
            stream=True,
            **kwargs,
        )
        for chunk in response:
            if chunk.text:
                yield chunk.text


GeminiLLM = GeminiClient