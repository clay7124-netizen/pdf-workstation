"""Private Cloud Run beta: fail-closed, IAP-authenticated original text editor.

NEVER deploy unauthenticated. Google IAP directly on Cloud Run is required.
- Requests require a validated Google signed IAP JWT AND an allowlisted email.
- Multipart bodies are capped before parsing.
- Files exist only inside per-request TemporaryDirectory on ephemeral Cloud Run
  memory-backed filesystem; cleaned when request ends (not a guarantee of
  instantaneous secure erase on crash / OOM).
- PDF engine runs in a short-lived, resource-limited subprocess.
- No request bodies, filenames or text are sent to logging.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.datastructures import UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

HERE = Path(__file__).resolve().parent
MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_HTTP_BYTES = MAX_PDF_BYTES + 65536
MAX_TEXT_CHARS = 300
WORKER_SECONDS = 35
IAP_CERTS = "https://www.gstatic.com/iap/verify/public_key"

app = FastAPI(
    title="PDF 原文字編輯｜私人雲端研究版",
    docs_url=None, redoc_url=None, openapi_url=None,
)

def _config() -> tuple[str, frozenset[str]]:
    audience = os.getenv("IAP_AUDIENCE", "").strip()
    emails = frozenset(x.strip().lower() for x in
                       os.getenv("IAP_ALLOWED_EMAILS", "").split(",") if x.strip())
    if not audience.startswith("/projects/") or not audience.endswith(
        "/services/" + os.getenv("K_SERVICE", "pdf-original-private")
    ) or not emails:
        raise HTTPException(503, "驗證服務尚未完成私人部署設定")
    return audience, emails


def _authenticated(request: Request) -> None:
    audience, emails = _config()
    token = request.headers.get("x-goog-iap-jwt-assertion", "")
    if not token or len(token) > 8192:
        raise HTTPException(401, "需要 Google IAP 登入授權")
    try:
        # Google verifier checks ES256 signature, audience and token lifetime.
        claims = id_token.verify_token(
            token, google_requests.Request(),
            audience=audience, certs_url=IAP_CERTS,
        )
        if claims.get("iss") != "https://cloud.google.com/iap":
            raise ValueError("wrong issuer")
        if not claims.get("sub") or claims.get("email", "").lower() not in emails:
            raise ValueError("not allowlisted")
        issued = int(claims.get("iat", 0))
        expires = int(claims.get("exp", 0))
        now = int(time.time())
        if issued > now + 30 or expires < now - 30 or expires - issued > 660:
            raise ValueError("invalid token lifetime")
    except Exception:
        # NEVER log a token, email, user input or verification details.
        raise HTTPException(403, "存取驗證失敗") from None


@app.middleware("http")
async def security(request: Request, call_next):
    try:
        _authenticated(request)
        if request.method == "POST":
            if request.headers.get("x-pdf-action") != "1":
                raise HTTPException(403, "缺少受保護的修改請求標記")
            origin = request.headers.get("origin")
            configured = os.getenv("APP_ORIGIN", "").rstrip("/")
            if not configured.startswith("https://"):
                raise HTTPException(503, "缺少安全的網站來源設定")
            if origin and origin != configured:
                raise HTTPException(403, "跨網站請求已阻擋")
            if (raw_length := request.headers.get("content-length")):
                try:
                    if int(raw_length) > MAX_HTTP_BYTES:
                        raise HTTPException(413, "文件超過 8 MB 限制")
                except ValueError:
                    raise HTTPException(400, "無效的請求大小") from None
        answer = await call_next(request)
    except HTTPException as exc:
        answer = JSONResponse({"message": exc.detail}, status_code=exc.status_code)
    except Exception:
        answer = JSONResponse({"message": "服務暫時無法處理請求"}, status_code=503)
    answer.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    answer.headers["Pragma"] = "no-cache"
    answer.headers["X-Content-Type-Options"] = "nosniff"
    answer.headers["X-Frame-Options"] = "DENY"
    answer.headers["Referrer-Policy"] = "no-referrer"
    answer.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    answer.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "script-src 'self' https://cdnjs.cloudflare.com; "
        "worker-src 'self' blob: https://cdnjs.cloudflare.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self'; "
        "font-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
        "form-action 'self'; object-src 'none'"
    )
    return answer


@app.get("/", response_class=HTMLResponse)
async def home():
    html = (HERE / "local_editor.html").read_text(encoding="utf-8")
    return HTMLResponse(
        html.replace("/local_editor.js", "/cloud_editor.js")
        .replace("僅限本機 127.0.0.1｜不會上傳雲端",
                 "私人雲端測試｜PDF 會傳送至受登入保護的伺服器，處理後清理暫存")
        .replace("只在本機電腦執行，不應對外公開網路服務。",
                 "僅限授權的測試帳號。檔案會傳送至雲端記憶體暫存並清理；不會寫入物件儲存、資料庫或應用紀錄。服務商仍可能保留請求中繼資料。"),
    )


@app.get("/cloud_editor.js")
async def client_js():
    return Response(
        (HERE / "cloud_editor.js").read_text(encoding="utf-8"),
        media_type="application/javascript; charset=utf-8",
    )


async def _parse_pdf_form(request: Request) -> tuple[bytes, str, str]:
    # Enforce a byte limit even without Content-Length before parsing multipart
    # or opening a SpooledTemporaryFile. Cloud Run /tmp is memory-backed.
    pieces = bytearray()
    async for chunk in request.stream():
        if len(pieces) + len(chunk) > MAX_HTTP_BYTES:
            raise HTTPException(413, "檔案超過安全大小限制")
        pieces.extend(chunk)
    request._body = bytes(pieces)
    del pieces
    async with request.form(max_files=1, max_fields=2, max_part_size=2048) as fields:
        upload = fields.get("file")
        old, new = fields.get("original"), fields.get("replacement")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "請選擇 PDF 文件")
        if not (isinstance(old, str) and isinstance(new, str)):
            raise HTTPException(400, "缺少原始或修改文字")
        if len(old) > MAX_TEXT_CHARS or len(new) > MAX_TEXT_CHARS:
            raise HTTPException(413, "文字超過 300 字測試限制")
        if not upload.filename or not upload.filename.lower().endswith(".pdf"):
            raise HTTPException(415, "僅允許 PDF 文件")
        contents = await upload.read(MAX_PDF_BYTES + 1)
        if len(contents) > MAX_PDF_BYTES:
            raise HTTPException(413, "PDF 不得超過 8 MB")
        if not contents.startswith(b"%PDF-"):
            raise HTTPException(415, "PDF 檔案格式不正確")
        return contents, old, new


def _sandbox_before_exec():
    import resource
    # Parsing hostile PDF data is hazardous; run it with CPU, address-space,
    # file-size and FD limits; no extra Linux privileges.
    resource.setrlimit(resource.RLIMIT_CPU, (25, 26))
    resource.setrlimit(resource.RLIMIT_AS, (900 * 1024**2, 900 * 1024**2))
    resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024**2, 24 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    os.umask(0o077)


def _call_worker(operation: str, path: Path, output: Path,
                 original: str, replacement: str) -> dict:
    task = {"op": operation, "source": str(path), "output": str(output),
            "original": original, "replacement": replacement}
    try:
        proc = subprocess.run(
            [sys.executable, str(HERE / "cloud_worker.py")],
            input=json.dumps(task, ensure_ascii=False).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=WORKER_SECONDS,
            check=False,
            preexec_fn=_sandbox_before_exec,
            cwd=HERE,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin", "PYTHONUNBUFFERED": "1"},
        )
    except subprocess.TimeoutExpired:
        return {"allowed": False, "code": "PROCESSING_TIMEOUT",
                "message": "PDF 處理超時，已停止本次操作"}
    if proc.returncode != 0 or len(proc.stdout) > 12000:
        return {"allowed": False, "code": "PROCESSING_FAILED",
                "message": "PDF 安全檢查未通過"}
    try:
        result = json.loads(proc.stdout)
        if not isinstance(result, dict) or type(result.get("allowed")) is not bool:
            raise ValueError("invalid result")
        # Strip internal paths and technical details from the public response.
        return {
            "allowed": result["allowed"],
            "code": str(result.get("code", "UNKNOWN"))[:50],
            "message": str(result.get("message", "無法處理"))[:160],
        }
    except Exception:
        return {"allowed": False, "code": "PROCESSING_FAILED",
                "message": "PDF 引擎未回傳有效結果"}


async def _perform(request: Request, operation: str):
    content, original, replacement = await _parse_pdf_form(request)
    # Restrict private scratch to instance memory-backed /tmp. Do not store
    # files in Google Drive, GitHub, Cloud Storage or long-term volumes.
    with tempfile.TemporaryDirectory(prefix="pdf-private-", dir="/tmp") as folder:
        input_path = Path(folder) / "source.pdf"
        output_path = Path(folder) / "output.pdf"
        input_path.write_bytes(content)
        result = _call_worker(operation, input_path, output_path,
                              original, replacement)
        if not result["allowed"]:
            return JSONResponse(result, status_code=422)
        if operation == "preflight":
            return JSONResponse(result)
        if not output_path.exists() or output_path.stat().st_size > 24 * 1024**2:
            return JSONResponse({"allowed": False,
                                 "message": "無法產生有效 PDF",
                                 "code": "INVALID_OUTPUT"}, status_code=422)
        exported = output_path.read_bytes()
        if not exported.startswith(b"%PDF-"):
            return JSONResponse({"allowed": False, "code": "INVALID_OUTPUT",
                                 "message": "轉換後文件無效"}, status_code=422)
    # All scratch files and directory gone before HTTP response.
    return Response(
        exported, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="pdf-edited.pdf"'},
    )


@app.post("/api/preflight")
async def preflight(request: Request):
    return await _perform(request, "preflight")


@app.post("/api/apply")
async def apply(request: Request):
    return await _perform(request, "apply")
