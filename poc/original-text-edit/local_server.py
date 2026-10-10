"""Local-only mobile-style PDF original text editor API (prototype).

Start: uvicorn local_server:app --app-dir poc/original-text-edit --host 127.0.0.1 --port 8765

No third-party upload. This program is NOT deployed on GitHub Pages.
Do not bind to a public network: there is no authentication or public-server
sandbox, and it intentionally rejects non-loopback clients.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from strict_adapter import MAX_PDF_BYTES, strict_apply, strict_preflight

ROOT = Path(__file__).parent
app = FastAPI(title="本機 PDF 原文編輯測試", docs_url=None, redoc_url=None,
              openapi_url=None)


@app.middleware("http")
async def localhost_only(request: Request, call_next):
    # This server is a development stepping stone, not a network service.
    client = request.client.host if request.client else ""
    if client not in ("127.0.0.1", "::1", "testclient"):
        return JSONResponse({"message": "僅允許本機連線；禁止公開上傳 PDF"}, status_code=403)
    reply = await call_next(request)
    reply.headers["Cache-Control"] = "no-store"
    reply.headers["X-Content-Type-Options"] = "nosniff"
    reply.headers["Referrer-Policy"] = "no-referrer"
    reply.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; worker-src 'self' blob: https://cdnjs.cloudflare.com; "
        "img-src 'self' blob: data:; connect-src 'self' https://cdnjs.cloudflare.com; "
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
    return reply


@app.get("/", response_class=HTMLResponse)
async def home():
    return HTMLResponse((ROOT / "local_editor.html").read_text(encoding="utf-8"))


@app.get("/health")
async def health():
    return {"service": "PDF 原文編輯本機研究版", "mode": "loopback_only",
            "deployed": False}


async def read_pdf(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(415, "請選擇 PDF")
    data = await file.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF 超過 8 MB")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(415, "檔案內容不是 PDF")
    return data


@app.post("/api/preflight")
async def preflight(file: UploadFile = File(...), original: str = Form(...),
                    replacement: str = Form(...)):
    data = await read_pdf(file)
    with tempfile.TemporaryDirectory(prefix="pdf-local-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(data)
        decision = strict_preflight(source, original, replacement)
        return JSONResponse(decision.as_dict())


@app.post("/api/apply")
async def apply(file: UploadFile = File(...), original: str = Form(...),
                replacement: str = Form(...)):
    data = await read_pdf(file)
    with tempfile.TemporaryDirectory(prefix="pdf-local-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(data)
        output = Path(directory) / "modified.pdf"
        decision = strict_apply(source, output, original, replacement)
        if not decision.allowed:
            return JSONResponse(decision.as_dict(), status_code=422)
        pdf_bytes = output.read_bytes()
    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="pdf-edited.pdf"',
            "X-Original-Text-Editing": "strict-poc",
        },
    )
