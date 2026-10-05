"""Backward-compatible name for the common LLM client interface."""

from app.llm.client import LLMClient

BaseLLM = LLMClient

__all__ = ["BaseLLM"]
