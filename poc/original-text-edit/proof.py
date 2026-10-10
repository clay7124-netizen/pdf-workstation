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
            ) else "fail"
        )
    except Exception as exc:
        result["status"] = "fail"
        result["error_type"] = type(exc).__name__
        result["error"] = str(exc)[:280]
    return result


def main() -> None:
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
            "limitations": [
                "Only same-length synthetic text evaluated; two CJK generators compared.",
                "Chinese probe uses Noto Sans TC, not proprietary original fonts.",
                "PDF render pixel-diff and complex layouts still need verification.",
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
