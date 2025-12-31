from __future__ import annotations

from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import get_current_user_id
from app.services.mongo import get_db
from app.services.summarizer import SummarizerError, SummaryLength, summarize_text_with_provider

router = APIRouter()


class SummarizeRequest(BaseModel):
    file_id: str
    focus: Optional[str] = None
    length: SummaryLength = "medium"


@router.post("", summary="Summarize extracted text")
async def summarize_content(request: SummarizeRequest, user_id: str = Depends(get_current_user_id)) -> dict[str, str]:
    db = get_db()

    try:
        oid = ObjectId(request.file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file id")

    file_doc = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")

    cursor = db.extracted_pages.find({"file_id": oid, "user_id": user_id}).sort("page_number", 1)
    chunks: list[str] = []
    async for page in cursor:
        text = page.get("raw_text")
        if text:
            chunks.append(text)

    combined = "\n\n".join(chunks)
    if not combined:
        raise HTTPException(status_code=400, detail="No extracted text to summarize")

    try:
        result = await summarize_text_with_provider(combined, request.focus, request.length)
    except SummarizerError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"file_id": request.file_id, **result}