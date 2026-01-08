from __future__ import annotations

import textwrap
from typing import Literal, Optional

import httpx

from app.core.config import settings
from app.services.gemini_client import GeminiClientError, generate_text as gemini_generate_text


MAX_SUMMARY_CHARS = 15000

SummaryLength = Literal["short", "medium", "long"]


class SummarizerError(Exception):
    pass


def _configured_provider() -> str | None:
    if settings.ollama_url and (getattr(settings, "ollama_summary_model", None) or settings.ollama_model):
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return None


def _ollama_model() -> str:
    model = getattr(settings, "ollama_summary_model", None) or settings.ollama_model
    if not model:
        raise SummarizerError("Ollama model is not configured")
    return model


def _prepare_prompt(text: str) -> str:
    normalized = " ".join(text.split())
    limit = getattr(settings, "summary_max_chars", MAX_SUMMARY_CHARS)
    if len(normalized) > limit:
        normalized = normalized[:limit]
    return normalized


def _ollama_perf_options() -> dict[str, int]:
    opts: dict[str, int] = {}
    if getattr(settings, "ollama_num_ctx", None) is not None:
        opts["num_ctx"] = int(settings.ollama_num_ctx)
    if getattr(settings, "ollama_num_thread", None) is not None:
        opts["num_thread"] = int(settings.ollama_num_thread)
    if getattr(settings, "ollama_num_batch", None) is not None:
        opts["num_batch"] = int(settings.ollama_num_batch)
    if getattr(settings, "ollama_num_gpu", None) is not None:
        opts["num_gpu"] = int(settings.ollama_num_gpu)
    return opts


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise SummarizerError("Ollama URL is not configured")
    return f"{base}/api/generate"


async def _summarize_with_ollama(prompt: str, *, num_predict: int) -> str:
    model = _ollama_model()

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": getattr(settings, "ollama_keep_alive", "10m"),
        "options": {"temperature": 0.3, "num_predict": int(num_predict), **_ollama_perf_options()},
    }

    timeout = httpx.Timeout(180.0, connect=5.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(_ollama_endpoint(), json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            raise SummarizerError(f"Ollama request failed: {detail}") from exc
        except httpx.TimeoutException as exc:
            raise SummarizerError(
                "Ollama request timed out. Try Short/Medium length, or verify Ollama is responsive."
            ) from exc
        except httpx.RequestError as exc:
            raise SummarizerError(f"Ollama request error: {exc}") from exc

    data = response.json()
    if data.get("error"):
        raise SummarizerError(f"Ollama error: {data.get('error')}")

    result = (data.get("response") or "").strip()

    if not result:
        raise SummarizerError("Ollama response did not include a summary")
    return result


async def _summarize_with_openai(prompt: str, *, max_tokens: int) -> str:
    if not settings.openai_api_key:
        raise SummarizerError("OpenAI API key is missing")

    payload = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": "You are the Departmental Study Buddy summarizer."
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": int(max_tokens),
    }

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            raise SummarizerError(f"OpenAI request failed: {detail}") from exc

    data = response.json()
    choice = data.get("choices")
    if not choice or not choice[0].get("message"):
        raise SummarizerError("OpenAI response was missing a summary")

    return choice[0]["message"]["content"].strip()


async def _summarize_with_gemini(prompt: str, *, max_output_tokens: int) -> str:
    try:
        return await gemini_generate_text(
            prompt,
            system_prompt="You are the Departmental Study Buddy summarizer.",
            temperature=0.3,
            max_output_tokens=int(max_output_tokens),
            timeout_seconds=120.0,
        )
    except GeminiClientError as exc:
        raise SummarizerError(str(exc)) from exc


async def summarize_text(text: str, focus: Optional[str] = None) -> str:
    # Back-compat wrapper: previous callers expected just a string.
    result = await summarize_text_with_provider(text=text, focus=focus, length="medium")
    return result["summary"]


def _length_settings(length: SummaryLength) -> tuple[int, int, int]:
    if length == "short":
        return (4, 200, 220)
    if length == "long":
        return (10, 900, 900)
    return (6, 450, 450)


async def summarize_text_with_provider(
    text: str,
    focus: Optional[str] = None,
    length: SummaryLength = "medium",
    provider: str | None = None,
) -> dict[str, str]:
    provider = (provider or "").strip().lower() or None
    if provider is None:
        provider = _configured_provider()
    if not provider:
        raise SummarizerError("No summarization provider configured")

    trimmed = _prepare_prompt(text)
    if not trimmed:
        raise SummarizerError("No extracted text available for summarization")

    focus_instruction = focus.strip() if focus else "key insights and connections"
    num_bullets, num_predict, openai_max_tokens = _length_settings(length)
    prompt = textwrap.dedent(
        f"""\
        Task: Summarize the provided text.
        Focus: {focus_instruction}.
        Output: up to {num_bullets} bullet points. Make them substantive.

        TEXT START
        {trimmed}
        TEXT END
        """
    ).strip()

    if provider == "ollama":
        summary = await _summarize_with_ollama(prompt, num_predict=num_predict)
        return {"summary": summary, "provider": provider}

    if provider == "openai":
        summary = await _summarize_with_openai(prompt, max_tokens=openai_max_tokens)
        return {"summary": summary, "provider": provider}

    if provider == "gemini":
        # Use a similar budget to OpenAI max_tokens.
        summary = await _summarize_with_gemini(prompt, max_output_tokens=openai_max_tokens)
        return {"summary": summary, "provider": provider}

    raise SummarizerError(f"Unsupported provider: {provider}")
