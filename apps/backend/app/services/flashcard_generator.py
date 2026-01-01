from __future__ import annotations

import json
import logging
import re
import textwrap
from typing import Any, Literal, Optional

import httpx

from app.core.config import settings


logger = logging.getLogger(__name__)


FlashcardProvider = Literal["ollama", "openai"]


class FlashcardGeneratorError(Exception):
    pass


DEFAULT_MAX_SOURCE_CHARS = 8000


def _configured_provider() -> FlashcardProvider | None:
    if settings.ollama_url and (getattr(settings, "ollama_flashcards_model", None) or settings.ollama_model):
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    return None


def _ollama_model() -> str:
    model = getattr(settings, "ollama_flashcards_model", None) or settings.ollama_model
    if not model:
        raise FlashcardGeneratorError("Ollama model is not configured")
    return model


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise FlashcardGeneratorError("Ollama URL is not configured")
    return f"{base}/api/generate"


def _max_source_chars() -> int:
    return int(getattr(settings, "flashcards_max_source_chars", DEFAULT_MAX_SOURCE_CHARS))


def _prepare_source(text: str) -> str:
    normalized = " ".join(text.split())
    limit = _max_source_chars()
    if len(normalized) > limit:
        normalized = normalized[:limit]
    return normalized


def _build_prompt(source: str, *, num_cards: int) -> str:
    return textwrap.dedent(
        f"""\
        Task: Create flashcards from the provided study notes.
        Requirements:
        - Generate exactly {num_cards} flashcards.
        - Each flashcard must have a short FRONT (question/term) and a clear BACK (answer/definition).
        - Keep both sides concise. Avoid fluff.

        Output format:
        - Respond with ONLY valid JSON (no markdown, no extra text).
        - Schema:
          {{
            "title": string,
            "cards": [
              {{"id": number, "front": string, "back": string}}
            ]
          }}
        Strictness:
        - Use double quotes for all JSON strings.
        - No trailing commas.

        NOTES START
        {source}
        NOTES END
        """
    ).strip()


def _ollama_flashcards_json_schema(*, num_cards: int) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "cards"],
        "properties": {
            "title": {"type": "string"},
            "cards": {
                "type": "array",
                "minItems": int(num_cards),
                "maxItems": int(num_cards),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "front", "back"],
                    "properties": {
                        "id": {"type": "integer"},
                        "front": {"type": "string"},
                        "back": {"type": "string"},
                    },
                },
            },
        },
    }


def _strip_code_fences(s: str) -> str:
    s = (s or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", s, flags=re.IGNORECASE | re.DOTALL)
    if m:
        return (m.group(1) or "").strip()
    s = re.sub(r"```(?:json)?", "", s, flags=re.IGNORECASE)
    return s.replace("```", "").strip()


def _first_balanced_json_object(s: str) -> str | None:
    in_string = False
    escape = False
    depth = 0
    start: int | None = None

    for i, ch in enumerate(s):
        if in_string:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
            continue

        if ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                return s[start : i + 1]

    return None


def _extract_json(text: str) -> Any:
    raw = _strip_code_fences(text)
    try:
        return json.loads(raw)
    except Exception:
        pass

    candidate = _first_balanced_json_object(raw)
    if candidate:
        try:
            return json.loads(candidate)
        except Exception:
            pass

    raise FlashcardGeneratorError("Model did not return valid JSON")


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


async def _generate_with_ollama(prompt: str, *, num_predict: int, num_cards: int) -> str:
    payload = {
        "model": _ollama_model(),
        "prompt": prompt,
        "system": "You are a strict JSON generator. Output only valid JSON.",
        "format": _ollama_flashcards_json_schema(num_cards=num_cards),
        "stream": False,
        "keep_alive": getattr(settings, "ollama_keep_alive", "30m"),
        "options": {"temperature": 0.1, "num_predict": int(num_predict), **_ollama_perf_options()},
    }

    timeout = httpx.Timeout(300.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            res = await client.post(_ollama_endpoint(), json=payload)
            res.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise FlashcardGeneratorError(f"Ollama request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise FlashcardGeneratorError("Ollama request timed out. Try fewer cards.") from exc
        except httpx.RequestError as exc:
            raise FlashcardGeneratorError(f"Ollama request error: {exc}") from exc

    data = res.json()
    if data.get("error"):
        raise FlashcardGeneratorError(f"Ollama error: {data.get('error')}")

    out = (data.get("response") or "").strip()
    if not out:
        raise FlashcardGeneratorError("Ollama response was empty")
    return out


async def generate_flashcards_with_provider(text: str, *, num_cards: int) -> dict[str, Any]:
    provider = _configured_provider()
    if not provider:
        raise FlashcardGeneratorError("No flashcard provider configured")

    if num_cards < 1 or num_cards > 100:
        raise FlashcardGeneratorError("num_cards must be between 1 and 100")

    source = _prepare_source(text)
    if not source:
        raise FlashcardGeneratorError("No extracted text available to generate flashcards")

    prompt = _build_prompt(source, num_cards=num_cards)

    def _validate_shape(obj: Any) -> None:
        if not isinstance(obj, dict):
            raise FlashcardGeneratorError("Flashcards JSON must be an object")
        cards = obj.get("cards")
        if not isinstance(cards, list) or not cards:
            raise FlashcardGeneratorError("Flashcards JSON must include a non-empty cards array")
        if len(cards) != num_cards:
            raise FlashcardGeneratorError(f"Flashcards must include exactly {num_cards} cards")

        for idx, c in enumerate(cards):
            if not isinstance(c, dict):
                raise FlashcardGeneratorError("Each card must be an object")
            if not (c.get("front") or "").strip() or not (c.get("back") or "").strip():
                raise FlashcardGeneratorError("Each card must include front and back")
            if "id" not in c:
                c["id"] = idx + 1

    # Keep token budget modest (speed); flashcards are short.
    num_predict = min(2048, max(600, int(80 * num_cards)))

    attempts = 2
    last_raw: Optional[str] = None
    current_prompt = prompt

    for attempt in range(attempts):
        if provider == "ollama":
            raw = await _generate_with_ollama(current_prompt, num_predict=num_predict, num_cards=num_cards)
        else:
            raise FlashcardGeneratorError("OpenAI flashcards not implemented")

        last_raw = raw
        try:
            parsed = _extract_json(raw)
            _validate_shape(parsed)
            return {"flashcards": parsed, "provider": provider}
        except Exception as exc:
            if settings.app_env == "dev":
                snippet = (last_raw or "").strip().replace("\r", "")
                logger.warning(
                    "Flashcards generation attempt %s failed: %s\nRaw output (first 800 chars): %s",
                    attempt + 1,
                    exc,
                    snippet[:800],
                )
            current_prompt = (
                "Return ONLY valid JSON matching the required schema for flashcards. "
                "No markdown, no extra text.\n\n" + prompt
            )
            continue

    raise FlashcardGeneratorError("Model did not return valid JSON")
