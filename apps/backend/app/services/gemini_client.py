from __future__ import annotations

import asyncio
import random
from typing import Any, Optional

import httpx

from app.core.config import settings


class GeminiClientError(Exception):
    pass


def _model_name() -> str:
    model = (settings.gemini_model or "").strip()
    if not model:
        raise GeminiClientError("Gemini model is not configured")
    # The Models API returns names like "models/gemini-2.5-flash".
    if model.startswith("models/"):
        return model[len("models/") :]
    return model


def _endpoint() -> str:
    if not settings.gemini_api_key:
        raise GeminiClientError("Gemini API key is missing")
    model = _model_name()
    return (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={settings.gemini_api_key}"
    )


def _extract_text(data: dict[str, Any]) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        raise GeminiClientError("Gemini response had no candidates")
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    text = "".join((p.get("text") or "") for p in parts).strip()
    if not text:
        raise GeminiClientError("Gemini response was empty")
    return text


def _is_retryable_status(code: int) -> bool:
    # Transient upstream conditions.
    return code in (429, 500, 502, 503, 504)


async def generate_text(
    user_prompt: str,
    *,
    system_prompt: Optional[str] = None,
    temperature: float = 0.2,
    max_output_tokens: int = 1024,
    timeout_seconds: float = 90.0,
    max_retries: int = 4,
) -> str:
    prompt = (user_prompt or "").strip()
    if not prompt:
        raise GeminiClientError("Prompt is empty")

    # Keep request format conservative for API compatibility.
    if system_prompt:
        prompt = f"{system_prompt.strip()}\n\n{prompt}"

    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": float(temperature),
            "maxOutputTokens": int(max_output_tokens),
        },
    }

    # Gemini occasionally returns 503 (model overloaded). Retry with exponential backoff.
    base_delay = 0.6
    last_err: Exception | None = None

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        for attempt in range(max_retries + 1):
            try:
                res = await client.post(_endpoint(), json=payload)
                res.raise_for_status()
                return _extract_text(res.json())
            except httpx.HTTPStatusError as exc:
                last_err = exc
                status = exc.response.status_code
                body = exc.response.text
                if _is_retryable_status(status) and attempt < max_retries:
                    # Full jitter exponential backoff: random(0, base*2^attempt)
                    delay = random.random() * (base_delay * (2**attempt))
                    await asyncio.sleep(delay)
                    continue
                raise GeminiClientError(f"Gemini request failed ({status}): {body}") from exc
            except (httpx.TimeoutException, httpx.RequestError) as exc:
                last_err = exc
                if attempt < max_retries:
                    delay = random.random() * (base_delay * (2**attempt))
                    await asyncio.sleep(delay)
                    continue
                if isinstance(exc, httpx.TimeoutException):
                    raise GeminiClientError("Gemini request timed out") from exc
                raise GeminiClientError(f"Gemini request error: {exc}") from exc

    # Should not reach here, but keep a safe fallback.
    raise GeminiClientError("Gemini request failed") from last_err
