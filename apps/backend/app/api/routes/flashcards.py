from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.services.flashcard_generator import FlashcardGeneratorError, generate_flashcards_with_provider
from app.services.mongo import get_db
from app.services.summarizer import SummarizerError, summarize_text_with_provider

router = APIRouter()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FlashcardsRequest(BaseModel):
    file_ids: List[str] = Field(..., min_length=1)
    num_cards: int = Field(20, ge=1, le=100)
    provider: str | None = None  # 'ollama' | 'openai' | 'gemini'


@router.post("", summary="Generate flashcards from extracted text")
async def generate_flashcards(request: FlashcardsRequest, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()

    max_chars = int(getattr(settings, "flashcards_max_source_chars", 8000))

    oids: list[ObjectId] = []
    for fid in request.file_ids:
        try:
            oids.append(ObjectId(fid))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid file id: {fid}")

    chunks: list[str] = []

    for oid, fid in zip(oids, request.file_ids):
        file_doc = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None})
        if not file_doc:
            raise HTTPException(status_code=404, detail=f"File not found: {fid}")

        focus = "flashcards"
        length = "short"

        cached = await db.summaries.find_one({"user_id": user_id, "file_id": oid, "focus": focus, "length": length})
        if cached and cached.get("summary") and cached.get("file_updated_at") == file_doc.get("updated_at"):
            title = file_doc.get("original_file_name") or file_doc.get("file_name") or fid
            chunks.append(f"SOURCE (summary): {title}\n{cached.get('summary')}")
            continue

        cursor = db.extracted_pages.find({"file_id": oid, "user_id": user_id}).sort("page_number", 1)
        pages: list[str] = []
        used = 0
        async for page in cursor:
            text = (page.get("raw_text") or "").strip()
            if not text:
                continue
            remaining = max_chars - used
            if remaining <= 0:
                break
            if len(text) > remaining:
                pages.append(text[:remaining])
                used += remaining
                break
            pages.append(text)
            used += len(text)

        combined = "\n\n".join(pages).strip()
        if combined:
            title = file_doc.get("original_file_name") or file_doc.get("file_name") or fid

            # If we had to truncate, cache a short summary for future runs.
            if used >= max_chars:
                summary_result: Optional[dict[str, str]] = None
                summary_text = ""
                try:
                    summary_result = await summarize_text_with_provider(
                        combined,
                        focus=focus,
                        length=length,
                        provider=request.provider,
                    )
                    summary_text = (summary_result.get("summary") or "").strip()
                except SummarizerError:
                    summary_text = ""

                if summary_text:
                    await db.summaries.update_one(
                        {"user_id": user_id, "file_id": oid, "focus": focus, "length": length},
                        {
                            "$set": {
                                "provider": (summary_result or {}).get("provider"),
                                "summary": summary_text,
                                "file_updated_at": file_doc.get("updated_at"),
                                "updated_at": _utc_now(),
                            },
                            "$setOnInsert": {"created_at": _utc_now()},
                        },
                        upsert=True,
                    )
                    chunks.append(f"SOURCE (summary): {title}\n{summary_text}")
                else:
                    chunks.append(f"SOURCE: {title}\n{combined}")
            else:
                chunks.append(f"SOURCE: {title}\n{combined}")

    source_text = "\n\n---\n\n".join(chunks).strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="No extracted text available for the selected notes")

    try:
        result = await generate_flashcards_with_provider(
            source_text,
            num_cards=request.num_cards,
            provider=request.provider,
        )
    except FlashcardGeneratorError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"file_ids": request.file_ids, **result}
