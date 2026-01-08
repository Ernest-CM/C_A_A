from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.services.mindmap_generator import MindmapGeneratorError, generate_mindmap_with_provider
from app.services.mongo import get_db
from app.services.summarizer import SummarizerError, summarize_text_with_provider
from app.services.mindmap_section_summarizer import (
    MindmapSectionSummarizerError,
    summarize_mindmap_section_with_provider,
)

router = APIRouter()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MindmapRequest(BaseModel):
    file_id: str
    max_depth: int = Field(4, ge=2, le=8)
    max_nodes: int = Field(40, ge=10, le=200)
    title: Optional[str] = None
    provider: Optional[str] = None  # 'ollama' | 'openai' | 'gemini'


class MindmapSectionSummaryRequest(BaseModel):
    file_id: str
    topic: str = Field(..., min_length=1)
    size: str = Field("small", pattern="^(small|medium)$")
    provider: Optional[str] = None  # 'ollama' | 'openai' | 'gemini'


@router.post("/summary", summary="Summarize a mind map branch/topic")
async def summarize_section(
    request: MindmapSectionSummaryRequest, user_id: str = Depends(get_current_user_id)
) -> dict[str, Any]:
    db = get_db()

    try:
        oid = ObjectId(request.file_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid file id: {request.file_id}")

    file_doc = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")

    topic = (request.topic or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required")

    size = request.size  # validated by regex
    cache_key = hashlib.sha1(f"{topic}|{size}".encode("utf-8")).hexdigest()
    focus = f"mindmap_section:{cache_key}"
    length = "short" if size == "small" else "medium"

    cached = await db.summaries.find_one({"user_id": user_id, "file_id": oid, "focus": focus, "length": length})
    if cached and cached.get("summary") and cached.get("file_updated_at") == file_doc.get("updated_at"):
        return {"file_id": request.file_id, "topic": topic, "provider": cached.get("provider"), "summary": cached.get("summary")}

    max_chars = int(getattr(settings, "mindmap_max_source_chars", 8000))
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
    if not combined:
        raise HTTPException(status_code=400, detail="No extracted text available for this note")

    try:
        result = await summarize_mindmap_section_with_provider(
            combined,
            topic=topic,
            size="medium" if size == "medium" else "small",
            provider=request.provider,
        )
    except MindmapSectionSummarizerError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    await db.summaries.update_one(
        {"user_id": user_id, "file_id": oid, "focus": focus, "length": length},
        {
            "$set": {
                "provider": result.get("provider"),
                "summary": result.get("summary"),
                "topic": topic,
                "file_updated_at": file_doc.get("updated_at"),
                "updated_at": _utc_now(),
            },
            "$setOnInsert": {"created_at": _utc_now()},
        },
        upsert=True,
    )

    return {"file_id": request.file_id, "topic": topic, **result}


@router.post("", summary="Generate a mind map from a single note")
async def generate_mindmap(request: MindmapRequest, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()

    max_chars = int(getattr(settings, "mindmap_max_source_chars", 8000))

    try:
        oid = ObjectId(request.file_id)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid file id: {request.file_id}")

    file_doc = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None})
    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")

    focus = "mindmap"
    # Mindmaps benefit from more detail than a very short summary.
    length = "medium"

    cached = await db.summaries.find_one({"user_id": user_id, "file_id": oid, "focus": focus, "length": length})
    if cached and cached.get("summary") and cached.get("file_updated_at") == file_doc.get("updated_at"):
        title = request.title or file_doc.get("original_file_name") or file_doc.get("file_name") or request.file_id
        try:
            result = await generate_mindmap_with_provider(
                str(cached.get("summary") or ""),
                max_depth=request.max_depth,
                max_nodes=request.max_nodes,
                title=title,
                provider=request.provider,
            )
        except MindmapGeneratorError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        return {"file_id": request.file_id, **result}

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
    if not combined:
        raise HTTPException(status_code=400, detail="No extracted text available for this note")

    title = request.title or file_doc.get("original_file_name") or file_doc.get("file_name") or request.file_id

    # If we had to truncate, cache a short summary for future runs (faster + more stable).
    source_text = combined
    if used >= max_chars:
        summary_result: Optional[dict[str, str]] = None
        summary_text = ""
        try:
            summary_result = await summarize_text_with_provider(
                source_text,
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
            source_text = summary_text

    try:
        result = await generate_mindmap_with_provider(
            source_text,
            max_depth=request.max_depth,
            max_nodes=request.max_nodes,
            title=title,
            provider=request.provider,
        )
    except MindmapGeneratorError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"file_id": request.file_id, **result}
