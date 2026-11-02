"""openpyxl で保存した xlsm を、原本の zip から補う。

openpyxl は日報シートの「＋ 行追加」ボタン（マクロ登録済みの図形 = drawing パーツ）を
読み込み時に落とす。保存後の zip に原本の drawing を戻す。
入力規則（標準の dataValidations）・コメント・定義名・VBA は openpyxl が保持する
（VBA は念のため、無ければ原本から足す）。
"""
from __future__ import annotations

import io
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import quoteattr

VBA_PART = "xl/vbaProject.bin"

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def sheet_paths(zf: zipfile.ZipFile) -> dict:
    """シート名 → ワークシート XML のパス（'xl/worksheets/sheet3.xml' の形）。"""
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid2target = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for s in wb.find("{%s}sheets" % NS_MAIN):
        out[s.get("name")] = _resolve("xl/workbook.xml", rid2target[s.get("{%s}id" % NS_R)])
    return out


def rels_path(part: str) -> str:
    """パーツの rels のパス（xl/worksheets/sheet3.xml → xl/worksheets/_rels/sheet3.xml.rels）。"""
    d, f = posixpath.split(part)
    return posixpath.join(d, "_rels", f + ".rels")


def _resolve(source_part: str, target: str) -> str:
    """Relationship の Target（'/xl/...' の絶対形、または相対形）→ zip 内のパス。"""
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_part), target))


def restore_parts(template_path: str, saved: bytes) -> bytes:
    """openpyxl が保存した xlsm（saved）に、原本から落ちた部品を戻して返す。

    * 原本で drawing を持つシート（日報 N回目 の「＋ 行追加」ボタン）に、同じ drawing を戻す。
      シートは名前で突き合わせる。drawing のファイル名は出力側で空いている番号
      （drawing101.xml から）に付け替え、シートの rels・[Content_Types].xml に登録する。
      出力側のシートに既に <drawing> があれば何もしない。
    * xl/vbaProject.bin が無ければ原本から足す。
    """
    with zipfile.ZipFile(io.BytesIO(saved)) as zout:
        infos = zout.infolist()
        files = {info.filename: zout.read(info.filename) for info in infos}
        out_sheets = sheet_paths(zout)
    with zipfile.ZipFile(template_path) as ztpl:
        tpl_files = {n: ztpl.read(n) for n in ztpl.namelist()}
        tpl_sheets = sheet_paths(ztpl)

    pkg = _Package(files, tpl_files)
    changed = False
    for name in out_sheets:  # 出力のシート順に番号を振る（毎回同じ名前になる）
        if name not in tpl_sheets:
            continue
        found = _template_drawing(tpl_files, tpl_sheets[name])
        if found is None or _DRAWING_ELEM.search(files[out_sheets[name]].decode("utf-8")):
            continue
        _add_drawing(pkg, out_sheets[name], *found)
        changed = True
    if VBA_PART not in files and VBA_PART in tpl_files:
        pkg.copy_part(VBA_PART, VBA_PART)
        changed = True
    if not changed:
        return saved
    return pkg.to_bytes([info.filename for info in infos])


# ---------------------------------------------------------------- drawing の復元
REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
_DRAWING_ELEM = re.compile(r'<(?:\w+:)?drawing\b[^>]*?\br:id="([^"]+)"')
# CT_Worksheet で <drawing> より後に来る要素（この最初のものの直前に入れる。無ければ </worksheet> の直前）
_AFTER_DRAWING = {"legacyDrawing", "legacyDrawingHF", "drawingHF", "picture", "oleObjects",
                  "controls", "webPublishItems", "tableParts", "extLst"}
_TAG = re.compile(r"<(/?)([A-Za-z_][\w.\-]*:)?([A-Za-z_][\w.\-]*)[^>]*?(/?)>")


def _template_drawing(tpl_files: dict, sheet_part: str):
    """原本のシートの drawing → (rId, drawing のパス)。無ければ None。"""
    m = _DRAWING_ELEM.search(tpl_files[sheet_part].decode("utf-8"))
    if m is None:
        return None
    rels = ET.fromstring(tpl_files[rels_path(sheet_part)])
    for r in rels.findall("{%s}Relationship" % NS_PKG_REL):
        if r.get("Id") == m.group(1) and r.get("Type") == REL_DRAWING:
            return m.group(1), _resolve(sheet_part, r.get("Target"))
    raise ValueError("原本 %s の drawing（%s）の Relationship が見つかりません" % (sheet_part, m.group(1)))


def _add_drawing(pkg: "_Package", sheet_part: str, tpl_rid: str, tpl_drawing: str) -> None:
    # 1) drawing パーツ（と、あればその rels・参照先）を空いている名前で足す
    n = 101
    while "xl/drawings/drawing%d.xml" % n in pkg.files:
        n += 1
    drawing = "xl/drawings/drawing%d.xml" % n
    pkg.copy_part(tpl_drawing, drawing)
    tpl_drels = rels_path(tpl_drawing)
    if tpl_drels in pkg.tpl:
        drels = ET.fromstring(pkg.tpl[tpl_drels])
        for r in drels.findall("{%s}Relationship" % NS_PKG_REL):
            if r.get("TargetMode") == "External":
                continue
            # 参照先（画像など）は原本と同じ相対位置に置く。出力に同名で別の中身があれば止める
            src = _resolve(tpl_drawing, r.get("Target"))
            dst = _resolve(drawing, r.get("Target"))
            if dst in pkg.files:
                if pkg.files[dst] != pkg.tpl[src]:
                    raise ValueError("出力の %s が原本と違うため drawing を戻せません" % dst)
            else:
                pkg.copy_part(src, dst)
        pkg.files[rels_path(drawing)] = pkg.tpl[tpl_drels]

    # 2) シートの rels に Relationship を足す（rels が無ければ作る。Id は既存と重ならないもの）
    srels = rels_path(sheet_part)
    if srels in pkg.files:
        text = pkg.files[srels].decode("utf-8")
        used = {r.get("Id") for r in ET.fromstring(pkg.files[srels])}
    else:
        text = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="%s"></Relationships>' % NS_PKG_REL
        used = set()
    rid = tpl_rid
    i = 1
    while rid in used:
        rid = "rIdDrw%d" % i
        i += 1
    rel = "<Relationship Id=%s Type=%s Target=%s/>" % (
        quoteattr(rid), quoteattr(REL_DRAWING), quoteattr(posixpath.relpath(drawing, posixpath.dirname(sheet_part))))
    pkg.files[srels] = _insert_before(text, "</Relationships>", rel).encode("utf-8")

    # 3) シート XML に <drawing r:id> を正しい位置へ
    xml = pkg.files[sheet_part].decode("utf-8")
    pos = _drawing_position(xml)
    elem = '<drawing xmlns:r="%s" r:id="%s"/>' % (NS_R, rid)
    pkg.files[sheet_part] = (xml[:pos] + elem + xml[pos:]).encode("utf-8")


def _drawing_position(xml: str) -> int:
    """<worksheet> 直下で <drawing> を入れる位置（文字位置）。"""
    depth = 0
    for m in _TAG.finditer(xml):
        closing, _prefix, local, selfclose = m.groups()
        if closing:
            depth -= 1
            if depth == 0 and local == "worksheet":
                return m.start()
            continue
        if depth == 1 and local in _AFTER_DRAWING:
            return m.start()
        if not selfclose:
            depth += 1
    raise ValueError("ワークシート XML の </worksheet> が見つかりません")


def _insert_before(text: str, marker: str, piece: str) -> str:
    """text の最後の marker の直前に piece を入れる。"""
    pos = text.rfind(marker)
    if pos < 0:
        raise ValueError("%s が見つかりません" % marker)
    return text[:pos] + piece + text[pos:]


# ---------------------------------------------------------------- zip の組み立て
CONTENT_TYPES = "[Content_Types].xml"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"


class _Package:
    """出力 zip のパーツ（files）を編集する。tpl は原本のパーツ。"""

    def __init__(self, files: dict, tpl: dict):
        self.files = files
        self.tpl = tpl
        self.tpl_ct = ET.fromstring(tpl[CONTENT_TYPES])

    def copy_part(self, src: str, dst: str) -> None:
        """原本の src を出力の dst として足し、[Content_Types].xml に型を登録する。"""
        self.files[dst] = self.tpl[src]
        ctype = _content_type(self.tpl_ct, src)
        ct = ET.fromstring(self.files[CONTENT_TYPES])
        if ctype is None or _content_type(ct, dst) == ctype:
            return
        text = self.files[CONTENT_TYPES].decode("utf-8")
        ext = posixpath.splitext(dst)[1].lstrip(".").lower()
        if any(d.get("Extension", "").lower() == ext for d in ct.findall("{%s}Default" % NS_CT)):
            # Default（xml → application/xml など）と違う型なので Override で登録する
            text = _insert_before(text, "</Types>", "<Override PartName=%s ContentType=%s/>" % (
                quoteattr("/" + dst), quoteattr(ctype)))
        else:
            # その拡張子の Default が無い：Default を足す（スキーマの順序で Override より前）
            piece = "<Default Extension=%s ContentType=%s/>" % (quoteattr(ext), quoteattr(ctype))
            first_override = text.find("<Override")
            text = (text[:first_override] + piece + text[first_override:]) if first_override >= 0 \
                else _insert_before(text, "</Types>", piece)
        self.files[CONTENT_TYPES] = text.encode("utf-8")

    def to_bytes(self, order: list) -> bytes:
        """[Content_Types].xml を先頭に、元の順序のまま zip に書き、足したパーツを後ろに付ける。"""
        names = [CONTENT_TYPES] + [n for n in order if n != CONTENT_TYPES]
        seen = set(names)
        names += [n for n in self.files if n not in seen]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zw:
            for n in names:
                zw.writestr(n, self.files[n])
        return buf.getvalue()


def _content_type(ct_root, part: str):
    """[Content_Types].xml で part の型（Override → Default の順）。"""
    for o in ct_root.findall("{%s}Override" % NS_CT):
        if o.get("PartName", "").lstrip("/") == part:
            return o.get("ContentType")
    ext = posixpath.splitext(part)[1].lstrip(".").lower()
    for d in ct_root.findall("{%s}Default" % NS_CT):
        if d.get("Extension", "").lower() == ext:
            return d.get("ContentType")
    return None
