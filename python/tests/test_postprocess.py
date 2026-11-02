"""Task 3：保存後の復元（行追加ボタン）と、原本との差分。

openpyxl で保存すると、日報シートの「＋ 行追加」ボタン（drawing パーツ）が落ちる。
postprocess.restore_parts が原本から戻していること、それ以外が原本のままであることを確かめる。
"""
from __future__ import annotations

import io
import posixpath
import re
import unittest
import zipfile
import xml.etree.ElementTree as ET

from python.tests.test_fill_days import days_payload
from python.tests.test_fill_masters import TEMPLATE, open_book

from genba_export import layout
from genba_export.fill import fill_workbook
from genba_export.postprocess import rels_path, restore_parts, sheet_paths

NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml"
DRAWING_RID = re.compile(r'<drawing\b[^>]*\br:id="([^"]+)"')
DV_SQREF = re.compile(r'<dataValidation\s[^>]*?\bsqref="([^"]*)"')


def written_cells(payload: dict) -> dict:
    """fill_workbook が payload で書くセル：シート名 → {"A1", ...}。"""
    out = {}
    site = out.setdefault(layout.SITE_INFO_SHEET, set())
    site.update(layout.SITE_INFO_CELLS.values())
    settings = payload.get("settings") or {}
    site.update(cell for key, cell in layout.SETTINGS_CELLS.items() if settings.get(key) is not None)

    master = out.setdefault(layout.MASTER_SHEET, set())
    for block in layout.MASTER_BLOCKS.values():
        for row in range(block["first_row"], block["last_row"] + 1):
            master.update("%s%d" % (col, row) for col in block["columns"].values())
    spec = layout.CARRYOVER_ROWS
    for row in range(spec["first_row"], spec["last_row"] + 1):
        master.update("%s%d" % (col, row) for col in spec["columns"].values())

    for day in payload.get("days") or []:
        sheet = layout.DAY_SHEETS[day["index"] - 1]
        cells = out.setdefault(sheet, set())
        cells.update(layout.day_cells(sheet).values())
        for key, table in layout.day_tables(sheet).items():
            for i, item in enumerate(day.get(key) or []):
                row = table["first_row"] + i
                cells.update("%s%d" % (col, row) for col in table["columns"].values())
                for field, f in table["formula_columns"].items():
                    value = item.get(field)
                    if value is not None and value != item.get(f["master_key"]):
                        cells.add("%s%d" % (f["column"], row))
    return out


class RestorePartsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = days_payload()
        cls.out = fill_workbook(TEMPLATE, cls.payload)
        cls.zo = zipfile.ZipFile(io.BytesIO(cls.out))
        cls.zt = zipfile.ZipFile(TEMPLATE)
        cls.out_parts = sheet_paths(cls.zo)
        cls.tpl_parts = sheet_paths(cls.zt)

    @classmethod
    def tearDownClass(cls):
        cls.zo.close()
        cls.zt.close()

    def sheet_xml(self, z: zipfile.ZipFile, parts: dict, sheet: str) -> str:
        return z.read(parts[sheet]).decode("utf-8")

    def test_zip_is_sound(self):
        self.assertIsNone(self.zo.testzip())
        self.assertEqual(self.zo.namelist()[0], "[Content_Types].xml")
        self.assertEqual(len(self.zo.namelist()), len(set(self.zo.namelist())))   # 同名のパーツが無い

    def test_drawing_parts_restored(self):
        drawings = lambda z: [n for n in z.namelist() if n.startswith("xl/drawings/") and "/_rels/" not in n]
        self.assertEqual(len(drawings(self.zt)), 32)     # ボタン 31 + コメント用 vml 1
        self.assertEqual(len(drawings(self.zo)), len(drawings(self.zt)))
        names = set(self.zo.namelist())
        ct = self.zo.read("[Content_Types].xml").decode("utf-8")
        self.assertIn(CT_DRAWING, ct)
        for sheet in layout.DAY_SHEETS:
            part = self.out_parts[sheet]
            rids = DRAWING_RID.findall(self.sheet_xml(self.zo, self.out_parts, sheet))
            self.assertEqual(len(rids), 1, sheet)
            rels = ET.fromstring(self.zo.read(rels_path(part)))
            rel = [r for r in rels.findall("{%s}Relationship" % NS_PKG_REL) if r.get("Id") == rids[0]]
            self.assertEqual(len(rel), 1, sheet)
            self.assertEqual(rel[0].get("Type"), REL_DRAWING, sheet)
            target = posixpath.normpath(posixpath.join(posixpath.dirname(part), rel[0].get("Target")))
            self.assertIn(target, names, sheet)
            self.assertIn('PartName="/%s" ContentType="%s"' % (target, CT_DRAWING), ct, sheet)

    def test_drawing_content_matches_template(self):
        """シートごとに、原本と同じボタン（drawing XML がバイト一致）が付いている。"""
        def drawing_of(z, parts, sheet):
            part = parts[sheet]
            rid = DRAWING_RID.findall(z.read(part).decode("utf-8"))[0]
            rels = ET.fromstring(z.read(rels_path(part)))
            target = [r.get("Target") for r in rels if r.get("Id") == rid][0]
            return z.read(posixpath.normpath(posixpath.join(posixpath.dirname(part), target)))
        for sheet in layout.DAY_SHEETS:
            self.assertEqual(drawing_of(self.zo, self.out_parts, sheet),
                             drawing_of(self.zt, self.tpl_parts, sheet), sheet)

    def test_drawing_element_position(self):
        """<drawing> は rowBreaks などの後、</worksheet>（legacyDrawing 等がある場合はその前）。"""
        for sheet in layout.DAY_SHEETS:
            x = self.sheet_xml(self.zo, self.out_parts, sheet)
            pos = x.index("<drawing ")
            for before in ("</sheetData>", "<pageMargins", "<pageSetup", "<rowBreaks"):
                if before in x:
                    self.assertLess(x.index(before), pos, "%s %s" % (sheet, before))
            for after in ("<legacyDrawing ", "<tableParts", "<extLst"):
                if after in x:
                    self.assertGreater(x.index(after), pos, "%s %s" % (sheet, after))

    def test_vba_comments_and_validations_kept(self):
        self.assertEqual(self.zo.read("xl/vbaProject.bin"), self.zt.read("xl/vbaProject.bin"))
        self.assertIn("xl/comments/comment1.xml", self.zo.namelist())
        for sheet in layout.DAY_SHEETS:
            src = DV_SQREF.findall(self.sheet_xml(self.zt, self.tpl_parts, sheet))
            out = DV_SQREF.findall(self.sheet_xml(self.zo, self.out_parts, sheet))
            self.assertEqual(len(src), 9, sheet)
            self.assertEqual(len(out), len(src), sheet)
            self.assertEqual(sorted(out), sorted(src), sheet)

    def test_reopens_with_openpyxl(self):
        wb = open_book(self.out)
        self.assertEqual(wb.sheetnames, open_book(TEMPLATE).sheetnames)
        self.assertEqual(wb["1回目"]["F3"].value, "晴れ")

    def test_only_written_cells_differ(self):
        """原本との全セル差分：fill が書いたセル以外は、値（数式文字列を含む）が原本と同じ。"""
        src = open_book(TEMPLATE)
        out = open_book(self.out)
        written = written_cells(self.payload)
        self.assertIn("A71", written["1回目"])
        for sheet in ("1回目", "2回目", layout.MASTER_SHEET, layout.SITE_INFO_SHEET, "月次集計"):
            ws_s, ws_o = src[sheet], out[sheet]
            skip = written.get(sheet, set())
            max_row = max(ws_s.max_row, ws_o.max_row)
            max_col = max(ws_s.max_column, ws_o.max_column)
            diffs = []
            for row in range(1, max_row + 1):
                for col in range(1, max_col + 1):
                    c = ws_s.cell(row, col)
                    if c.coordinate in skip:
                        continue
                    v = ws_o.cell(row, col).value
                    if v != c.value:
                        diffs.append("%s: %r -> %r" % (c.coordinate, c.value, v))
            self.assertEqual(diffs, [], sheet)


class RestoreEdgeCasesTest(unittest.TestCase):
    """rId の衝突・二度がけ。openpyxl で原本を開いて保存しただけの zip を使う。"""

    @classmethod
    def setUpClass(cls):
        buf = io.BytesIO()
        open_book(TEMPLATE).save(buf)
        cls.saved = buf.getvalue()

    def test_rid_collision_gets_new_id(self):
        # 1回目 のシートの rels に、原本の drawing と同じ Id（別の型）を先に入れておく
        with zipfile.ZipFile(io.BytesIO(self.saved)) as z:
            part = sheet_paths(z)["1回目"]
            entries = [(n, z.read(n)) for n in z.namelist()]
        self.assertNotIn(rels_path(part), dict(entries))
        dummy = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                 '<Relationships xmlns="%s"><Relationship Id="rIdV34drw" '
                 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
                 'Target="https://example.com/" TargetMode="External"/></Relationships>' % NS_PKG_REL)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zw:
            for n, data in entries:
                zw.writestr(n, data)
            zw.writestr(rels_path(part), dummy)
        out = restore_parts(TEMPLATE, buf.getvalue())
        with zipfile.ZipFile(io.BytesIO(out)) as z:
            rid = DRAWING_RID.findall(z.read(part).decode("utf-8"))
            ids = [r.get("Id") for r in ET.fromstring(z.read(rels_path(part)))]
        self.assertEqual(rid, ["rIdDrw1"])
        self.assertEqual(ids, ["rIdV34drw", "rIdDrw1"])

    def test_second_run_changes_nothing(self):
        once = restore_parts(TEMPLATE, self.saved)
        self.assertNotEqual(once, self.saved)
        self.assertEqual(restore_parts(TEMPLATE, once), once)


if __name__ == "__main__":
    unittest.main()
