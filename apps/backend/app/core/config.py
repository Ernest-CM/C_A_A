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

    # Optional per-feature models (useful to run a faster/smaller model for quizzes).
    ollama_quiz_model: str | None = None
    ollama_summary_model: str | None = None
    ollama_grader_model: str | None = None
    ollama_flashcards_model: str | None = None

    # Ollama tuning
    # keep_alive accepts values like "30s", "5m", "1h" (Ollama API) and helps avoid
    # paying model load cost on each request.
    ollama_keep_alive: str = "30m"
    # Optional performance knobs passed through to Ollama `options`.
    # Leave as None to let Ollama choose defaults.
    ollama_num_ctx: int | None = None
    ollama_num_thread: int | None = None
    ollama_num_batch: int | None = None
    ollama_num_gpu: int | None = None

    # Prompt limits (smaller == faster, but may reduce quality).
    # Quizzes are latency-sensitive; smaller default keeps generation responsive.
    quiz_max_source_chars: int = 8000
    summary_max_chars: int = 15000
    flashcards_max_source_chars: int = 8000

    max_upload_bytes: int = 50 * 1024 * 1024


settings = Settings()
