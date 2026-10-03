import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


def required_setting(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment setting: {name}")
    return value


def database_name() -> str:
    return os.getenv("MONGODB_DATABASE", "elcara").strip() or "elcara"


def token_lifetime_minutes() -> int:
    try:
        value = int(os.getenv("JWT_ACCESS_TOKEN_MINUTES", "60"))
    except ValueError as exc:
        raise RuntimeError("JWT_ACCESS_TOKEN_MINUTES must be an integer") from exc
    if value < 5 or value > 1440:
        raise RuntimeError("JWT_ACCESS_TOKEN_MINUTES must be between 5 and 1440")
    return value


def cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def setting(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def integer_setting(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw_value = setting(name, str(default))
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def max_pdf_pages() -> int:
    return integer_setting("MAX_PDF_PAGES", 600, minimum=1, maximum=10_000)


def max_upload_bytes() -> int:
    return integer_setting(
        "MAX_UPLOAD_BYTES", 15 * 1024 * 1024, minimum=1024 * 1024, maximum=1024 * 1024 * 1024
    )


def max_documents_per_user() -> int:
    return integer_setting(
        "MAX_DOCUMENTS_PER_USER", 3, minimum=1, maximum=1000
    )


def max_extracted_characters() -> int:
    return integer_setting(
        "MAX_EXTRACTED_CHARACTERS", 3_000_000, minimum=100_000, maximum=50_000_000
    )


def max_extracted_text_bytes() -> int:
    # Leave room below MongoDB's 16 MiB BSON document ceiling for metadata and encoding overhead.
    return integer_setting(
        "MAX_EXTRACTED_TEXT_BYTES", 12 * 1024 * 1024, minimum=1024 * 1024, maximum=14 * 1024 * 1024
    )


def qdrant_timeout_seconds() -> float:
    raw_value = setting("QDRANT_TIMEOUT_SECONDS", "30")
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise RuntimeError("QDRANT_TIMEOUT_SECONDS must be a number") from exc
    if not 1 <= value <= 300:
        raise RuntimeError("QDRANT_TIMEOUT_SECONDS must be between 1 and 300")
    return value


def research_max_rounds() -> int:
    return integer_setting("RESEARCH_MAX_ROUNDS", 8, minimum=1, maximum=8)


def research_max_tokens() -> int:
    return integer_setting("RESEARCH_MAX_TOKENS", 3200, minimum=500, maximum=12_000)
