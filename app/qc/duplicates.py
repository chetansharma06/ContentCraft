from collections.abc import Sequence

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.qc.structure import QCCheckResult


def check_duplicates(
    text: str,
    existing_texts: Sequence[str],
    threshold: float = 0.85,
) -> QCCheckResult:
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("Duplicate threshold must be between 0 and 1")

    candidates = [candidate for candidate in existing_texts if candidate.strip()]
    if not text.strip() or not candidates:
        return QCCheckResult("duplicates", True, 100.0, details={"similarity": 0.0})

    try:
        vectors = TfidfVectorizer(ngram_range=(1, 2), stop_words="english").fit_transform(
            [text, *candidates]
        )
        similarities = cosine_similarity(vectors[0:1], vectors[1:]).flatten()
        similarity = float(similarities.max(initial=0.0))
    except ValueError:
        similarity = max(
            (1.0 if text.casefold().split() == candidate.casefold().split() else 0.0)
            for candidate in candidates
        )

    is_duplicate = similarity >= threshold
    issues = [f"Content is too similar to existing content (cosine similarity {similarity:.3f})"] if is_duplicate else []
    return QCCheckResult(
        "duplicates",
        not is_duplicate,
        round((1.0 - similarity) * 100, 2),
        issues,
        details={"similarity": similarity, "threshold": threshold},
    )