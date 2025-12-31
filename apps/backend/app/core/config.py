from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# apps/backend/app/core/config.py -> parents[2] == apps/backend
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    # Use an absolute env_file path so the backend can be started from any working directory.
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8")

    app_env: str = "dev"
    web_origin: str = "http://localhost:3000"

    mongodb_uri: str
    mongodb_db: str = "study_buddy"

    jwt_secret: str
    jwt_issuer: str = "departmental-study-buddy"
    jwt_expires_minutes: int = 60 * 24 * 7

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    ollama_url: str | None = None
    ollama_model: str | None = None

    max_upload_bytes: int = 50 * 1024 * 1024


settings = Settings()
