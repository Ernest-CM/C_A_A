from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import fitz  # PyMuPDF
import pytesseract
from PIL import Image


@dataclass(frozen=True)
class ExtractedPage:
	page_number: int
	text: str
	ocr_confidence: float | None = None


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> list[ExtractedPage]:
	doc = fitz.open(stream=pdf_bytes, filetype="pdf")
	pages: list[ExtractedPage] = []
	for index in range(len(doc)):
		page = doc.load_page(index)
		text = page.get_text("text")
		pages.append(ExtractedPage(page_number=index + 1, text=text.strip()))
	return pages


def extract_text_from_image_bytes(image_bytes: bytes) -> list[ExtractedPage]:
	img = Image.open(BytesIO(image_bytes)).convert("RGB")
	text = pytesseract.image_to_string(img)
	return [ExtractedPage(page_number=1, text=text.strip(), ocr_confidence=None)]
