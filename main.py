"""ContentCraft entry point.

Verifies the application configuration loads correctly and the configured
LLM provider can be instantiated.
"""

import asyncio
import sys

from app.core.config import settings
from app.llm import get_llm


def main() -> int:
    print(f"LLM Provider: {settings.LLM_PROVIDER}")
    print(f"Database URL: {settings.DATABASE_URL}")
    print(f"Max Concurrency: {settings.MAX_CONCURRENCY}")
    print(f"Max Retries: {settings.MAX_RETRIES}")
    print(f"Default Language: {settings.DEFAULT_LANGUAGE}")

    llm = get_llm()
    print(f"LLM instance: {llm.__class__.__name__}")

    async def smoke_test() -> None:
        response = await llm.generate("Hello, ContentCraft!")
        print(f"Generated: {response}")

    asyncio.run(smoke_test())
    return 0


if __name__ == "__main__":
    sys.exit(main())