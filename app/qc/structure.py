from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError


@dataclass
class QCCheckResult:
    name: str
    passed: bool
    score: float
    issues: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


class ContentStructure(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    keywords: list[str] = Field(default_factory=list)


def check_structure(content: Any) -> QCCheckResult:
    if isinstance(content, Mapping):
        data = dict(content)
    else:
        data = {
            "title": getattr(content, "title", None),
            "body": getattr(content, "body", None),
            "keywords": getattr(content, "keywords", []),
        }

    try:
        structure = ContentStructure.model_validate(data)
    except ValidationError as error:
        issues = [
            f"Invalid {'.'.join(str(part) for part in item['loc']) or 'content'}: "
            f"{item['msg']}"
            for item in error.errors()
        ]
        return QCCheckResult("structure", False, 0.0, issues)

    return QCCheckResult(
        "structure",
        True,
        100.0,
        details={"title_length": len(structure.title), "body_length": len(structure.body)},
    )