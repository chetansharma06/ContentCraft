"""Render brand-aware prompts and validate generated content with Pydantic."""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TypeVar

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from pydantic import BaseModel, ValidationError

from app.generation.schemas import AdCopy, AltText, EmailCampaign, ProductDescription
from app.llm.client import LLMClient

ContentModel = TypeVar("ContentModel", bound=BaseModel)

PROMPT_DIRECTORY = Path(__file__).resolve().parents[1] / "prompts"
TEMPLATE_MODELS: dict[str, type[BaseModel]] = {
    "description_beauty.j2": ProductDescription,
    "description_fashion.j2": ProductDescription,
    "description_home_kitchen.j2": ProductDescription,
    "ad_copy.j2": AdCopy,
    "email_campaign.j2": EmailCampaign,
    "alt_text.j2": AltText,
}


class ContentGenerator:
    def __init__(
        self,
        client: LLMClient,
        prompts_directory: str | Path = PROMPT_DIRECTORY,
        brand_voice_path: str | Path | None = None,
        max_retries: int = 2,
    ) -> None:
        if max_retries < 0:
            raise ValueError("max_retries must be non-negative")

        self.client = client
        self.max_retries = max_retries
        self.environment = Environment(
            loader=FileSystemLoader(Path(prompts_directory)),
            undefined=StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        voice_path = Path(brand_voice_path or Path(prompts_directory) / "brand_voice.yaml")
        with voice_path.open("r", encoding="utf-8") as file:
            brand_voice = yaml.safe_load(file)
        if not isinstance(brand_voice, dict):
            raise ValueError("Brand voice configuration must be a YAML mapping")
        defaults = brand_voice.get("defaults", {})
        rules = brand_voice.get("brand_rules", [])
        if not isinstance(defaults, dict) or not isinstance(rules, list):
            raise ValueError("Brand voice defaults and rules have invalid formats")
        if not all(isinstance(rule, str) for rule in rules):
            raise ValueError("Every brand rule must be a string")
        self.defaults = defaults
        self.brand_rules = rules

    async def generate(
        self,
        product: Any,
        template_name: str = "description_home_kitchen.j2",
        tone: str | None = None,
        language: str | None = None,
        content_angle: str = "Emphasize the most relevant verified benefit.",
    ) -> BaseModel:
        """Generate content for a product using the schema assigned to a template."""
        if template_name not in TEMPLATE_MODELS:
            raise ValueError(f"Unsupported content template: {template_name!r}")

        product_facts = self._product_facts(product)
        prompt = self.environment.get_template(template_name).render(
            product_facts=json.dumps(product_facts, ensure_ascii=False, indent=2),
            tone=tone or self.defaults.get("tone", "clear and helpful"),
            language=language or self.defaults.get("language", "English"),
            content_angle=content_angle,
            brand_rules=self.brand_rules,
        )
        response_model = TEMPLATE_MODELS[template_name]

        for attempt in range(self.max_retries + 1):
            try:
                return await self.client.generate_structured(prompt, response_model)
            except ValidationError as error:
                if attempt == self.max_retries:
                    raise
                errors = json.dumps(error.errors(), ensure_ascii=False, default=str)
                prompt = (
                    f"{prompt}\n\nYour previous output failed schema validation. "
                    f"Correct these issues and return only valid JSON: {errors}"
                )

        raise RuntimeError("Generation ended without a result")

    async def generate_product_description(
        self,
        product: Any,
        category: str = "home_kitchen",
        tone: str | None = None,
        language: str | None = None,
        content_angle: str = "Emphasize the most relevant verified benefit.",
    ) -> ProductDescription:
        template_name = f"description_{category}.j2"
        result = await self.generate(
            product=product,
            template_name=template_name,
            tone=tone,
            language=language,
            content_angle=content_angle,
        )
        if not isinstance(result, ProductDescription):
            raise TypeError("Product description template returned an unexpected schema")
        return result

    @staticmethod
    def _product_facts(product: Any) -> dict[str, Any]:
        if isinstance(product, Mapping):
            facts = dict(product)
        elif hasattr(product, "model_dump"):
            facts = product.model_dump(mode="json", exclude={"id", "created_at"})
        else:
            raise TypeError("product must be a mapping or a Pydantic-compatible model")
        if not facts.get("name"):
            raise ValueError("Product facts must include a non-empty name")
        return facts