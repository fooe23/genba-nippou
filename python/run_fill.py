#!/usr/bin/env python3
"""ローカル開発用：stdin の JSON から xlsm を作って stdout に書く。

入力（stdin）: {"template": "<雛形のパス>", "payload": {...}}
出力（stdout）: xlsm のバイト列
失敗時: stderr に {"code": "...", "message": "..."} を 1 行書いて exit 1
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from genba_export.fill import ExportError, fill_workbook  # noqa: E402


def _fail(code: str, message: str) -> int:
    sys.stderr.write(json.dumps({"code": code, "message": message}, ensure_ascii=False) + "\n")
    sys.stderr.flush()
    return 1


def main() -> int:
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _fail("invalid_request", "入力の JSON を読めませんでした")
    if not isinstance(req, dict) or not isinstance(req.get("payload"), dict):
        return _fail("invalid_request", "入力に template と payload が必要です")
    try:
        data = fill_workbook(req.get("template") or "", req["payload"])
    except ExportError as e:
        return _fail(e.code, e.message)
    except Exception as e:  # 想定外の失敗も JSON 1 行で返す
        return _fail("internal_error", "Excel の作成に失敗しました（%s）" % type(e).__name__)
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
