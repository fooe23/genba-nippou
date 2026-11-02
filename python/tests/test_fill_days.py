"""Task 2：日報シート（N回目）への書き込み。"""
from __future__ import annotations

import copy
import datetime
import re
import unittest

from python.tests.test_fill_masters import TEMPLATE, load_fixture, open_book

from genba_export.fill import ExportError, fill_workbook, to_date_from_iso

# openpyxl は日付の表示形式が付いたセルを datetime で読み戻す（書いたのは datetime.date）
NOV_1 = datetime.datetime(2026, 11, 1)
NOV_2 = datetime.datetime(2026, 11, 2)


def days_payload() -> dict:
    return copy.deepcopy(load_fixture("payload_days.json"))


def labor_row(name: str, **kw) -> dict:
    row = {"name": name, "start": None, "end": None, "break_min": None, "gap_min": None, "note": None,
           "daily_rate": 18000, "master_daily_rate": 18000}
    row.update(kw)
    return row


class FillDaysTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wb = open_book(fill_workbook(TEMPLATE, days_payload()))
        cls.src = open_book(TEMPLATE)

    def test_day_sheet_values(self):
        ws = self.wb["1回目"]
        self.assertIsInstance(ws["F2"].value, datetime.datetime)   # 文字列ではなく日付
        self.assertEqual(ws["F2"].value, NOV_1)
        self.assertEqual(ws["F3"].value, "晴れ")
        self.assertEqual(ws["F4"].value, "検証太郎")
        self.assertEqual([ws["B6"].value, ws["C6"].value, ws["D6"].value, ws["E6"].value],
                         [datetime.time(8, 0), datetime.time(17, 30), 90, 0])
        self.assertEqual([ws["B8"].value, ws["C8"].value, ws["D8"].value, ws["L8"].value],
                         ["山田 太郎", None, None, "大工"])   # 共通時間の行
        self.assertEqual([ws["B9"].value, ws["C9"].value, ws["D9"].value, ws["E9"].value],
                         ["鈴木 一郎", datetime.time(8, 0), datetime.time(12, 0), 0])
        self.assertEqual(ws["J8"].value, "=IFERROR(VLOOKUP(B8,マスター!$B$3:$D$32,3,0),0)")  # 数式のまま
        self.assertEqual(ws["J9"].value, "=IFERROR(VLOOKUP(B9,マスター!$B$3:$D$32,3,0),0)")
        self.assertEqual([ws["B21"].value, ws["D21"].value, ws["E21"].value], ["ハイエース", 40, 170])
        self.assertEqual([ws["B27"].value, ws["E27"].value], ["発電機", 2])
        self.assertEqual(ws["F27"].value, "=IFERROR(VLOOKUP(B27,マスター!$T$3:$W$22,3,0),0)")  # 数式のまま
        self.assertEqual([ws["B36"].value, ws["F36"].value, ws["H36"].value], ["ビス", 500, "ホームセンター"])
        self.assertEqual([ws["B45"].value, ws["H45"].value], ["合板", "○○建材"])
        self.assertEqual([ws["E60"].value, ws["H60"].value], [10600, 50000])
        self.assertEqual([ws["B63"].value, ws["C63"].value, ws["E63"].value, ws["G63"].value, ws["I63"].value],
                         ["解体", "外壁撤去", 10, 1.5, 5000])
        self.assertEqual(ws["A71"].value, "追加工事の指示あり\n・サッシ追加 2 か所")
        self.assertEqual(ws["A76"].value, "【通算12回目】\n雨天のため午後中止")
        self.assertEqual([ws["B80"].value, ws["E80"].value, ws["H80"].value, ws["K80"].value],
                         ["検証太郎", "確認花子", "承認次郎", NOV_2])

    def test_number_formats(self):
        # 原本に表示形式があるセルはそのまま。General の日付セルは日付の表示形式になる
        ws, src = self.wb["1回目"], self.src["1回目"]
        for ref in ("B6", "C6", "D6", "E6", "C9", "D9", "E9", "E60", "H60", "E63", "G63", "I63"):
            self.assertEqual(ws[ref].number_format, src[ref].number_format, ref)
        self.assertEqual(ws["C9"].number_format, "h:mm")
        for ref in ("F2", "K80"):
            self.assertTrue(ws[ref].is_date, ref)

    def test_second_sheet_rows_below_work_table(self):
        # 原本の 2回目 は作業内容が 8 行あり、重要事項・連絡事項・署名欄が 2 行下（A73・A78・82 行）
        ws = self.wb["2回目"]
        self.assertEqual(ws["F2"].value, NOV_2)
        self.assertEqual(ws["A71"].value, self.src["2回目"]["A71"].value)   # 「作業内容 投入人工計 →」のまま
        self.assertIsNone(ws["A73"].value)                                  # 重要事項なし
        self.assertEqual(ws["A78"].value, "【通算13回目】")                  # 連絡事項は回目だけ
        self.assertEqual([ws["B82"].value, ws["E82"].value, ws["H82"].value, ws["K82"].value],
                         ["検証太郎", None, None, None])                      # 承認なし
        self.assertIsNone(ws["B80"].value)

    def test_untouched_day_sheets_and_empty_fields(self):
        for i in range(3, 32):
            self.assertIsNone(self.wb["%d回目" % i]["F2"].value, "%d回目" % i)
        # 日報の無いシートは原本のまま（値と表示形式）
        out, src = self.wb["3回目"], self.src["3回目"]
        for row in src.iter_rows():
            for c in row:
                o = out[c.coordinate]
                self.assertEqual((o.value, o.number_format), (c.value, c.number_format), "3回目!%s" % c.coordinate)
        # 2 日目は明細なし：明細行は原本のまま
        ws, s2 = self.wb["2回目"], self.src["2回目"]
        for r in list(range(8, 18)) + list(range(21, 24)) + list(range(27, 33)) + list(range(63, 71)):
            for col in "BCDEFGHIJKL":
                ref = "%s%d" % (col, r)
                self.assertEqual(ws[ref].value, s2[ref].value, "2回目!%s" % ref)

    def test_layout_matches_template(self):
        # 31 シートすべてで、対応表の行が原本の見出しと合っていること（書き込み先が数式・結合の途中でないこと）
        from genba_export import layout
        from openpyxl.cell.cell import MergedCell
        for sheet in layout.DAY_SHEETS:
            ws = self.src[sheet]
            cells, tables = layout.day_cells(sheet), layout.day_tables(sheet)
            issues_row = ws[cells["issues"]].row
            notes_row = ws[cells["notes"]].row
            self.assertTrue(str(ws.cell(issues_row - 1, 1).value).startswith("施工や工事金額に影響する"), sheet)
            self.assertTrue(str(ws.cell(notes_row - 1, 1).value).startswith("上記の重要事項以外で"), sheet)
            self.assertEqual(ws.cell(ws[cells["created_by"]].row, 1).value, "作成者", sheet)
            self.assertTrue(str(ws.cell(tables["work"]["total_row"], 1).value).startswith("作業内容"), sheet)
            targets = list(cells.values())
            for t in tables.values():
                for r in range(t["first_row"], t["last_row"] + 1):
                    self.assertIsInstance(ws.cell(r, 1).value, int, "%s 行 %d は明細行のはず" % (sheet, r))
                    targets += ["%s%d" % (col, r) for col in t["columns"].values()]
                    for spec in t["formula_columns"].values():
                        self.assertTrue(str(ws["%s%d" % (spec["column"], r)].value).startswith("="), sheet)
                # 最終明細行の次は明細行（項番の連番）ではない
                self.assertNotIsInstance(ws.cell(t["last_row"] + 1, 1).value, int,
                                         "%s 行 %d は明細行ではないはず" % (sheet, t["last_row"] + 1))
                # 合計行の SUM の範囲が first_row:last_row と一致する
                sums = [m.groups() for c in ws[t["total_row"]] if isinstance(c.value, str)
                        for m in re.finditer(r"SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)", c.value)]
                self.assertTrue(sums, "%s 行 %d に SUM が無い" % (sheet, t["total_row"]))
                for first, last in sums:
                    self.assertEqual((int(first), int(last)), (t["first_row"], t["last_row"]),
                                     "%s 行 %d の SUM 範囲" % (sheet, t["total_row"]))
            for ref in targets:
                self.assertNotIsInstance(ws[ref], MergedCell, "%s!%s" % (sheet, ref))
                v = ws[ref].value
                self.assertFalse(isinstance(v, str) and v.startswith("="), "%s!%s は数式" % (sheet, ref))


class FillDayVariantsTest(unittest.TestCase):
    """日当・リース単価の上書き規則と、受け取った値をそのまま書くこと。"""

    @classmethod
    def setUpClass(cls):
        payload = days_payload()
        day = payload["days"][0]
        day["labor"] = [
            labor_row("山田 太郎", daily_rate=19000, master_daily_rate=18000),      # 月途中で日当が変わった
            labor_row("鈴木 一郎", daily_rate=16000, master_daily_rate=16000),
            labor_row("佐藤 次郎", break_min=30),                                   # 休憩だけ個別
            labor_row("田中 三郎", daily_rate=None, master_daily_rate=None),
        ]
        day["lease"].append({"name": "高所作業車", "spec": "10m", "unit": "日", "qty": 1, "note": None,
                             "unit_price": 3500, "master_unit_price": 3000})
        day["work"] = [{"trade": "工種%d" % i, "qty": i} for i in range(1, 7)]           # 1回目 は 6 行まで
        day["approved_at"] = "2026-11-01T16:30:00Z"                                      # 日本時間で 11/2 01:30
        day["output_total"] = ""
        day["notes_text"] = "1 行目\r\n2 行目\r3 行目"
        day2 = payload["days"][1]
        day2["work"] = [{"trade": "工種%d" % i, "qty": i} for i in range(1, 9)]          # 2回目 は 8 行まで
        day2["approved_at"] = "2026-11-01T14:59:00Z"                                     # 日本時間で 11/1 23:59
        wb = open_book(fill_workbook(TEMPLATE, payload))
        cls.ws, cls.ws2 = wb["1回目"], wb["2回目"]

    def test_rate_override_when_snapshot_differs(self):
        ws = self.ws
        self.assertEqual(ws["J8"].value, 19000)
        self.assertEqual(ws["J8"].number_format, "#,##0")
        for r in (9, 10, 11):
            self.assertEqual(ws["J%d" % r].value, "=IFERROR(VLOOKUP(B%d,マスター!$B$3:$D$32,3,0),0)" % r)
        self.assertEqual(ws["F27"].value, "=IFERROR(VLOOKUP(B27,マスター!$T$3:$W$22,3,0),0)")
        self.assertEqual(ws["F28"].value, 3500)

    def test_writes_values_as_given(self):
        # 共通の開始・終了を補うのは TypeScript 側。Python は受け取った値を書くだけ
        ws = self.ws
        self.assertEqual([ws["B10"].value, ws["C10"].value, ws["D10"].value, ws["E10"].value, ws["F10"].value],
                         ["佐藤 次郎", None, None, 30, None])


    def test_work_rows_fill_template_rows(self):
        self.assertEqual([self.ws["B%d" % r].value for r in range(63, 69)], ["工種%d" % i for i in range(1, 7)])
        self.assertEqual([self.ws2["B%d" % r].value for r in range(63, 71)], ["工種%d" % i for i in range(1, 9)])
        self.assertEqual([self.ws2["E69"].value, self.ws2["E70"].value], [7, 8])
        self.assertEqual(self.ws2["J70"].value, "=IFERROR(E70*I70,0)")   # 明細の数式はそのまま
        self.assertEqual(self.ws2["J71"].value, "=SUM(J63:J70)")

    def test_approved_at_is_japan_date(self):
        self.assertEqual(self.ws["K80"].value, datetime.datetime(2026, 11, 2))
        self.assertEqual(self.ws2["K82"].value, datetime.datetime(2026, 11, 1))

    def test_blank_number_and_newlines(self):
        self.assertIsNone(self.ws["H60"].value)
        self.assertEqual(self.ws["A76"].value, "【通算12回目】\n1 行目\n2 行目\n3 行目")


class ToDateFromIsoTest(unittest.TestCase):
    """承認日：時差付きは日本時間に直してから日付を取る（雛形を開かないので速い）。"""

    def test_converts_to_japan_date(self):
        cases = {
            "2026-11-01T16:30:00+00:00": datetime.date(2026, 11, 2),
            "2026-11-01T16:30:00Z": datetime.date(2026, 11, 2),
            "2026-11-02T00:30:00+09:00": datetime.date(2026, 11, 2),
            "2026-11-01T14:59:00Z": datetime.date(2026, 11, 1),
            "2026-11-01T14:59:59.999999+00:00": datetime.date(2026, 11, 1),
            "2026-11-01T15:00:00.1234567+00:00": datetime.date(2026, 11, 2),   # 小数 7 桁
            "2026-11-01T20:00:00+0000": datetime.date(2026, 11, 2),
            "2026-11-01T20:00:00-05:00": datetime.date(2026, 11, 2),
            "2026-11-01T23:30:00": datetime.date(2026, 11, 1),                 # 時差なしはそのまま
            "2026-11-01": datetime.date(2026, 11, 1),
        }
        for value, expected in cases.items():
            self.assertEqual(to_date_from_iso(value), expected, value)
        self.assertIsNone(to_date_from_iso(None))
        self.assertIsNone(to_date_from_iso(""))

    def test_invalid(self):
        for value in ("2026/11/01", "2026-13-01T00:00:00Z", "昨日"):
            with self.assertRaises(ExportError) as cm:
                to_date_from_iso(value, "承認日")
            self.assertEqual(cm.exception.code, "invalid_payload")
            self.assertIn("承認日", cm.exception.message)


class FillDayErrorsTest(unittest.TestCase):
    def assertExportError(self, payload: dict, code: str) -> ExportError:
        with self.assertRaises(ExportError) as cm:
            fill_workbook(TEMPLATE, payload)
        self.assertEqual(cm.exception.code, code)
        return cm.exception

    def test_too_many_days(self):
        payload = days_payload()
        base = payload["days"][1]
        payload["days"] = [dict(copy.deepcopy(base), index=i, date="2026-11-%02d" % min(i, 30)) for i in range(1, 33)]
        e = self.assertExportError(payload, "too_many_days")
        self.assertIn("32", e.message)

    def test_too_many_rows_without_insert(self):
        # Task 6 で行挿入に置き換える
        payload = days_payload()
        payload["days"][0]["labor"] = [labor_row("作業員%d" % i) for i in range(1, 12)]
        e = self.assertExportError(payload, "rows_overflow")
        self.assertEqual(e.message, "2026年11月1日 の作業員が11行で、雛形の10行を超えています")

    def test_work_rows_overflow(self):
        # 作業内容は 1回目 などが 6 行、原本で 8 行ある 2回目 は 8 行まで
        payload = days_payload()
        payload["days"][0]["work"] = [{"trade": "解体"} for _ in range(7)]
        e = self.assertExportError(payload, "rows_overflow")
        self.assertEqual(e.message, "2026年11月1日 の作業内容が7行で、雛形の6行を超えています")
        payload = days_payload()
        payload["days"][1]["work"] = [{"trade": "解体"} for _ in range(9)]
        e = self.assertExportError(payload, "rows_overflow")
        self.assertEqual(e.message, "2026年11月2日 の作業内容が9行で、雛形の8行を超えています")

    def test_invalid_day_index(self):
        for index in (0, 32, None, "1"):
            payload = days_payload()
            payload["days"][0]["index"] = index
            self.assertExportError(payload, "invalid_payload")
        payload = days_payload()
        payload["days"][1]["index"] = 1
        e = self.assertExportError(payload, "invalid_payload")
        self.assertIn("重複", e.message)

    def test_error_messages_use_japanese_field_names(self):
        payload = days_payload()
        payload["site"]["start_date"] = "2026/10/01"
        e = self.assertExportError(payload, "invalid_payload")
        self.assertIn("着工予定日", e.message)
        self.assertNotIn("start_date", e.message)
        payload = days_payload()
        payload["days"][0]["labor"][1]["start"] = "8時"
        e = self.assertExportError(payload, "invalid_payload")
        self.assertEqual(e.message, "2026年11月1日 の作業員 2 行目の開始時刻の形式が正しくありません（8時）")


if __name__ == "__main__":
    unittest.main()
