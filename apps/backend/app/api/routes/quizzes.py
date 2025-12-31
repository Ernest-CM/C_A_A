from __future__ import annotations

from typing import Any, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.services.mongo import get_db
from app.services.quiz_generator import QuizGeneratorError, generate_quiz_with_provider

router = APIRouter()


class QuizRequest(BaseModel):
    file_ids: List[str] = Field(..., min_length=1)
    num_questions: int = Field(10, ge=1, le=50)


@router.post("", summary="Generate a quiz from extracted text")
async def generate_quiz(request: QuizRequest, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()

    oids: list[ObjectId] = []
    for fid in request.file_ids:
        try:
            oids.append(ObjectId(fid))
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid file id: {fid}")

    # Fetch and combine extracted text for all selected files (in the order provided).
    chunks: list[str] = []
    for oid, fid in zip(oids, request.file_ids):
        file_doc = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None})
        if not file_doc:
            raise HTTPException(status_code=404, detail=f"File not found: {fid}")

        cursor = db.extracted_pages.find({"file_id": oid, "user_id": user_id}).sort("page_number", 1)
        pages: list[str] = []
        async for page in cursor:
            text = page.get("raw_text")
            if text:
                pages.append(text)

        combined = "\n\n".join(pages).strip()
        if combined:
            title = file_doc.get("original_file_name") or file_doc.get("file_name") or fid
            chunks.append(f"SOURCE: {title}\n{combined}")

    source_text = "\n\n---\n\n".join(chunks).strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="No extracted text available for the selected notes")

    try:
        result = await generate_quiz_with_provider(source_text, num_questions=request.num_questions)
    except QuizGeneratorError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {
        "file_ids": request.file_ids,
        **result,
    }
