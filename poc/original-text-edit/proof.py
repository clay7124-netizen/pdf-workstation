"""Prototype: verify genuine PDF content-stream text replacement.

Uses only synthetic documents; never uploads or processes private customer PDFs.
This is an evaluation harness, not a hosted edit API. It must report failure
when the font, original text or document geometry cannot be preserved.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import quote

from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pdfminer.high_level import extract_text
from pdf_edit_engine import find, replace

# POC-ONLY shim: examine whether decoding a simple-font /ToUnicode CMap
# fixes ReportLab CJK files that pdf-edit-engine currently treats as WinAnsi.
# This is NOT a reviewed upstream patch and must never be shipped as-is.
def use_simple_font_tounicode_experiment():
    import io
    from pdfminer.cmapdb import CMapParser, FileUnicodeMap
    from pdf_edit_engine.encoding import FontResolver, _build_reverse_map

    original = FontResolver._detect_and_init

    def improved(self, font):
        original(self, font)
        if self._is_cid:
            return
        tu = font.get("/ToUnicode")
        if tu is None:
            return
        try:
            # The proof uses a synthetic, known-safe PDF. Real documents
            # require strict decompression limits and CMap resource bounds.
            content = tu.read_bytes()
            cmap = FileUnicodeMap()
            CMapParser(cmap, io.BytesIO(content)).run()
            chars = {int(k): value for k, value in cmap.cid2unichr.items()
                     if 0 <= int(k) <= 255 and value}
            if chars:
                self._byte_to_unicode.update(chars)
                self._unicode_to_byte, _ = _build_reverse_map(self._byte_to_unicode)
        except Exception:
            return

    FontResolver._detect_and_init = improved


BASE = Path("poc/original-text-edit/results")
BASE.mkdir(parents=True, exist_ok=True)
FONT_URL = (
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/"
    + quote("NotoSansTC[wght].ttf")
)


def make_latin(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=(595, 842), pageCompression=0)
    c.setTitle("Synthetic Latin fixture")
    c.setFont("Helvetica", 14)
    c.drawString(72, 730, "Inspection date: 2024")
    c.drawString(72, 700, "Device serial: TEST-0000")
    c.showPage()
    c.save()


def ensure_chinese_static_font() -> Path:
    from fontTools.ttLib import TTFont as FontToolsFont
    from fontTools.varLib.instancer import instantiateVariableFont

    raw = BASE / "NotoSansTC-variable.ttf"
    if not raw.exists():
        with urlopen(FONT_URL, timeout=35) as response:
            raw.write_bytes(response.read())
    static_file = BASE / "NotoSansTC-static.ttf"
    if not static_file.exists():
        var = FontToolsFont(str(raw))
        static = instantiateVariableFont(var, {"wght": 400}, inplace=False)
        static.save(str(static_file))
    return static_file


def make_chinese_cid(path: Path) -> None:
    """Generate a Type0 / Identity-H PDF using fpdf2, which is relevant to CJK."""
    from fpdf import FPDF
    font_file = ensure_chinese_static_font()
    pdf = FPDF(format="A4")
    pdf.add_page()
    pdf.add_font("NotoSansTC", fname=str(font_file))
    pdf.set_font("NotoSansTC", size=14)
    pdf.text(28, 50, "維修日期：2024年")
    pdf.text(28, 60, "設備狀態：正常")
    pdf.text(28, 70, "測試數字：2025年")
    pdf.text(28, 80, "故障示例：異常，保養")
    pdf.output(str(path))


def make_chinese(path: Path) -> None:
    from fontTools.ttLib import TTFont as FontToolsFont
    from fontTools.varLib.instancer import instantiateVariableFont

    raw = BASE / "NotoSansTC-variable.ttf"
    if not raw.exists():
        with urlopen(FONT_URL, timeout=35) as response:
            raw.write_bytes(response.read())
    var = FontToolsFont(str(raw))
    static = instantiateVariableFont(var, {"wght": 400}, inplace=False)
    font_file = BASE / "NotoSansTC-static.ttf"
    static.save(str(font_file))
    pdfmetrics.registerFont(TTFont("NotoSansTC", str(font_file)))
    c = canvas.Canvas(str(path), pagesize=(595, 842), pageCompression=0)
    c.setTitle("Synthetic Traditional Chinese fixture")
    c.setFont("NotoSansTC", 14)
    c.drawString(72, 730, "維修日期：2024年")
    c.drawString(72, 700, "設備狀態：正常")
    c.showPage()
    c.save()


def verify_visual_difference(source: Path, edited: Path, old_text: str) -> dict:
    """Pixel-compare the original page and edited page outside the target text.
    All geometry is determined from the source PDF text boxes, not guessed.
    The result cannot prove typographic perfection inside the edited area.
    """
    from PIL import Image, ImageChops, ImageDraw
    import pypdfium2 as pdfium
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar

    def walk(node):
        if isinstance(node, LTChar):
            yield node
        elif hasattr(node, "__iter__"):
            for sub in node:
                yield from walk(sub)

    layout = next(iter(extract_pages(str(source))))
    chars = list(walk(layout))
    full = "".join(ch.get_text() for ch in chars)
    at = full.find(old_text)
    if at < 0:
        raise AssertionError("Could not locate original editable glyph geometry")
    selected = chars[at:at + len(old_text)]
    scale = 2.0
    left = max(0, min(c.x0 for c in selected) - 7)
    right = max(c.x1 for c in selected) + 15
    bottom = max(0, min(c.y0 for c in selected) - 7)
    top = max(c.y1 for c in selected) + 7
    doc_before = pdfium.PdfDocument(str(source))
    doc_after = pdfium.PdfDocument(str(edited))
    try:
        assert len(doc_before) == len(doc_after) == 1
        before = doc_before[0].render(scale=scale).to_pil().convert("RGB")
        after = doc_after[0].render(scale=scale).to_pil().convert("RGB")
        if before.size != after.size:
            raise AssertionError("Edited PDF changes physical page dimensions")
        height_pt = before.height / scale
        x0, y0 = int(left * scale), int((height_pt - top) * scale)
        x1, y1 = int(right * scale), int((height_pt - bottom) * scale)
        region = (x0, y0, x1, y1)
        difference = ImageChops.difference(before, after).convert("L")
        pixel_changed = difference.point(lambda x: 255 if x > 8 else 0)
        mask = Image.new("L", before.size, 255)
        ImageDraw.Draw(mask).rectangle(region, fill=0)
        outside = ImageChops.multiply(pixel_changed, mask)
        return {
            "pixels_modified": pixel_changed.getbbox() is not None,
            "outside_edit_pixels_modified": outside.getbbox() is not None,
            "allowed_region_pixels": region,
            "render_size": before.size,
        }
    finally:
        doc_before.close()
        doc_after.close()


def normalized(value: object) -> str:
    return str(value).replace("\n", " ")


def evaluate(label: str, source: Path, original: str, replacement: str) -> dict:
    dest = BASE / (label + "_edited.pdf")
    result = {
        "test": label,
        "status": "unverified",
        "original": original,
        "replacement": replacement,
        "genuine_content_stream_edit": False,
        "font_preserved": False,
        "input_text_present": False,
        "output_text_present": False,
        "unmodified_text_preserved": False,
        "degradations": [],
    }
    try:
        text_before = normalized(extract_text(str(source)))
        result["input_text_present"] = original in text_before
        if original not in text_before:
            raise AssertionError("Input text is not searchable by pdfminer")

        if label.startswith("traditional_chinese"):
            # Diagnostic only: distinguish a cross-operator match from a font/CMap
            # decoding problem. pdfminer readable text alone does not prove
            # the original content stream can be located by this engine.
            from pdf_edit_engine import get_text, get_fonts
            result["engine_extracted_sample"] = str(get_text(str(source)))[:250]
            result["matching_diagnostics"] = {
                word: len(find(str(source), word))
                for word in ["2024年", "2024", "維修", "日期", "正常", "年"]
            }
            result["fonts_diagnostics"] = str(get_fonts(str(source)))[:500]
        hits = find(str(source), original)
        if len(hits) != 1:
            raise AssertionError(f"Expected one original-text match, got {len(hits)}")

        replaced = replace(str(source), hits[0], replacement, str(dest))
        report = replaced.fidelity_report
        result["reported_success"] = bool(replaced.success)
        result["font_preserved"] = bool(report.font_preserved)
        result["font_substituted"] = report.font_substituted
        result["overflow_detected"] = bool(report.overflow_detected)
        result["degradations"] = [
            {"kind": str(d.kind), "severity": d.severity, "detail": d.detail}
            for d in report.degradations
        ]

        text_after = normalized(extract_text(str(dest)))
        result["output_text_present"] = replacement in text_after
        result["original_text_removed"] = original not in text_after
        if label == "latin":
            unchanged = "Device serial: TEST-0000"
        elif label.endswith("_ideograph"):
            unchanged = "維修日期：2024年"
        else:
            unchanged = "設備狀態：正常"
        result["unmodified_text_preserved"] = unchanged in text_after

        # Direct-content surgery is the documented method of the engine.
        # We will add independent content-stream structural comparison later.
        result["genuine_content_stream_edit"] = bool(
            replaced.success and result["output_text_present"]
            and result["original_text_removed"]
        )
        result["visual_difference"] = verify_visual_difference(source, dest, original)
        bad = [
            d for d in result["degradations"]
            if d["severity"] in ("error", "warning")
        ]
        result["status"] = (
            "pass" if (
                result["genuine_content_stream_edit"]
                and result["font_preserved"]
                and not result["overflow_detected"]
                and result["unmodified_text_preserved"]
                and not bad
                and result["visual_difference"]["pixels_modified"]
                and not result["visual_difference"]["outside_edit_pixels_modified"]
            ) else "fail"
        )
    except Exception as exc:
        result["status"] = "fail"
        result["error_type"] = type(exc).__name__
        result["error"] = str(exc)[:280]
    return result


def main() -> None:
    use_simple_font_tounicode_experiment()
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        tests = []
        latin = folder / "latin.pdf"
        make_latin(latin)
        tests.append(evaluate("latin", latin, "2024", "2025"))
        try:
            chinese = folder / "chinese.pdf"
            make_chinese(chinese)
            tests.append(evaluate("traditional_chinese", chinese, "2024年", "2025年"))
            cid_pdf = folder / "chinese_cid.pdf"
            make_chinese_cid(cid_pdf)
            tests.append(evaluate("traditional_chinese_cid", cid_pdf, "2024年", "2025年"))
            tests.append(evaluate("traditional_chinese_cid_ideograph", cid_pdf, "正常", "異常"))
        except Exception as exc:
            tests.append({
                "test": "traditional_chinese",
                "status": "fail",
                "error_type": type(exc).__name__,
                "error": str(exc)[:280],
            })

        # Never publish the large downloaded font files in build artifacts.
        for font in BASE.glob("*.ttf"):
            font.unlink(missing_ok=True)

        report = {
            "engine": "AryanBV/pdf-edit-engine v0.2.0",
            "purpose": "Feasibility study only; no mobile deployment, no customer files",
            "results": tests,
            "all_pass": all(t["status"] == "pass" for t in tests),
            "experiment_simple_font_tounicode_patch": True,
            "limitations": [
                "Only same-length synthetic text evaluated; two CJK generators compared.",
                "Chinese probe uses Noto Sans TC, not proprietary original fonts.",
                "Simple-font /ToUnicode shim is an unreviewed experiment, not production code.",
                "Simple synthetic PDF pixel-diff tested; complex layouts still need verification.",
                "Python + pikepdf cannot run inside a plain static GitHub Pages website.",
            ],
        }
        (BASE / "report.json").write_text(json.dumps(
            report, indent=2, ensure_ascii=False
        ), encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))
        with open(Path(__import__("os").environ.get("GITHUB_STEP_SUMMARY", "/dev/null")), "a", encoding="utf-8") as out:
            out.write("### 原文修改 POC（只用合成 PDF）\n")
            for t in tests:
                out.write(f"- {t['test']}: **{t['status']}**")
                if t.get("error_type"):
                    out.write(f" — {t['error_type']}")
                out.write("\n")
            out.write("\n未通過不代表可以直接上線；下一步需驗證中文字型、內容指令與視覺差異。\n")
        # A green workflow must mean all fidelity requirements passed.
        if not report["all_pass"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
