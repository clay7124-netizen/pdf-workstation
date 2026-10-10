"""Security and no-retention regression tests. Only synthetic PDF files are used.

The IAP verifier is mocked here; cryptographic JWT verification must also be
smoke-tested against real IAP once a private project is configured.
"""
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pdfminer.high_level import extract_text

import cloud_server
from proof import make_chinese_cid

KEY="x-goog-iap-jwt-assertion"
ORIGIN="https://pdf-original-private-123456789.asia-east1.run.app"
CONFIG={
    "K_SERVICE":"pdf-original-private",
    "IAP_AUDIENCE":"/projects/123456789/locations/asia-east1/services/pdf-original-private",
    "IAP_ALLOWED_EMAILS":"tester@example.com",
    "APP_ORIGIN":ORIGIN,
}
def identity(**changes):
    now=int(time.time())
    claims={"iss":"https://cloud.google.com/iap","sub":"accounts.google.com:test",
            "email":"tester@example.com","iat":now-10,"exp":now+300}
    claims.update(changes)
    return claims

def run():
    successes=[]
    with patch.dict(os.environ,CONFIG,clear=False):
        with TestClient(cloud_server.app) as client:
            missing=client.get("/")
            assert missing.status_code==401
            successes.append("No signed IAP JWT -> 401")

            with patch("cloud_server.id_token.verify_token",
                       side_effect=ValueError("bad signature")):
                bad=client.get("/",headers={KEY:"forged"})
                assert bad.status_code==403
                successes.append("Invalid signed IAP JWT -> 403")

            for value in [
                identity(email="intruder@example.com"),
                identity(iss="https://evil.example"),
                identity(exp=int(time.time())-100),
            ]:
                with patch("cloud_server.id_token.verify_token",return_value=value):
                    reply=client.get("/",headers={KEY:"signed-token"})
                    assert reply.status_code==403
            successes.append("Nonallowlisted user, wrong issuer and expired JWT denied")

            with tempfile.TemporaryDirectory() as temp:
                source=Path(temp)/"sample.pdf"
                make_chinese_cid(source)
                pdf=source.read_bytes()
                observed_dirs=[]
                actual_worker=cloud_server._call_worker
                def observe(op, path, output, original, replacement):
                    observed_dirs.append(path.parent)
                    return actual_worker(op,path,output,original,replacement)

                headers={KEY:"signed-token","X-PDF-Action":"1","Origin":ORIGIN}
                with patch("cloud_server.id_token.verify_token",
                           return_value=identity()):
                    with patch.object(cloud_server,"_call_worker",side_effect=observe):
                        fail=client.post("/api/preflight",
                            files={"file":("sample.pdf",pdf,"application/pdf")},
                            data={"original":"正常","replacement":"異常"},
                            headers={KEY:"signed-token", "Origin":ORIGIN})
                        assert fail.status_code==403
                        assert not observed_dirs
                        successes.append("Missing CSRF-specific action header denied")

                        fail=client.post("/api/preflight",
                            files={"file":("sample.pdf",pdf,"application/pdf")},
                            data={"original":"正常","replacement":"異常"},
                            headers={KEY:"signed-token","X-PDF-Action":"1",
                                     "Origin":"https://evil.example"})
                        assert fail.status_code==403
                        assert not observed_dirs
                        successes.append("Cross-site form submission denied")

                        oversized=client.post("/api/preflight",
                            content=b"",headers={**headers,
                                "Content-Type":"application/octet-stream",
                                "Content-Length":str(12*1024*1024)})
                        assert oversized.status_code==413
                        successes.append("Oversized Content-Length denied before parsing")

                        before=client.post("/api/preflight",
                            files={"file":("sample.pdf",pdf,"application/pdf")},
                            data={"original":"正常","replacement":"異常"},headers=headers)
                        assert before.status_code==200,before.text
                        assert before.json()["code"]=="READY",before.text
                        assert before.headers["cache-control"].startswith("no-store")
                        assert before.headers["x-frame-options"]=="DENY"
                        assert before.headers["referrer-policy"]=="no-referrer"
                        successes.append("Authorized preflight succeeds and response is private")

                        edited=client.post("/api/apply",
                            files={"file":("sample.pdf",pdf,"application/pdf")},
                            data={"original":"正常","replacement":"異常"},headers=headers)
                        assert edited.status_code==200,edited.text
                        assert edited.content.startswith(b"%PDF-")
                        output=Path(temp)/"check.pdf"
                        output.write_bytes(edited.content)
                        newtext=extract_text(str(output))
                        assert "設備狀態：異常" in newtext and "設備狀態：正常" not in newtext
                        assert source.read_bytes()==pdf
                        successes.append("True CJK PDF text edit, original untouched")

                        missing_font=client.post("/api/apply",
                            files={"file":("sample.pdf",pdf,"application/pdf")},
                            data={"original":"正常","replacement":"風險"},headers=headers)
                        assert missing_font.status_code==422
                        assert missing_font.json()["code"]=="ORIGINAL_FONT_MISSING_GLYPHS"
                        successes.append("Unavailable original font glyphs rejected")

                        invalid=client.post("/api/preflight",
                            files={"file":("malformed.pdf",b"not-pdf","application/pdf")},
                            data={"original":"正常","replacement":"異常"},headers=headers)
                        assert invalid.status_code==415
                        successes.append("Invalid file content rejected")

                        # The scoped temp directories are deleted before *each*
                        # response returns, including error outcomes.
                        assert observed_dirs
                        assert all(not path.exists() for path in observed_dirs)
                        successes.append("Every per-request PDF scratch directory cleaned")

                        root=client.get("/",headers={KEY:"signed-token"})
                        script=client.get("/cloud_editor.js",headers={KEY:"signed-token"})
                        assert root.status_code==200 and script.status_code==200
                        assert "X-PDF-Action" in script.text
                        assert "<script>" not in root.text
                        assert "不會上傳雲端" not in root.text
                        successes.append("IAP-protected UI discloses cloud processing")
    for message in successes:print("PASS "+message)
    print("ALL PRIVATE CLOUD SECURITY TESTS PASSED")

if __name__=="__main__":
    run()
