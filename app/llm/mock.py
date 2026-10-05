"""Offline mock implementation of the provider-independent LLM client."""

import asyncio
import json
from typing import Any, AsyncIterator

from app.llm.client import LLMClient
from pydantic import BaseModel


class MockClient(LLMClient):
    """Deterministic client for local development and tests."""

    def __init__(
        self,
        model: str = "mock",
        response: str | None = None,
        **kwargs: Any,
    ) -> None:
        self.response = response
        super().__init__(model=model, **kwargs)

    async def generate(self, prompt: str, **kwargs: Any) -> str:
        if self.response is not None:
            return self.response
        return f"[MOCK] Generated response for: {prompt}"

    async def generate_structured(
        self,
        prompt: str,
        response_model: type[BaseModel],
        **kwargs: Any,
    ) -> BaseModel:
        if self.response is not None:
            return await super().generate_structured(prompt, response_model, **kwargs)

        product_facts = self._extract_product_facts(prompt)
        product_name = str(product_facts.get("name", "Product"))
        product_description = str(product_facts.get("description", "")).strip()
        specifications = product_facts.get("specifications", {})
        if isinstance(specifications, dict):
            specification_text = "; ".join(
                f"{key.replace('_', ' ')}: {json.dumps(value, ensure_ascii=False)}"
                for key, value in specifications.items()
            )
        else:
            specification_text = ""
        keywords = product_facts.get("keywords", [])
        if not isinstance(keywords, list):
            keywords = []

        description_parts = [
            f"{product_name}.",
            product_description or "No additional product description was supplied.",
            "Verified specifications supplied: "
            + (specification_text or "No additional specifications were supplied."),
            "Provided keywords: " + (", ".join(map(str, keywords)) or "none"),
            "This mock output uses only the product facts supplied to the generator.",
        ]
        description = " ".join(description_parts)[:2000]
        title = product_name[:100]
        meta_description = description[:160]
        features = [
            f"{key.replace('_', ' ')}: {json.dumps(value, ensure_ascii=False)}"
            for key, value in specifications.items()
        ][:5] if isinstance(specifications, dict) else []
        tone_match = next(
            (line.removeprefix("Tone: ") for line in prompt.splitlines() if line.startswith("Tone: ")),
            "clear",
        )
        cta = "Learn more"
        sample_values = {
            "title": title,
            "description": description,
            "key_features": features,
            "meta_description": meta_description,
            "headline": title,
            "primary_text": description[:500],
            "call_to_action": cta,
            "subject_line": title,
            "preview_text": description[:180],
            "body": description[:3000],
            "alt_text": product_description or product_name,
        }
        return response_model.model_validate(
            {
                field_name: sample_values[field_name]
                for field_name in response_model.model_fields
            }
        )

    @staticmethod
    def _extract_product_facts(prompt: str) -> dict[str, Any]:
        start_marker = "Product facts:\n"
        start = prompt.find(start_marker)
        if start < 0:
            return {}
        start += len(start_marker)
        end = prompt.find("\n\nTone:", start)
        if end < 0:
            return {}
        try:
            facts = json.loads(prompt[start:end])
        except json.JSONDecodeError:
            return {}
        return facts if isinstance(facts, dict) else {}

    async def generate_stream(
        self, prompt: str, **kwargs: Any
    ) -> AsyncIterator[str]:
        response = await self.generate(prompt, **kwargs)
        for chunk in response.split(" "):
            yield chunk + " "
            await asyncio.sleep(0)


MockLLM = MockClient
