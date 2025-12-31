from __future__ import annotations

import json
import logging
import re
import textwrap
from typing import Any, Optional

import httpx

from app.core.config import settings


logger = logging.getLogger(__name__)


MAX_SOURCE_CHARS = 20000


class QuizGeneratorError(Exception):
    pass


def _configured_provider() -> str | None:
    if settings.ollama_url and settings.ollama_model:
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    return None


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise QuizGeneratorError("Ollama URL is not configured")
    return f"{base}/api/generate"


def _prepare_source(text: str) -> str:
    normalized = " ".join(text.split())
    if len(normalized) > MAX_SOURCE_CHARS:
        normalized = normalized[:MAX_SOURCE_CHARS]
    return normalized


def _num_predict_for_questions(n: int) -> int:
    # Rough heuristic: multiple-choice questions with short explanations.
    # Give extra headroom to avoid truncation (which often breaks JSON).
    return max(600, min(4096, int(220 * n)))


def _build_prompt(source: str, *, num_questions: int) -> str:
    return textwrap.dedent(
        f"""\
        Task: Generate a quiz based ONLY on the provided study notes.
        Important:
        - Do NOT output bibliography/metadata (e.g., author/year/title-only).
        - You MUST create exam-style questions derived from the notes.
        Requirements:
        - Generate exactly {num_questions} questions.
        - Each question must be multiple-choice with 4 options.
        - Provide the correct option letter (A/B/C/D) and a brief explanation (1 sentence).
        - Keep questions clear and exam-style.

        Output format:
        - Respond with ONLY valid JSON (no markdown, no extra text).
        - Schema:
          {{
            "title": string,
            "questions": [
              {{
                "id": number,
                "question": string,
                "options": [{{"label": "A", "text": string}}, {{"label": "B", "text": string}}, {{"label": "C", "text": string}}, {{"label": "D", "text": string}}],
                "answer": "A"|"B"|"C"|"D",
                "explanation": string
              }}
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


def _ollama_quiz_json_schema(*, num_questions: int) -> dict[str, Any]:
    # Ollama supports passing a JSON Schema object in the `format` field.
    # We use minItems/maxItems to enforce exact counts.
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "questions"],
        "properties": {
            "title": {"type": "string"},
            "questions": {
                "type": "array",
                "minItems": int(num_questions),
                "maxItems": int(num_questions),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "question", "options", "answer", "explanation"],
                    "properties": {
                        "id": {"type": "integer"},
                        "question": {"type": "string"},
                        "options": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 4,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["label", "text"],
                                "properties": {
                                    "label": {"type": "string", "enum": ["A", "B", "C", "D"]},
                                    "text": {"type": "string"},
                                },
                            },
                        },
                        "answer": {"type": "string", "enum": ["A", "B", "C", "D"]},
                        "explanation": {"type": "string"},
                    },
                },
            },
        },
    }


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    # Prefer the first fenced block if present anywhere in the text.
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", s, flags=re.IGNORECASE | re.DOTALL)
    if m:
        return (m.group(1) or "").strip()

    # Otherwise, just remove stray fence markers.
    s = re.sub(r"```(?:json)?", "", s, flags=re.IGNORECASE)
    s = s.replace("```", "")
    return s.strip()


def _repair_common_json_issues(s: str) -> str:
    # Replace “smart quotes” with ASCII quotes.
    s = s.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    # Remove trailing commas before closing braces/brackets.
    s = re.sub(r",\s*([}\]])", r"\1", s)
    return s


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
    raw = _repair_common_json_issues(_strip_code_fences(text))

    # Fast path.
    try:
        return json.loads(raw)
    except Exception:
        pass

    # Extract first JSON object using balanced brace scanning.
    candidate = _first_balanced_json_object(raw)
    if candidate:
        candidate = _repair_common_json_issues(candidate)
        try:
            return json.loads(candidate)
        except Exception:
            pass

    raise QuizGeneratorError("Model did not return valid JSON")


def _retry_prompt(previous_prompt: str, previous_output: str, *, num_questions: int) -> str:
    # Keep retry prompt short and strict.
    return textwrap.dedent(
        f"""\
        Your previous response did not match the required quiz JSON schema.
        Return ONLY valid JSON matching the required schema.
        No markdown, no explanations, no extra keys.

        You MUST return exactly {num_questions} questions.
        Do NOT return only metadata (e.g., author/year/title-only).

        ORIGINAL TASK
        {previous_prompt}

        INVALID OUTPUT (for reference)
        {previous_output}
        """
    ).strip()


async def _generate_with_ollama(prompt: str, *, num_predict: int, num_questions: int) -> str:
    if not settings.ollama_model:
        raise QuizGeneratorError("Ollama model is not configured")

    payload = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "system": "You are a strict JSON generator. Output only valid JSON. Do not output markdown or explanations.",
        # Enforce the expected response shape.
        "format": _ollama_quiz_json_schema(num_questions=num_questions),
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": int(num_predict)},
    }

    # Quiz generations can be slow on local machines, especially with longer notes.
    # Since we use stream:false, we need a generous read timeout.
    timeout = httpx.Timeout(600.0, connect=10.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(_ollama_endpoint(), json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise QuizGeneratorError(f"Ollama request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise QuizGeneratorError("Ollama request timed out. Try fewer questions.") from exc
        except httpx.RequestError as exc:
            raise QuizGeneratorError(f"Ollama request error: {exc}") from exc

    data = response.json()
    if data.get("error"):
        raise QuizGeneratorError(f"Ollama error: {data.get('error')}")

    result = (data.get("response") or "").strip()
    if not result:
        raise QuizGeneratorError("Ollama response was empty")
    return result


async def _generate_with_openai(prompt: str, *, max_tokens: int) -> str:
    if not settings.openai_api_key:
        raise QuizGeneratorError("OpenAI API key is missing")

    payload = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": "You generate quizzes as valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": int(max_tokens),
    }

    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise QuizGeneratorError(f"OpenAI request failed: {exc.response.text}") from exc

    data = response.json()
    choice = data.get("choices")
    if not choice or not choice[0].get("message"):
        raise QuizGeneratorError("OpenAI response was missing content")

    return (choice[0]["message"]["content"] or "").strip()


async def generate_quiz_with_provider(text: str, *, num_questions: int) -> dict[str, Any]:
    provider = _configured_provider()
    if not provider:
        raise QuizGeneratorError("No quiz provider configured")

    if num_questions < 1 or num_questions > 50:
        raise QuizGeneratorError("num_questions must be between 1 and 50")

    source = _prepare_source(text)
    if not source:
        raise QuizGeneratorError("No extracted text available to generate a quiz")

    prompt = _build_prompt(source, num_questions=num_questions)

    def _validate_shape(obj: Any) -> None:
        if not isinstance(obj, dict):
            raise QuizGeneratorError("Quiz JSON must be an object")
        qs = obj.get("questions")
        if not isinstance(qs, list) or not qs:
            raise QuizGeneratorError("Quiz JSON must include a non-empty questions array")
        if len(qs) != num_questions:
            raise QuizGeneratorError(f"Quiz must include exactly {num_questions} questions")

    # Try once, then retry once with stricter prompt if JSON parsing fails.
    attempts = 2
    last_raw: Optional[str] = None
    current_prompt = prompt

    base_num_predict = _num_predict_for_questions(num_questions)

    for attempt_index in range(attempts):
        if provider == "ollama":
            # If we had a parsing failure once already, increase token budget to reduce truncation risk.
            num_predict = base_num_predict if attempt_index == 0 else min(4096, int(base_num_predict * 1.8))
            last_raw = await _generate_with_ollama(current_prompt, num_predict=num_predict, num_questions=num_questions)
        else:
            last_raw = await _generate_with_openai(current_prompt, max_tokens=min(3000, 180 * num_questions))

        try:
            quiz = _extract_json(last_raw)
            _validate_shape(quiz)
            return {"quiz": quiz, "provider": provider}
        except Exception as e:
            if settings.app_env == "dev":
                snippet = (last_raw or "").strip().replace("\r", "")
                logger.warning(
                    "Quiz generation attempt %s failed: %s\nRaw output (first 800 chars): %s",
                    attempt_index + 1,
                    e,
                    snippet[:800],
                )

            current_prompt = _retry_prompt(prompt, last_raw or "", num_questions=num_questions)
            continue

    # If we get here, parsing failed twice.
    if settings.app_env == "dev":
        snippet = (last_raw or "").strip().replace("\r", "")
        raise QuizGeneratorError(
            "Model did not return valid JSON. "
            f"Ollama model: {settings.ollama_model}. "
            f"Raw output (truncated): {snippet[:800]}"
        )

    raise QuizGeneratorError("Model did not return valid JSON")
