from __future__ import annotations

import json
import re
import textwrap
from typing import Any, Literal

import httpx

from app.core.config import settings


GradeProvider = Literal["ollama", "openai"]


class TheoryGraderError(Exception):
    pass


def _configured_provider() -> GradeProvider | None:
    if settings.ollama_url and (getattr(settings, "ollama_grader_model", None) or settings.ollama_model):
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    return None


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise TheoryGraderError("Ollama URL is not configured")
    return f"{base}/api/generate"


def _ollama_model() -> str:
    model = getattr(settings, "ollama_grader_model", None) or settings.ollama_model
    if not model:
        raise TheoryGraderError("Ollama grader model is not configured")
    return model


def _strip_code_fences(s: str) -> str:
    s = (s or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)\s*```", s, flags=re.IGNORECASE | re.DOTALL)
    if m:
        return (m.group(1) or "").strip()
    return s


def _extract_json(text: str) -> Any:
    raw = _strip_code_fences(text)
    try:
        return json.loads(raw)
    except Exception as exc:
        raise TheoryGraderError("Grader did not return valid JSON") from exc


def _perf_options() -> dict[str, int]:
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


def _grade_json_schema(*, n: int) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["grades"],
        "properties": {
            "grades": {
                "type": "array",
                "minItems": int(n),
                "maxItems": int(n),
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "score"],
                    "properties": {
                        "id": {"type": "integer"},
                        "score": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                },
            }
        },
    }


def _build_prompt(items: list[dict[str, Any]]) -> str:
    # Items: {id, question, expected_answer, user_answer}
    return textwrap.dedent(
        f"""\
        You are grading student answers.

        Rules:
        - Return ONLY valid JSON.
        - Score each answer from 0.0 to 1.0.
        - Score based on semantic correctness, not exact wording.
        - If the student answer is blank or irrelevant: score 0.0.
        - If it fully matches the expected answer meaning: score 1.0.
        - Partial credit is allowed.

        You MUST output JSON in this shape:
        {{
          "grades": [{{"id": number, "score": number}}]
        }}

        Grade these items:
        {json.dumps(items, ensure_ascii=False)}
        """
    ).strip()


async def grade_theory_answers(*, items: list[dict[str, Any]]) -> dict[str, Any]:
    provider = _configured_provider()
    if not provider:
        raise TheoryGraderError("No grading provider configured")

    if not items:
        return {"grades": [], "provider": provider}

    if provider != "ollama":
        raise TheoryGraderError("Theory grading via OpenAI is not implemented")

    model = _ollama_model()
    prompt = _build_prompt(items)

    payload = {
        "model": model,
        "prompt": prompt,
        "system": "You are a strict JSON grader. Output only valid JSON.",
        "format": _grade_json_schema(n=len(items)),
        "stream": False,
        "keep_alive": getattr(settings, "ollama_keep_alive", "30m"),
        "options": {
            "temperature": 0,
            "num_predict": 512,
            **_perf_options(),
        },
    }

    timeout = httpx.Timeout(180.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            res = await client.post(_ollama_endpoint(), json=payload)
            res.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise TheoryGraderError(f"Ollama grader request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise TheoryGraderError("Ollama grader timed out") from exc
        except httpx.RequestError as exc:
            raise TheoryGraderError(f"Ollama grader request error: {exc}") from exc

    data = res.json()
    if data.get("error"):
        raise TheoryGraderError(f"Ollama grader error: {data.get('error')}")

    raw = (data.get("response") or "").strip()
    parsed = _extract_json(raw)

    grades = parsed.get("grades")
    if not isinstance(grades, list) or len(grades) != len(items):
        raise TheoryGraderError("Grader response missing/invalid grades")

    # Normalize
    out: list[dict[str, Any]] = []
    for g in grades:
        if not isinstance(g, dict):
            continue
        try:
            qid = int(g.get("id"))
            score = float(g.get("score"))
        except Exception:
            continue
        score = max(0.0, min(1.0, score))
        out.append({"id": qid, "score": score})

    return {"grades": out, "provider": provider}
