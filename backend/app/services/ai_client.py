from openai import AsyncOpenAI

from app.config import setting

OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini"


def create_ai_client() -> AsyncOpenAI:
    api_key = setting("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("AI processing is not configured. Add OPENROUTER_API_KEY to the backend environment.")
    base_url = setting("OPENROUTER_BASE_URL", OPENROUTER_DEFAULT_BASE_URL).rstrip("/")
    return AsyncOpenAI(api_key=api_key, base_url=base_url)


def embedding_model() -> str:
    return (
        setting("OPENROUTER_EMBEDDING_MODEL")
        or setting("OPENAI_EMBEDDING_MODEL")
        or DEFAULT_EMBEDDING_MODEL
    )


def chat_model() -> str:
    return (
        setting("OPENROUTER_CHAT_MODEL")
        or setting("OPENAI_CHAT_MODEL")
        or DEFAULT_CHAT_MODEL
    )
