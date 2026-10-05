import re
from collections.abc import Sequence

from app.qc.structure import QCCheckResult


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    escaped = re.escape(keyword.strip()).replace(r"\ ", r"\s+")
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


def check_seo(
    text: str,
    keywords: Sequence[str],
    minimum_coverage: float = 0.5,
    stuffing_ratio: float = 0.12,
    maximum_repetitions: int = 5,
) -> QCCheckResult:
    normalized_keywords = list(dict.fromkeys(keyword.strip() for keyword in keywords if keyword.strip()))
    if not normalized_keywords:
        return QCCheckResult("seo", True, 100.0, details={"keyword_coverage": 1.0})

    word_count = len(re.findall(r"\b\w+\b", text))
    counts = {
        keyword: len(_keyword_pattern(keyword).findall(text))
        for keyword in normalized_keywords
    }
    used_keywords = [keyword for keyword, count in counts.items() if count]
    coverage = len(used_keywords) / len(normalized_keywords)
    total_occurrences = sum(counts.values())
    is_stuffed = total_occurrences > word_count * stuffing_ratio or any(
        count > maximum_repetitions for count in counts.values()
    )

    issues: list[str] = []
    if coverage < minimum_coverage:
        missing = [keyword for keyword, count in counts.items() if count == 0]
        issues.append(f"Insufficient SEO keyword coverage; missing: {', '.join(missing)}")
    if is_stuffed:
        issues.append("Keyword stuffing detected")

    return QCCheckResult(
        "seo",
        not issues,
        round(100 * coverage * (0.5 if is_stuffed else 1.0), 2),
        issues,
        details={
            "keyword_counts": counts,
            "keyword_coverage": coverage,
            "word_count": word_count,
        },
    )