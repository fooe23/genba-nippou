"""Vercel の Python 関数：payload（月次データ）を V34 雛形に書いた xlsm を返す。

POST /api/export/fill
  ヘッダー X-Export-Secret: 環境変数 GN_EXPORT_SECRET と同じ値（Next の Route Handler だけが知っている）
  本文: payload の JSON（src/lib/export/types.ts の ExportPayload）
成功: 200、application/vnd.ms-excel.sheet.macroEnabled.12 の xlsm
失敗: 400/403/405/500、JSON {"code": "...", "message": "..."}

Vercel では Python 3.12。ローカルの単体テスト（python3 3.9）でも動くように書く。
"""
from __future__ import annotations

import hmac
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from typing import Optional, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "python"))

from genba_export.fill import ExportError, fill_workbook  # noqa: E402

TEMPLATE = os.path.join(ROOT, "templates", "現場管理台帳_V34_原本.xlsm")
XLSM_TYPE = "application/vnd.ms-excel.sheet.macroEnabled.12"
JSON_TYPE = "application/json; charset=utf-8"

Response = Tuple[int, str, bytes]


def _error(status: int, code: str, message: str) -> Response:
    body = json.dumps({"code": code, "message": message}, ensure_ascii=False).encode("utf-8")
    return status, JSON_TYPE, body


def handle_fill(secret_header: Optional[str], body: bytes, env_secret: Optional[str], template: str = TEMPLATE) -> Response:
    """POST の中身。秘密の確認 → JSON → fill_workbook。HTTP に依存しないのでそのままテストできる。"""
    if not env_secret or not secret_header or not hmac.compare_digest(secret_header.encode("utf-8"), env_secret.encode("utf-8")):
        return _error(403, "forbidden", "この操作は許可されていません")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return _error(400, "invalid_request", "入力の JSON を読めませんでした")
    if not isinstance(payload, dict):
        return _error(400, "invalid_request", "出力データの形式が正しくありません")
    try:
        data = fill_workbook(template, payload)
    except ExportError as e:
        status = 500 if e.code == "template_not_found" else 400
        return _error(status, e.code, e.message)
    except Exception as e:  # 想定外の失敗も JSON で返す
        return _error(500, "internal_error", "Excel の作成に失敗しました（%s）" % type(e).__name__)
    return 200, XLSM_TYPE, data


class handler(BaseHTTPRequestHandler):  # noqa: N801（Vercel が探す名前）
    def _send(self, response: Response) -> None:
        status, content_type, body = response
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length > 0 else b""
        self._send(handle_fill(self.headers.get("X-Export-Secret"), body, os.environ.get("GN_EXPORT_SECRET")))

    def do_GET(self) -> None:  # noqa: N802
        self._send(_error(405, "method_not_allowed", "POST で呼んでください"))
