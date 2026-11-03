"""api/export/fill.py（Vercel の Python 関数）の秘密の確認と失敗の返し方。"""
from __future__ import annotations

import importlib.util
import json
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(ROOT, "python", "tests", "fixtures")

_spec = importlib.util.spec_from_file_location("api_export_fill", os.path.join(ROOT, "api", "export", "fill.py"))
api_fill = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_fill)  # type: ignore[union-attr]


def _payload_bytes() -> bytes:
    with open(os.path.join(FIXTURES, "payload_days.json"), "rb") as f:
        return f.read()


def _json(body: bytes) -> dict:
    return json.loads(body.decode("utf-8"))


class SecretTest(unittest.TestCase):
    def test_secret_mismatch_is_403(self):
        status, ctype, body = api_fill.handle_fill("wrong", _payload_bytes(), "s3cret")
        self.assertEqual(status, 403)
        self.assertTrue(ctype.startswith("application/json"))
        self.assertEqual(_json(body)["code"], "forbidden")

    def test_missing_header_or_unset_env_is_403(self):
        self.assertEqual(api_fill.handle_fill(None, _payload_bytes(), "s3cret")[0], 403)
        self.assertEqual(api_fill.handle_fill("", _payload_bytes(), "s3cret")[0], 403)
        # 環境変数が無いときは、空のヘッダーでも通さない
        self.assertEqual(api_fill.handle_fill("", _payload_bytes(), None)[0], 403)
        self.assertEqual(api_fill.handle_fill("x", _payload_bytes(), "")[0], 403)


class ErrorMappingTest(unittest.TestCase):
    def test_bad_json_is_400(self):
        status, _, body = api_fill.handle_fill("s", b"{not json", "s")
        self.assertEqual(status, 400)
        self.assertEqual(_json(body)["code"], "invalid_request")
        self.assertEqual(api_fill.handle_fill("s", b"[1, 2]", "s")[0], 400)

    def test_invalid_payload_is_400_with_python_message(self):
        payload = json.loads(_payload_bytes())
        payload["days"][0]["index"] = 99
        status, _, body = api_fill.handle_fill("s", json.dumps(payload).encode("utf-8"), "s")
        self.assertEqual(status, 400)
        self.assertEqual(_json(body)["code"], "invalid_payload")
        self.assertIn("回目", _json(body)["message"])

    def test_missing_template_is_500(self):
        status, _, body = api_fill.handle_fill("s", _payload_bytes(), "s", template="/nonexistent.xlsm")
        self.assertEqual(status, 500)
        self.assertEqual(_json(body)["code"], "template_not_found")

    def test_success_returns_xlsm(self):
        status, ctype, body = api_fill.handle_fill("s", _payload_bytes(), "s")
        self.assertEqual(status, 200)
        self.assertEqual(ctype, "application/vnd.ms-excel.sheet.macroEnabled.12")
        self.assertEqual(body[:2], b"PK")


if __name__ == "__main__":
    unittest.main()
