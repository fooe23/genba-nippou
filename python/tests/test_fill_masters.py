"""Task 1：現場情報・マスター・前月繰越の書き込みと、それ以外が原本のままであること。"""
from __future__ import annotations

import copy
import datetime
import io
import json
import os
import subprocess
import sys
import unittest
import warnings
import zipfile

from python.tests import PROJECT_ROOT

import openpyxl

from genba_export.fill import ExportError, fill_workbook

TEMPLATE = os.path.join(PROJECT_ROOT, "templates", "現場管理台帳_V34_原本.xlsm")
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

warnings.filterwarnings("ignore", message="Data Validation extension")


def load_fixture(name: str) -> dict:
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return json.load(f)


def payload_with_workers(n: int) -> dict:
    payload = copy.deepcopy(load_fixture("payload_small.json"))
    payload["workers"] = [
        {"name": "作業員%d" % i, "trade": None, "daily_rate": 15000, "overtime_rate": None,
         "note": None, "carry_man_days": 0, "carry_cost": 0}
        for i in range(1, n + 1)
    ]
    return payload


def open_book(data) -> openpyxl.Workbook:
    src = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Data Validation extension")
        return openpyxl.load_workbook(src, keep_vba=True)


class FillMastersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = fill_workbook(TEMPLATE, load_fixture("payload_small.json"))

    def test_site_info_and_masters_written(self):
        wb = open_book(self.out)
        info = wb["現場情報マスター"]
        self.assertEqual(info["D4"].value, "検証現場")
        self.assertEqual(info["D9"].value, 12000000)
        # openpyxl は日付書式のセルを datetime で読み戻す（書いたのは date(2026, 10, 1)）
        self.assertEqual(info["D10"].value, datetime.datetime(2026, 10, 1))
        self.assertEqual(info["D25"].value, 7.5)
        m = wb["マスター"]
        self.assertEqual([m["B3"].value, m["C3"].value, m["D3"].value, m["E3"].value, m["F3"].value],
                         ["山田 太郎", "大工", 18000, None, "備考A"])
        self.assertEqual(m["E4"].value, 3000)        # 残業単価あり
        self.assertEqual(m["H3"].value, "○○建材")
        self.assertEqual(m["P3"].value, 9.5)         # 車両 燃費
        self.assertEqual(m["V3"].value, 3000)        # リース単価
        self.assertEqual([m["C36"].value, m["D36"].value], [12.5, 225000])  # 前月繰越
        self.assertEqual([m["C37"].value, m["D37"].value], [0, 0])

    def test_unused_master_rows_are_cleared(self):
        # 雛形のマスターに入っている見本の行は残さない（出力対象の作業員だけにする）
        m = open_book(self.out)["マスター"]
        for r in range(5, 33):
            self.assertEqual([m.cell(r, c).value for c in range(2, 7)], [None] * 5, "マスター 行 %d" % r)
        self.assertEqual([m["H4"].value, m["N4"].value, m["T4"].value], [None, None, None])
        self.assertEqual([m["C38"].value, m["D38"].value], [0, 0])

    def test_template_untouched_elsewhere(self):
        # 書いたセル以外は原本と同じ：数式・定義名・VBA・シート名
        src = open_book(TEMPLATE)
        out = open_book(self.out)
        for sheet, cells in (("1回目", ["G8", "H8", "I8", "J8", "K8"]),
                             ("月次集計", ["A4", "D4"]),
                             ("マスター", ["E36"])):
            for c in cells:
                self.assertIsInstance(src[sheet][c].value, str, "%s!%s は数式のはず" % (sheet, c))
                self.assertTrue(src[sheet][c].value.startswith("="), "%s!%s は数式のはず" % (sheet, c))
                self.assertEqual(out[sheet][c].value, src[sheet][c].value, "%s!%s" % (sheet, c))
        for name in ("GN_SHOTEI", "GN_ZANGYO_JOGEN", "GN_WARIMASHI", "GN_ZANGYO_KIJUN"):
            self.assertIn(name, out.defined_names)
            self.assertEqual(out.defined_names[name].attr_text, src.defined_names[name].attr_text, name)
        self.assertEqual(out.sheetnames, src.sheetnames)
        with zipfile.ZipFile(TEMPLATE) as zs, zipfile.ZipFile(io.BytesIO(self.out)) as zo:
            self.assertEqual(zo.read("xl/vbaProject.bin"), zs.read("xl/vbaProject.bin"))

    def test_more_than_30_workers_fails(self):
        with self.assertRaises(ExportError) as cm:
            fill_workbook(TEMPLATE, payload_with_workers(31))
        self.assertEqual(cm.exception.code, "too_many_workers")

    def test_30_workers_fit(self):
        out = fill_workbook(TEMPLATE, payload_with_workers(30))
        m = open_book(out)["マスター"]
        self.assertEqual(m["B32"].value, "作業員30")

    def test_missing_template_fails(self):
        with self.assertRaises(ExportError) as cm:
            fill_workbook(os.path.join(FIXTURES, "no_such_template.xlsm"), load_fixture("payload_small.json"))
        self.assertEqual(cm.exception.code, "template_not_found")


class RunFillTest(unittest.TestCase):
    """python/run_fill.py（stdin の JSON → stdout の xlsm、失敗は stderr に JSON 1 行）。"""
    SCRIPT = os.path.join(PROJECT_ROOT, "python", "run_fill.py")

    def run_script(self, req: dict) -> subprocess.CompletedProcess:
        return subprocess.run([sys.executable, self.SCRIPT], input=json.dumps(req).encode("utf-8"),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)

    def test_writes_xlsm_to_stdout(self):
        res = self.run_script({"template": TEMPLATE, "payload": load_fixture("payload_small.json")})
        self.assertEqual(res.returncode, 0, res.stderr.decode("utf-8"))
        self.assertEqual(open_book(res.stdout)["現場情報マスター"]["D4"].value, "検証現場")

    def test_error_is_one_json_line_on_stderr(self):
        res = self.run_script({"template": TEMPLATE, "payload": payload_with_workers(31)})
        self.assertEqual(res.returncode, 1)
        self.assertEqual(res.stdout, b"")
        lines = res.stderr.decode("utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        err = json.loads(lines[0])
        self.assertEqual(err["code"], "too_many_workers")
        self.assertTrue(err["message"])


if __name__ == "__main__":
    unittest.main()
