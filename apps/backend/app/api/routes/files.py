from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from starlette.responses import Response
from urllib.parse import quote

from app.api.deps import get_current_user_id
from app.core.config import settings
from app.services.extraction import extract_text_from_image_bytes, extract_text_from_pdf_bytes
from app.services.file_validation import validate_upload
from app.services.mongo import get_db

router = APIRouter()


def _safe_filename(name: str | None) -> str:
    if not name:
        return "upload"
    base = os.path.basename(name)
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", base).strip("._")
    return base or "upload"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _guess_file_type(mime_type: str) -> str:
    if mime_type == "application/pdf":
        return "pdf"
    if mime_type.startswith("image/"):
        return "image"
    return "unknown"


async def _process_uploaded_file(file_id: ObjectId, user_id: str, mime_type: str) -> None:
    db = get_db()
    fs = AsyncIOMotorGridFSBucket(db)

    await db.files.update_one(
        {"_id": file_id, "user_id": user_id, "deleted_at": None},
        {"$set": {"processing_status": "processing", "updated_at": _utc_now()}},
    )

    try:
        # read file bytes from GridFS
        gridfs_id = (await db.files.find_one({"_id": file_id}, {"gridfs_id": 1})).get("gridfs_id")
        if not gridfs_id:
            raise RuntimeError("Missing gridfs_id")

        downloader = await fs.open_download_stream(gridfs_id)
        content = await downloader.read()

        if mime_type == "application/pdf":
            pages = extract_text_from_pdf_bytes(content)
        else:
            pages = extract_text_from_image_bytes(content)

        extracted_docs: list[dict[str, Any]] = []
        for p in pages:
            if not p.text:
                continue
            extracted_docs.append(
                {
                    "file_id": file_id,
                    "user_id": user_id,
                    "page_number": p.page_number,
                    "raw_text": p.text,
                    "ocr_confidence": p.ocr_confidence,
                    "created_at": _utc_now(),
                }
            )

        if extracted_docs:
            await db.extracted_pages.insert_many(extracted_docs)

        await db.files.update_one(
            {"_id": file_id, "user_id": user_id},
            {"$set": {"processing_status": "completed", "updated_at": _utc_now()}},
        )
    except Exception as exc:
        await db.files.update_one(
            {"_id": file_id, "user_id": user_id},
            {
                "$set": {
                    "processing_status": "failed",
                    "extraction_error": str(exc),
                    "updated_at": _utc_now(),
                }
            },
        )


@router.post("", summary="Upload a PDF or image and start extraction")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str | None = None,
    user_id: str = Depends(get_current_user_id),
) -> dict[str, Any]:
    header = await file.read(4096)
    rest = await file.read()
    content = header + rest
    total_size = len(content)

    mime_type = validate_upload(file, settings.max_upload_bytes, header, total_size)
    file_type = _guess_file_type(mime_type)

    original_name = file.filename or "upload"
    safe_name = _safe_filename(original_name)

    db = get_db()
    fs = AsyncIOMotorGridFSBucket(db)

    try:
        gridfs_id = await fs.upload_from_stream(
            safe_name,
            content,
            metadata={"user_id": user_id, "mime_type": mime_type},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"File storage failed: {exc}") from exc

    file_doc = {
        "user_id": user_id,
        "gridfs_id": gridfs_id,
        "file_name": safe_name,
        "original_file_name": original_name,
        "file_size_bytes": total_size,
        "mime_type": mime_type,
        "file_type": file_type,
        "category": category,
        "processing_status": "pending",
        "extraction_error": None,
        "deleted_at": None,
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
    }

    res = await db.files.insert_one(file_doc)
    file_id = res.inserted_id

    background_tasks.add_task(_process_uploaded_file, file_id, user_id, mime_type)

    return {
        "file": {
            "id": str(file_id),
            "file_name": safe_name,
            "original_file_name": original_name,
            "file_size_bytes": total_size,
            "mime_type": mime_type,
            "file_type": file_type,
            "category": category,
            "processing_status": "pending",
            "extraction_error": None,
            "created_at": file_doc["created_at"].isoformat(),
            "updated_at": file_doc["updated_at"].isoformat(),
        }
    }


@router.get("", summary="List uploaded files")
async def list_files(user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()
    cursor = db.files.find({"user_id": user_id, "deleted_at": None}).sort("created_at", -1)
    out: list[dict[str, Any]] = []
    async for f in cursor:
        out.append(
            {
                "id": str(f["_id"]),
                "file_name": f.get("file_name"),
                "original_file_name": f.get("original_file_name"),
                "file_size_bytes": f.get("file_size_bytes"),
                "mime_type": f.get("mime_type"),
                "file_type": f.get("file_type"),
                "category": f.get("category"),
                "processing_status": f.get("processing_status"),
                "extraction_error": f.get("extraction_error"),
                "created_at": f.get("created_at").isoformat() if f.get("created_at") else None,
                "updated_at": f.get("updated_at").isoformat() if f.get("updated_at") else None,
            }
        )
    return {"files": out}


@router.get("/{file_id}/text", summary="Get extracted text")
async def get_extracted_text(file_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()
    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file id")

    f = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None}, {"processing_status": 1})
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    cursor = db.extracted_pages.find({"file_id": oid, "user_id": user_id}).sort("page_number", 1)
    pages: list[dict[str, Any]] = []
    async for p in cursor:
        pages.append({"page_number": p.get("page_number"), "raw_text": p.get("raw_text")})

    combined = "\n\n".join([p.get("raw_text", "") for p in pages if p.get("raw_text")])
    return {"file_id": file_id, "status": f.get("processing_status"), "pages": pages, "text": combined}


@router.get("/{file_id}/content", summary="Download/view the original uploaded file")
async def get_file_content(file_id: str, user_id: str = Depends(get_current_user_id)) -> Response:
    db = get_db()
    fs = AsyncIOMotorGridFSBucket(db)

    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file id")

    f = await db.files.find_one(
        {"_id": oid, "user_id": user_id, "deleted_at": None},
        {"gridfs_id": 1, "mime_type": 1, "original_file_name": 1, "file_name": 1},
    )
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    gridfs_id = f.get("gridfs_id")
    if not gridfs_id:
        raise HTTPException(status_code=500, detail="File is missing storage reference")

    downloader = await fs.open_download_stream(gridfs_id)
    content = await downloader.read()

    mime_type = f.get("mime_type") or "application/octet-stream"
    filename = f.get("original_file_name") or f.get("file_name") or "file"
    disp = f"inline; filename*=UTF-8''{quote(filename)}"

    return Response(
        content=content,
        media_type=mime_type,
        headers={
            "Content-Disposition": disp,
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{file_id}", summary="Delete an uploaded file")
async def delete_file(file_id: str, user_id: str = Depends(get_current_user_id)) -> dict[str, Any]:
    db = get_db()
    fs = AsyncIOMotorGridFSBucket(db)

    try:
        oid = ObjectId(file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file id")

    f = await db.files.find_one({"_id": oid, "user_id": user_id, "deleted_at": None}, {"gridfs_id": 1})
    if not f:
        raise HTTPException(status_code=404, detail="File not found")

    gridfs_id = f.get("gridfs_id")
    if gridfs_id:
        try:
            await fs.delete(gridfs_id)
        except Exception:
            pass

    await db.extracted_pages.delete_many({"file_id": oid, "user_id": user_id})
    await db.files.update_one(
        {"_id": oid, "user_id": user_id},
        {"$set": {"deleted_at": _utc_now(), "updated_at": _utc_now()}},
    )

    return {"ok": True}
