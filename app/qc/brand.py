import re
from collections.abc import Sequence

from app.qc.structure import QCCheckResult


def _term_pattern(term: str) -> re.Pattern[str]:
    words = re.escape(term.strip()).replace(r"\ ", r"\s+")
    return re.compile(rf"(?<!\w){words}(?!\w)", re.IGNORECASE)


def check_brand_terms(
    text: str,
    banned_terms: Sequence[str] = (),
    required_terms: Sequence[str] = (),
) -> QCCheckResult:
    banned_found = [term for term in banned_terms if _term_pattern(term).search(text)]
    required_missing = [term for term in required_terms if not _term_pattern(term).search(text)]
    issues = [f"Banned brand term used: {term}" for term in banned_found]
    issues.extend(f"Required brand term missing: {term}" for term in required_missing)
    total_requirements = len(banned_terms) + len(required_terms)
    passed_requirements = total_requirements - len(issues)
    score = 100.0 if not total_requirements else round(100 * passed_requirements / total_requirements, 2)
    return QCCheckResult("brand", not issues, score, issues)