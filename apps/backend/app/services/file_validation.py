from __future__ import annotations

import mimetypes

import filetype
from fastapi import HTTPException, UploadFile


ALLOWED_MIME_TYPES = {
	"application/pdf",
	"image/png",
	"image/jpeg",
}


def sniff_mime_type(header_bytes: bytes, filename: str | None) -> str | None:
	kind = filetype.guess(header_bytes)
	if kind is not None:
		return kind.mime
	if filename:
		guessed, _ = mimetypes.guess_type(filename)
		return guessed
	return None


def validate_upload(file: UploadFile, max_bytes: int, header_bytes: bytes, total_size: int) -> str:
	if total_size <= 0:
		raise HTTPException(status_code=400, detail="Empty file")
	if total_size > max_bytes:
		raise HTTPException(status_code=413, detail="File too large")

	mime = sniff_mime_type(header_bytes, file.filename)
	if not mime or mime not in ALLOWED_MIME_TYPES:
		raise HTTPException(status_code=400, detail="Unsupported file type")

	return mime
