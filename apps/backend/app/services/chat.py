from __future__ import annotations

import textwrap

import httpx

from app.core.config import settings
from app.services.gemini_client import GeminiClientError, generate_text as gemini_generate_text


class ChatError(Exception):
    pass


def _configured_provider() -> str | None:
    # Default preference remains: Ollama (local) → OpenAI.
    # Gemini is available via provider override or if others aren't set.
    if settings.ollama_url and settings.ollama_model:
        return "ollama"
    if settings.openai_api_key:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return None


def _ollama_endpoint() -> str:
    base = settings.ollama_url.rstrip("/") if settings.ollama_url else ""
    if not base:
        raise ChatError("Ollama URL is not configured")
    return f"{base}/api/generate"


async def _chat_with_ollama(prompt: str) -> str:
    if not settings.ollama_model:
        raise ChatError("Ollama model is not configured")

    payload = {
        "model": settings.ollama_model,
        "prompt": prompt,
        "stream": False,
        "keep_alive": getattr(settings, "ollama_keep_alive", "10m"),
        "options": {
            "temperature": 0.3,
            **({"num_ctx": int(settings.ollama_num_ctx)} if getattr(settings, "ollama_num_ctx", None) is not None else {}),
            **({"num_thread": int(settings.ollama_num_thread)} if getattr(settings, "ollama_num_thread", None) is not None else {}),
            **({"num_batch": int(settings.ollama_num_batch)} if getattr(settings, "ollama_num_batch", None) is not None else {}),
            **({"num_gpu": int(settings.ollama_num_gpu)} if getattr(settings, "ollama_num_gpu", None) is not None else {}),
        },
    }

    timeout = httpx.Timeout(120.0, connect=5.0)

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.post(_ollama_endpoint(), json=payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ChatError(f"Ollama request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise ChatError("Ollama request timed out") from exc
        except httpx.RequestError as exc:
            raise ChatError(f"Ollama request error: {exc}") from exc

    data = response.json()
    if data.get("error"):
        raise ChatError(f"Ollama error: {data.get('error')}")

    answer = (data.get("response") or "").strip()
    if not answer:
        raise ChatError("Ollama response was empty")

    return answer


async def _chat_with_openai(user_message: str) -> str:
    if not settings.openai_api_key:
        raise ChatError("OpenAI API key is missing")

    payload = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": "You are Study Buddy, a friendly assistant for studying and general Q&A. Respond naturally and helpfully. Only mention being an AI if the user asks.",
            },
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.3,
        "max_tokens": 800,
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
            raise ChatError(f"OpenAI request failed: {exc.response.text}") from exc
        except httpx.TimeoutException as exc:
            raise ChatError("OpenAI request timed out") from exc
        except httpx.RequestError as exc:
            raise ChatError(f"OpenAI request error: {exc}") from exc

    data = response.json()
    choices = data.get("choices")
    if not choices or not choices[0].get("message"):
        raise ChatError("OpenAI response was missing a message")

    return (choices[0]["message"].get("content") or "").strip()


async def _chat_with_gemini(user_message: str) -> str:
    if not settings.gemini_api_key:
        raise ChatError("Gemini API key is missing")

    system_prompt = (
        "You are Study Buddy, a friendly assistant for studying and general Q&A. "
        "Respond naturally and helpfully. Only mention being an AI if the user asks."
    )

    try:
        return await gemini_generate_text(
            f"Question: {user_message}",
            system_prompt=system_prompt,
            temperature=0.3,
            max_output_tokens=800,
            timeout_seconds=60.0,
        )
    except GeminiClientError as exc:
        raise ChatError(str(exc)) from exc


async def answer_question(message: str, provider: str | None = None) -> dict[str, str]:
    # Allow provider override for testing (e.g., gemini), otherwise use configured default.
    if provider is None:
        provider = _configured_provider()
    if not provider:
        raise ChatError("No chat provider configured")

    msg = (message or "").strip()
    if not msg:
        raise ChatError("Message is empty")

    if provider == "ollama":
        prompt = textwrap.dedent(
            f"""\
            You are Study Buddy, a friendly assistant for studying and general Q&A.
            Respond naturally and helpfully. Only mention being an AI if the user asks.

            Question: {msg}
            """
        ).strip()
        answer = await _chat_with_ollama(prompt)
        return {"answer": answer, "provider": provider}

    if provider == "openai":
        answer = await _chat_with_openai(msg)
    elif provider == "gemini":
        answer = await _chat_with_gemini(msg)
    else:
        raise ChatError(f"Unsupported provider: {provider}")
    if not answer:
        raise ChatError("Chat response was empty")
    return {"answer": answer, "provider": provider}
