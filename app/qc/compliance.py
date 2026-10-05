import re
from collections.abc import Sequence

from app.qc.structure import QCCheckResult


DEFAULT_PROHIBITED_CLAIMS = (
    r"\bcures?\b",
    r"\bguaranteed?\b",
    r"\bclinically proven\b",
    r"\bFDA approved\b",
)


def check_prohibited_claims(
    text: str,
    prohibited_claims: Sequence[str] = DEFAULT_PROHIBITED_CLAIMS,
) -> QCCheckResult:
    found = [claim for claim in prohibited_claims if re.search(claim, text, re.IGNORECASE)]
    issues = [f"Prohibited claim detected: {claim}" for claim in found]
    return QCCheckResult("compliance", not issues, 0.0 if issues else 100.0, issues)