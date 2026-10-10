"""Conservative original-PDF-text edit adapter (POC only, NOT production-ready).

Important: supports ONLY uniquely found, equal-Unicode-length text substitutions
that have existing glyph slots in the very same embedded font. Never use white
rectangles, fake overlays, font substitution, font extension, or reflow.

The current POC activates a lab-only ToUnicode shim in proof.py; unsupported
or untrusted PDFs must not be processed with that shim on a public server.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pikepdf
from pdf_edit_engine import find, replace
from pdf_edit_engine.encoding import FontResolver


MAX_PDF_BYTES = 8 * 1024 * 1024
MAX_PAGES = 12


@dataclass
class Decision:
    allowed: bool
    code: str
    message: str
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def deny(code: str, message: str, **details: Any) -> Decision:
    return Decision(False, code, message, details or None)


def _clean(result: Any) -> bool:
    f = result.fidelity_report
    return (
        bool(result.success)
        and result.font_action == "kept"
        and bool(f.font_preserved)
        and f.font_substituted is None
        and not bool(f.overflow_detected)
        and not bool(f.reflow_applied)
        and not bool(f.degradations)
        and not bool(result.warnings)
    )


def check_file(path: Path) -> Decision:
    if not path.is_file():
        return deny("INPUT_MISSING", "找不到 PDF")
    if path.stat().st_size > MAX_PDF_BYTES:
        return deny("FILE_TOO_LARGE", "測試版只接受 8 MB 內的 PDF")
    if path.stat().st_size < 16:
        return deny("INVALID_PDF", "檔案不是有效 PDF")
    try:
        with pikepdf.open(str(path)) as pdf:
            if len(pdf.pages) > MAX_PAGES:
                return deny("TOO_MANY_PAGES", "測試版最多 12 頁")
            if "/AcroForm" in pdf.Root and "/SigFlags" in pdf.Root["/AcroForm"]:
                return deny("SIGNATURE_UNSUPPORTED", "未開放帶簽章標記的 PDF 修改")
    except Exception:
        return deny("INVALID_OR_ENCRYPTED_PDF", "檔案無法開啟或需要密碼")
    return Decision(True, "OK", "已通過基本 PDF 檢查")


def strict_preflight(path: Path, text: str, replacement: str) -> Decision:
    """No write or uploaded data. Return typed refusal before editing."""
    checked = check_file(path)
    if not checked.allowed:
        return checked
    if not text:
        return deny("EMPTY_SELECTION", "沒有選取原文")
    if not replacement:
        return deny("DELETION_NOT_READY", "刪除字元還需要另外的排版驗證，暫不開放")
    if len(text) != len(replacement):
        return deny("DIFFERENT_GLYPH_COUNT", "目前只能以相同字數替換，避免原文件排版移位",
                    original_length=len(text), replacement_length=len(replacement))
    try:
        matches = find(str(path), text)
        if len(matches) != 1:
            return deny("AMBIGUOUS_OR_UNREADABLE_TEXT",
                        "找不到唯一可修改的原文字；掃描件或重複文字暫不開放",
                        found=len(matches))
        match = matches[0]
        if not match.characters:
            return deny("NO_TEXT_OPERATORS", "找不到對應的 PDF 文字指令")
        font_names = {char.font_name for char in match.characters}
        if len(font_names) != 1:
            return deny("MIXED_FONT_SELECTION", "一次只能修改同一種原字型的文字")
        font_name = next(iter(font_names))
        with pikepdf.open(str(path)) as pdf:
            page = pdf.pages[match.page_number]
            fonts = page["/Resources"]["/Font"]
            key = "/" + font_name.lstrip("/")
            if key not in fonts:
                return deny("FONT_NOT_FOUND", "找不到原始字型資源")
            resolver = FontResolver(fonts[key], font_name)
            supported, missing = resolver.can_encode(replacement)
            if not supported:
                return deny("ORIGINAL_FONT_MISSING_GLYPHS",
                            "原始 PDF 內嵌字型沒有新文字需要的字元，不可偷偷替換字型",
                            missing=missing[:12])
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            never_created = Path(folder) / "dry-run-no-output.pdf"
            r = replace(str(path), match, replacement, str(never_created),
                        dry_run=True, reflow=False)
            if never_created.exists():
                return deny("DRY_RUN_WROTE_FILE", "預檢過程意外寫入檔案")
        if not _clean(r):
            return deny("FIDELITY_RISK", "變更可能造成字型或排版差異，已拒絕修改",
                        report=r.to_dict())
        return Decision(True, "READY", "可在保持現有內嵌字型、不重新排版的條件下嘗試修改",
                        {"page": match.page_number + 1, "original_font": font_name})
    except Exception as exc:
        return deny("UNSUPPORTED_PDF", "PDF 編碼或內容結構不支援安全原文修改",
                    exception=type(exc).__name__)


def strict_apply(path: Path, dest: Path, text: str, replacement: str) -> Decision:
    """Only commit a new PDF when dry-run is clean and the real edit stays clean.

    No in-place modification. This is NOT a general PDF editor.
    """
    decision = strict_preflight(path, text, replacement)
    if not decision.allowed:
        return decision
    if path.resolve() == dest.resolve():
        return deny("OVERWRITE_FORBIDDEN", "禁止覆蓋原始 PDF")
    if dest.exists():
        return deny("OUTPUT_EXISTS", "輸出檔案已存在，不能直接覆蓋")
    matches = find(str(path), text)
    if len(matches) != 1:
        return deny("RACE_OR_AMBIGUITY", "預檢後原文位置變更")
    from tempfile import TemporaryDirectory
    from pdfminer.high_level import extract_text
    try:
        with TemporaryDirectory() as folder:
            staged = Path(folder) / "output.pdf"
            edited = replace(str(path), matches[0], replacement, str(staged),
                             dry_run=False, reflow=False)
            if not _clean(edited):
                return deny("POST_EDIT_FIDELITY_RISK", "輸出品質檢查不通過，已捨棄變更",
                            report=edited.to_dict())
            if not staged.is_file():
                return deny("ENGINE_NO_OUTPUT", "引擎沒有產生 PDF")
            rendered_text = extract_text(str(staged))
            if replacement not in rendered_text or text in rendered_text:
                return deny("CONTENT_VERIFICATION_FAILED", "修改後文字驗證失敗")
            if not check_file(staged).allowed:
                return deny("OUTPUT_INVALID", "修改後 PDF 結構驗證失敗")
            # Independent PDFium raster comparison across ALL pages. Reject
            # unintended pixel differences, not only text-extraction changes.
            from visual_guard import verify_only_target_changed
            try:
                visual = verify_only_target_changed(
                    str(path), str(staged),
                    matches[0].page_number,
                    text,
                )
            except Exception as exc:
                return deny("VISUAL_FIDELITY_FAILED",
                            "編輯後的 PDF 影像差異超出選取文字區域，已拒絕輸出",
                            reason=type(exc).__name__)
            # This file remains in private ephemeral storage until all checks
            # pass; no upload or external server is involved.
            dest.write_bytes(staged.read_bytes())
        return Decision(True, "EDITED", "已修改真正的 PDF 文字，另存新檔；未覆蓋來源",
                        {"file": str(dest), "page": decision.details["page"], "visual_guard": visual})
    except Exception as exc:
        dest.unlink(missing_ok=True)
        return deny("EDIT_FAILED", "引擎無法保證不改變原字型與內容",
                    exception=type(exc).__name__)
