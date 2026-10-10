"""Isolated PDF edit worker. Receives task JSON on stdin, returns small JSON on stdout.

No direct HTTP access. Caller enforces JWT, file size and timeout. Must NOT log
document text, path, filename, stack traces, or PDF bytes.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

from strict_adapter import strict_apply, strict_preflight


def main():
    try:
        data = sys.stdin.buffer.read(8192)
        task = json.loads(data)
        operation = task["op"]
        if operation not in ("preflight", "apply"):
            raise ValueError("invalid operation")
        source = Path(task["source"])
        output = Path(task["output"])
        original = task["original"]
        replacement = task["replacement"]
        if not isinstance(original, str) or not isinstance(replacement, str):
            raise ValueError("invalid text")
        if not (source.name == "source.pdf" and output.name == "output.pdf" and
                source.parent == output.parent and
                source.parent.name.startswith("pdf-private-")):
            raise ValueError("bad temporary file location")
        result = (strict_preflight(source, original, replacement)
                  if operation == "preflight" else
                  strict_apply(source, output, original, replacement))
        # File paths and details intentionally omitted from stdout.
        response = {"allowed": result.allowed, "code": result.code,
                    "message": result.message}
    except Exception:
        response = {"allowed": False, "code": "UNSUPPORTED_PDF",
                    "message": "PDF 檢查失敗，可能包含未支援的字型或結構"}
    sys.stdout.write(json.dumps(response, ensure_ascii=False))


if __name__ == "__main__":
    main()
