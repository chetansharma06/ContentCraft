from langdetect import DetectorFactory, LangDetectException, detect

from app.qc.structure import QCCheckResult

DetectorFactory.seed = 0
LANGUAGE_CODES = {
    "arabic": "ar", "chinese": "zh-cn", "dutch": "nl", "english": "en",
    "french": "fr", "german": "de", "hindi": "hi", "italian": "it",
    "japanese": "ja", "korean": "ko", "portuguese": "pt", "russian": "ru",
    "spanish": "es", "swedish": "sv", "turkish": "tr", "ukrainian": "uk",
}


def check_language(text: str, requested_language: str) -> QCCheckResult:
    expected = LANGUAGE_CODES.get(requested_language.strip().casefold(), requested_language.strip().casefold())
    try:
        detected = detect(text)
    except LangDetectException:
        return QCCheckResult(
            "language",
            False,
            0.0,
            [f"Could not determine whether content is in {requested_language}"],
        )

    matches = detected == expected or (
        expected == "zh-cn" and detected.startswith("zh-")
    )
    issues = [] if matches else [
        f"Requested language is {requested_language}, but detected {detected}"
    ]
    return QCCheckResult(
        "language",
        matches,
        100.0 if matches else 0.0,
        issues,
        details={"requested": requested_language, "detected": detected},
    )