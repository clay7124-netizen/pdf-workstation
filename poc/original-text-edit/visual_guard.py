"""Fail-closed image verification for experimental original PDF text edits.

It is NOT a formal proof of precise text typography: pixels inside the edited
run still need font and layout checks from the text-edit engine. Any pixel
change *outside* the approved target region is an unconditional refusal.
"""
from __future__ import annotations
import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageDraw

# 2x matches earlier successful POC sample verification.
SCALE = 2.0
MAX_PIXELS_PER_PAGE = 8_000_000


def verify_only_target_changed(source: str, edited: str, page_index: int,
                               bbox: tuple[float, float, float, float]) -> dict:
    before_doc=pdfium.PdfDocument(str(source))
    after_doc=pdfium.PdfDocument(str(edited))
    try:
        if len(before_doc)!=len(after_doc):
            raise ValueError("PDF page count changed")
        if not (0<=page_index<len(before_doc)):
            raise ValueError("original page out of range")
        found_change=False
        for i in range(len(before_doc)):
            bp=before_doc[i]
            ap=after_doc[i]
            width,height=bp.get_size()
            if tuple(bp.get_size())!=tuple(ap.get_size()):
                raise ValueError("PDF page size changed")
            if width*height*SCALE*SCALE>MAX_PIXELS_PER_PAGE:
                raise ValueError("PDF page too large for safe pixel audit")
            a=bp.render(scale=SCALE).to_pil().convert("RGB")
            b=ap.render(scale=SCALE).to_pil().convert("RGB")
            try:
                if a.size!=b.size:
                    raise ValueError("Rendered page dimensions changed")
                diff=ImageChops.difference(a,b).convert("L")
                changed=diff.point(lambda x:255 if x>8 else 0)
                if changed.getbbox() is None:
                    continue
                if i!=page_index:
                    raise ValueError("Modified PDF changed another page")
                found_change=True
                x0,y0,x1,y1=bbox
                # Extra room for antialias and same-font glyph size differences.
                # The engine independently checks font identity and overflow.
                allowed=(
                    max(0,int((x0-9)*SCALE)),
                    max(0,int((height-y1-9)*SCALE)),
                    min(a.width,int((x1+18)*SCALE)),
                    min(a.height,int((height-y0+9)*SCALE)),
                )
                mask=Image.new("L",a.size,255)
                ImageDraw.Draw(mask).rectangle(allowed,fill=0)
                leakage=ImageChops.multiply(changed,mask)
                if leakage.getbbox() is not None:
                    raise ValueError("Unexpected PDF pixels changed outside the selected text")
            finally:
                a.close();b.close()
        if not found_change:
            raise ValueError("No visible modification produced")
        return {"passed":True,"only_selected_text_region_changed":True,
                "checked_pages":len(before_doc),"scale":SCALE}
    finally:
        before_doc.close()
        after_doc.close()
