from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user_id
from app.services.chat import ChatError, answer_question

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    provider: str | None = None  # 'ollama' | 'openai' | 'gemini'


@router.post("", summary="Ask the assistant a question")
async def chat(request: ChatRequest, user_id: str = Depends(get_current_user_id)) -> dict[str, str]:
    # user_id is currently used for auth only; can later be used for per-user history.
    _ = user_id

    try:
        return await answer_question(request.message, provider=request.provider)
    except ChatError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
