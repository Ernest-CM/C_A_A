from __future__ import annotations

import logging
import textwrap
from typing import Any, Literal, Optional

import httpx

from app.core.config import settings
from app.services.gemini_client import GeminiClientError, generate_text as gemini_generate_text


logger = logging.getLogger(__name__)


SummarySize = Literal["small", "medium"]


class MindmapSectionSummarizerError(Exception):
    pass


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise MindmapSectionSummarizerError("Ollama URL is not configured")
    return f"{base}/api/generate"


def _ollama_model() -> str:
    model = getattr(settings, "ollama_summary_model", None) or getattr(settings, "ollama_mindmap_model", None) or settings.ollama_model
    if not model:
        raise MindmapSectionSummarizerError("Ollama model is not configured")
    return model


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


def _budget(size: SummarySize) -> tuple[int, str]:
    if size == "medium":
        return (520, "Write 2-4 short paragraphs (roughly 180-260 words).")
    return (260, "Write 1-2 short paragraphs (roughly 80-140 words).")


def _build_prompt(note_text: str, *, topic: str, size: SummarySize) -> tuple[str, int]:
    max_tokens, size_instruction = _budget(size)
    topic_clean = (topic or "").strip()
    if not topic_clean:
        topic_clean = "this topic"

    prompt = textwrap.dedent(
        f"""\
        Task: Explain the topic from the class notes.

        Topic: {topic_clean}
        Requirements:
        - Use ONLY information supported by the notes.
        - {size_instruction}
        - Be clear and explanatory (not bullet-only).

        NOTES START
        {note_text}
        NOTES END
        """
    ).strip()

    return (prompt, max_tokens)


async def summarize_mindmap_section_with_provider(
    note_text: str,
    *,
    topic: str,
    size: SummarySize = "small",
    provider: str | None = None,
) -> dict[str, str]:
    provider = (provider or "").strip().lower() or None
    if provider is None:
        if settings.ollama_url:
            provider = "ollama"
        elif settings.gemini_api_key:
            provider = "gemini"
        else:
            provider = None

    if not provider:
        raise MindmapSectionSummarizerError("No section summarizer provider configured")

    text = " ".join((note_text or "").split())
    if not text:
        raise MindmapSectionSummarizerError("No extracted text available")

    limit = int(getattr(settings, "mindmap_max_source_chars", 8000))
    if len(text) > limit:
        text = text[:limit]

    prompt, num_predict = _build_prompt(text, topic=topic, size=size)

    if provider == "ollama":
        payload = {
            "model": _ollama_model(),
            "prompt": prompt,
            "stream": False,
            "keep_alive": getattr(settings, "ollama_keep_alive", "30m"),
            "options": {"temperature": 0.3, "num_predict": int(num_predict), **_ollama_perf_options()},
        }

        timeout = httpx.Timeout(180.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                res = await client.post(_ollama_endpoint(), json=payload)
                res.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise MindmapSectionSummarizerError(f"Ollama request failed: {exc.response.text}") from exc
            except httpx.TimeoutException as exc:
                raise MindmapSectionSummarizerError("Ollama request timed out. Try small size.") from exc
            except httpx.RequestError as exc:
                raise MindmapSectionSummarizerError(f"Ollama request error: {exc}") from exc

        data = res.json()
        if data.get("error"):
            raise MindmapSectionSummarizerError(f"Ollama error: {data.get('error')}")
        out = (data.get("response") or "").strip()
    elif provider == "gemini":
        try:
            out = await gemini_generate_text(
                prompt,
                system_prompt=None,
                temperature=0.3,
                max_output_tokens=int(num_predict),
                timeout_seconds=120.0,
            )
        except GeminiClientError as exc:
            raise MindmapSectionSummarizerError(str(exc)) from exc
    else:
        raise MindmapSectionSummarizerError(f"Unsupported provider: {provider}")
    if not out:
        raise MindmapSectionSummarizerError("Empty summary response")

    return {"summary": out, "provider": provider}
