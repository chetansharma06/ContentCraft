import asyncio
import json

import pytest
from pydantic import ValidationError

from app.generation import AltText, ContentGenerator, ProductDescription
from app.llm.mock import MockClient


VALID_DESCRIPTION = {
    "title": "Compact Stainless Steel Travel Bottle",
    "description": "A 750 ml stainless steel bottle designed for reusable everyday hydration.",
    "key_features": ["750 ml capacity", "Stainless steel construction"],
    "meta_description": "Choose this 750 ml stainless steel bottle for reusable everyday hydration.",
}


class SequenceMockClient(MockClient):
    def __init__(self, responses: list[str]) -> None:
        super().__init__()
        self.responses = iter(responses)
        self.prompts: list[str] = []

    async def generate(self, prompt: str, **kwargs: object) -> str:
        self.prompts.append(prompt)
        return next(self.responses)


def test_generates_valid_product_description_with_mock():
    client = MockClient(response=json.dumps(VALID_DESCRIPTION))
    generator = ContentGenerator(client)
    product = {
        "name": "Trail Bottle",
        "price": 24.5,
        "description": "Insulated stainless steel bottle",
        "specifications": {"capacity_ml": 750},
        "keywords": ["outdoors", "hydration"],
    }

    result = asyncio.run(
        generator.generate_product_description(
            product,
            tone="friendly",
            language="English",
            content_angle="Focus on supplied capacity",
        )
    )

    assert isinstance(result, ProductDescription)
    assert result.title == VALID_DESCRIPTION["title"]


def test_generator_retries_invalid_output_then_succeeds():
    client = SequenceMockClient(
        ["not json", json.dumps(VALID_DESCRIPTION)]
    )
    generator = ContentGenerator(client, max_retries=1)

    result = asyncio.run(
        generator.generate_product_description(
            {
                "name": "Trail Bottle",
                "specifications": {"capacity_ml": 750},
            },
            tone="friendly",
            language="French",
            content_angle="Focus on the 750 ml capacity",
        )
    )

    assert result.title == VALID_DESCRIPTION["title"]
    assert len(client.prompts) == 2
    assert "failed schema validation" in client.prompts[1]
    assert "Trail Bottle" in client.prompts[0]
    assert "750" in client.prompts[0]
    assert "Tone: friendly" in client.prompts[0]
    assert "Language: French" in client.prompts[0]
    assert "Focus on the 750 ml capacity" in client.prompts[0]
    assert "Brand rules:" in client.prompts[0]
    assert "Do not invent" in client.prompts[0]


def test_alt_text_template_uses_alt_text_schema():
    client = MockClient(response='{"alt_text": "A stainless steel reusable bottle."}')
    generator = ContentGenerator(client)

    result = asyncio.run(
        generator.generate(
            {
                "name": "Trail Bottle",
                "specifications": {
                    "material": "stainless steel",
                    "reusable": True,
                },
            },
            template_name="alt_text.j2",
        )
    )

    assert isinstance(result, AltText)
    assert result.alt_text == "A stainless steel reusable bottle."


def test_generator_raises_validation_error_after_retries_exhausted():
    client = MockClient(response='{"title": "too short"}')
    generator = ContentGenerator(client, max_retries=1)

    with pytest.raises(ValidationError):
        asyncio.run(generator.generate_product_description({"name": "Trail Bottle"}))