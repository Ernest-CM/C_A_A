import asyncio
import os
import sys
import time
from dataclasses import dataclass

import fitz  # PyMuPDF
import httpx


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


@dataclass
class SmokeResult:
    ok: bool
    message: str


def make_test_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


async def main() -> SmokeResult:
    os.chdir(BACKEND_DIR)
    if BACKEND_DIR not in sys.path:
        sys.path.insert(0, BACKEND_DIR)

    from app.main import create_app  # noqa: WPS433

    app = create_app()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        email = f"test+{int(time.time())}@example.com"
        password = "TestPassword123!"

        signup = await client.post("/api/auth/signup", json={"email": email, "password": password})
        if signup.status_code not in (200, 201):
            return SmokeResult(False, f"Signup failed: {signup.status_code} {signup.text}")

        token = signup.json().get("access_token")
        if not token:
            return SmokeResult(False, "Signup missing access_token")

        headers = {"Authorization": f"Bearer {token}"}

        pdf_bytes = make_test_pdf_bytes("Hello Departmental Study Buddy")
        files = {"file": ("hello.pdf", pdf_bytes, "application/pdf")}

        up = await client.post("/api/files?category=lecture-notes", files=files, headers=headers)
        if up.status_code != 200:
            return SmokeResult(False, f"Upload failed: {up.status_code} {up.text}")

        file_id = up.json().get("file", {}).get("id")
        if not file_id:
            return SmokeResult(False, "Upload response missing file id")

        # Poll until extraction completes
        status = None
        for _ in range(40):
            lst = await client.get("/api/files", headers=headers)
            if lst.status_code != 200:
                return SmokeResult(False, f"List failed: {lst.status_code} {lst.text}")

            files_list = lst.json().get("files", [])
            current = next((f for f in files_list if f.get("id") == file_id), None)
            status = current.get("processing_status") if current else None

            if status in ("completed", "failed"):
                break

            await asyncio.sleep(0.25)

        if status != "completed":
            return SmokeResult(False, f"Extraction did not complete (status={status})")

        txt = await client.get(f"/api/files/{file_id}/text", headers=headers)
        if txt.status_code != 200:
            return SmokeResult(False, f"Get text failed: {txt.status_code} {txt.text}")

        extracted = txt.json().get("text", "")
        if "Hello Departmental Study Buddy" not in extracted:
            return SmokeResult(False, "Extracted text did not match expected content")

        summ = await client.post(
            "/api/summaries",
            json={"file_id": file_id, "focus": "main ideas", "length": "short"},
            headers=headers,
        )
        if summ.status_code != 200:
            return SmokeResult(False, f"Summarize failed: {summ.status_code} {summ.text}")

        summary_text = summ.json().get("summary", "")
        if not summary_text.strip():
            return SmokeResult(False, "Summarize returned empty summary")

        dele = await client.delete(f"/api/files/{file_id}", headers=headers)
        if dele.status_code != 200:
            return SmokeResult(False, f"Delete failed: {dele.status_code} {dele.text}")

        return SmokeResult(True, "Smoke test passed: auth + upload + extract + text + summarize + delete")


if __name__ == "__main__":
    try:
        result = asyncio.run(main())
    except Exception as exc:  # pragma: no cover
        print(f"SMOKE_TEST_ERROR: {exc}")
        raise

    print(result.message)
    raise SystemExit(0 if result.ok else 1)
