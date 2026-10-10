"""Exercises real PDF bytes through the loopback-only FastAPI service."""
from __future__ import annotations
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from pdfminer.high_level import extract_text

from proof import make_latin, make_chinese_cid
from local_server import app

def check():
    client=TestClient(app)
    root=client.get("/")
    assert root.status_code==200
    assert 'local_editor.js' in root.text
    assert '<script>' not in root.text
    assert root.headers.get("cache-control")=="no-store"
    js=client.get("/local_editor.js")
    assert js.status_code==200 and "pdfjsLib" in js.text
    assert client.get("/health").json()["mode"]=="loopback_only"
    print("PASS home and browser JS served locally with no-store")

    with tempfile.TemporaryDirectory() as directory:
        rootdir=Path(directory)
        cjk=rootdir/"chinese-cid.pdf";make_chinese_cid(cjk)
        latin=rootdir/"latin.pdf";make_latin(latin)
        raw=cjk.read_bytes()

        def post(path,data=raw,original="正常",replacement="異常"):
            return client.post(path,files={"file":("demo.pdf",data,"application/pdf")},
                data={"original":original,"replacement":replacement})

        ready=post("/api/preflight")
        assert ready.status_code==200,ready.text
        assert ready.json()["code"]=="READY",ready.text
        assert not list(rootdir.glob("*edited*")), "preflight must not write output"
        edited=post("/api/apply")
        assert edited.status_code==200,edited.text
        assert edited.headers["content-type"]=="application/pdf"
        assert edited.headers["content-disposition"].endswith('filename="pdf-edited.pdf"')
        assert edited.content.startswith(b"%PDF-")
        output=rootdir/"converted.pdf";output.write_bytes(edited.content)
        text=extract_text(str(output))
        assert "設備狀態：異常" in text and "設備狀態：正常" not in text
        assert cjk.read_bytes()==raw
        print("PASS Chinese true PDF edit through API; source unchanged")

        missing=post("/api/preflight",replacement="風險")
        assert missing.status_code==200 and missing.json()["code"]=="ORIGINAL_FONT_MISSING_GLYPHS"
        rejection=post("/api/apply",replacement="風險")
        assert rejection.status_code==422
        assert rejection.json()["code"]=="ORIGINAL_FONT_MISSING_GLYPHS"
        print("PASS missing glyph rejected by preflight and apply")

        long=post("/api/apply",replacement="正常正常")
        assert long.status_code==422 and long.json()["code"]=="DIFFERENT_GLYPH_COUNT"
        print("PASS length mismatch refused")

        invalid=post("/api/preflight",data=b"not a pdf")
        assert invalid.status_code==415
        oversize=post("/api/preflight",data=b"%PDF-"+b"a"*(8*1024*1024+1))
        assert oversize.status_code==413
        wrong_type=client.post("/api/preflight",
            files={"file":("other.zip",b"%PDF-test","application/pdf")},
            data={"original":"a","replacement":"b"})
        assert wrong_type.status_code==415
        print("PASS malformed, oversized, wrong extension blocked")

        lat = client.post("/api/apply",
            files={"file":("latin.pdf",latin.read_bytes(),"application/pdf")},
            data={"original":"2024","replacement":"2025"})
        assert lat.status_code==200
        assert lat.headers["cache-control"]=="no-store"
        print("PASS Latin replacement via API")
    print("ALL LOCAL API TESTS PASSED")

if __name__=="__main__":
    check()
