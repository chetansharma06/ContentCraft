"""Provider-independent asynchronous LLM client contract."""

import json
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, TypeVar

from pydantic import BaseModel

OutputModel = TypeVar("OutputModel", bound=BaseModel)


class LLMClient(ABC):
    """Common interface implemented by every LLM provider."""

    def __init__(self, model: str = "default", **kwargs: Any) -> None:
        self.model = model
        self.kwargs = kwargs

    @abstractmethod
    async def generate(self, prompt: str, **kwargs: Any) -> str:
        """Generate text for a prompt."""

    @abstractmethod
    async def generate_stream(
        self, prompt: str, **kwargs: Any
    ) -> AsyncIterator[str]:
        """Generate text incrementally."""

    async def generate_structured(
        self,
        prompt: str,
        response_model: type[OutputModel],
        **kwargs: Any,
    ) -> OutputModel:
        """Generate JSON and validate it against a Pydantic model."""
        schema = json.dumps(response_model.model_json_schema(), ensure_ascii=False)
        structured_prompt = (
            f"{prompt}\n\nReturn only valid JSON matching this schema:\n{schema}"
        )
        response = await self.generate(structured_prompt, **kwargs)
        return response_model.model_validate_json(response.strip())

    def count_tokens(self, prompt: str) -> int:
        """Return a provider-independent whitespace-based token estimate."""
        return len(prompt.split())

    def format_prompt(self, prompt: str, **kwargs: Any) -> str:
        """Return the prompt unchanged unless a provider overrides formatting."""
        return prompt