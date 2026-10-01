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
