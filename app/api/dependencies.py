from app.generation.generator import ContentGenerator
from app.llm import get_llm_client


def get_content_generator() -> ContentGenerator:
    return ContentGenerator(get_llm_client())