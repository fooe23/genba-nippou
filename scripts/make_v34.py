#!/usr/bin/env python3
"""現場管理台帳 V33 → V34 案 を生成するスクリプト。

使い方:
    python3 -I scripts/make_v34.py templates/現場管理台帳_V33_原本.xlsm templates/現場管理台帳_V34_案.xlsm

V34 の変更点（詳細は templates/V34_変更点.md）:
  * 人工 = 実働 <= 所定時間 なら ROUND(実働/所定時間, 2)、超えたら 1
  * 残業時間 = MAX(実働 - 固定残業上限, 0)（日報の列 K に新設）
  * 労務費 = 日当 × 人工 + 残業時間 × 残業単価
      残業単価 = マスター!E（作業員ごとの残業単価）が入っていればその値、
                 空欄なら ROUND(日当 ÷ 基準時間 × 割増率, 0)
  * 4 つの設定値は 現場情報マスター!D25:D28（名前 GN_*）
  * 日報の 備考 は列 K → 列 L へ移動、集計データ の参照も L へ
  * マスター（作業員マスター）に 残業単価（円/H）列 E を新設し、備考は F へ移動

openpyxl では次のものが読み込み時に落ちるため、元ファイルの XML から復元する:
  * x14 拡張のデータの入力規則（プルダウン） → 標準の dataValidation として再作成
  * 日報シートの「＋ 行追加」ボタン（マクロ登録済みの図形 = drawing パーツ）
    → 保存後に zip を直接編集して元の drawing XML を戻す（右端を列 L まで広げる）

-I（隔離モード）で実行するとユーザー site-packages が sys.path から外れるため、
openpyxl を見つけられるよう、ユーザー site-packages だけを明示的に追加する。
"""
import sys
import site

_user_site = site.getusersitepackages()
if _user_site not in sys.path:
    sys.path.append(_user_site)

import copy
import io
import re
import tempfile
import warnings
import xml.etree.ElementTree as ET
import zipfile
import posixpath

import openpyxl
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.cell_range import MultiCellRange
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.dimensions import ColumnDimension
from openpyxl.worksheet.merge import MergedCellRange

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
NS_XM = "http://schemas.microsoft.com/office/excel/2006/main"
REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml"

DAY_SHEETS = ["%d回目" % i for i in range(1, 32)]
WORKER_ROWS = range(8, 18)  # 作業員テーブル 8〜17 行
COL_K = 11
COL_L = 12

GN = {  # 定義名 → (行, 項目名, 既定値, 入力ガイド)
    "GN_SHOTEI": (25, "1人工の基準時間（所定）", 7.5, "実働がこの時間以下なら 実働÷基準 を人工にする"),
    "GN_ZANGYO_JOGEN": (26, "固定残業の上限時間", 8, "基準〜上限の実働は 1.0 人工。上限を超えた分が残業時間"),
    "GN_WARIMASHI": (27, "残業の割増率", 1.25, "0 にすると残業代を計上しない"),
    "GN_ZANGYO_KIJUN": (28, "残業単価の基準時間", 8, "残業単価＝日当÷この時間×割増率"),
}
NOTE_V34 = "V34：人工は所定時間以下で比例、上限まで1.0、超過は残業H（列K）。備考は列Lへ移動"
NOTE_OVERRIDE = ("V34：作業員ごとの残業単価は マスター!E列「残業単価（円/H）」に入力。"
                 "空欄なら 日当÷基準時間×割増率 で計算")


# ---------------------------------------------------------------- 元ファイルの解析
def _workbook_parts(zf):
    """シート名 → ワークシート XML パス。"""
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rid2target = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for s in wb.find("{%s}sheets" % NS_MAIN):
        target = rid2target[s.get("{%s}id" % NS_R)]
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = posixpath.normpath(posixpath.join("xl", target))
        out[s.get("name")] = target
    return out


def _rels_path(part):
    d, f = posixpath.split(part)
    return posixpath.join(d, "_rels", f + ".rels")


def read_source_validations(zf, parts):
    """シート名 → [dict(kind, attrs, formula1, formula2, sqref)]。標準と x14 の両方。"""
    out = {}
    for name, part in parts.items():
        root = ET.fromstring(zf.read(part))
        items = []
        dvs = root.find("{%s}dataValidations" % NS_MAIN)
        if dvs is not None:
            for dv in dvs.findall("{%s}dataValidation" % NS_MAIN):
                f1 = dv.find("{%s}formula1" % NS_MAIN)
                f2 = dv.find("{%s}formula2" % NS_MAIN)
                items.append(dict(kind="standard", attrs=dict(dv.attrib), sqref=dv.get("sqref"),
                                  formula1=f1.text if f1 is not None else None,
                                  formula2=f2.text if f2 is not None else None))
        for dv in root.iter("{%s}dataValidation" % NS_X14):
            f1 = dv.find("{%s}formula1/{%s}f" % (NS_X14, NS_XM))
            f2 = dv.find("{%s}formula2/{%s}f" % (NS_X14, NS_XM))
            sq = dv.find("{%s}sqref" % NS_XM)
            items.append(dict(kind="x14", attrs=dict(dv.attrib), sqref=sq.text if sq is not None else "",
                              formula1=f1.text if f1 is not None else None,
                              formula2=f2.text if f2 is not None else None))
        out[name] = items
    return out


def read_source_drawings(zf, parts):
    """シート名 → drawing XML（bytes）。"""
    out = {}
    names = set(zf.namelist())
    for name, part in parts.items():
        rp = _rels_path(part)
        if rp not in names:
            continue
        rels = ET.fromstring(zf.read(rp))
        for r in rels:
            if r.get("Type") == REL_DRAWING:
                target = posixpath.normpath(posixpath.join(posixpath.dirname(part), r.get("Target")))
                out[name] = (target, zf.read(target))
                # drawing 自体の rels（画像など）は元ファイルに無いことを確認済みだが念のため
                drp = _rels_path(target)
                if drp in names:
                    raise SystemExit("drawing %s has its own rels; not supported" % target)
    return out


# ---------------------------------------------------------------- openpyxl 補助
def explode_columns(ws):
    """min..max でまとめられた列幅を 1 列ずつに分解する。"""
    dims = []
    for key, cd in list(ws.column_dimensions.items()):
        lo = cd.min or column_index_from_string(key)
        hi = cd.max or lo
        dims.append((lo, hi, cd))
    new = {}
    for lo, hi, cd in dims:
        for idx in range(lo, hi + 1):
            letter = get_column_letter(idx)
            nd = ColumnDimension(ws, index=letter, width=cd.width, bestFit=cd.bestFit,
                                 hidden=cd.hidden, outlineLevel=cd.outlineLevel,
                                 collapsed=cd.collapsed)
            nd._style = copy.copy(cd._style)
            nd.min = idx
            nd.max = idx
            new[letter] = nd
    ws.column_dimensions.clear()
    for letter in sorted(new, key=column_index_from_string):
        ws.column_dimensions[letter] = new[letter]


def copy_style(src, dst):
    dst._style = copy.copy(src._style)


def set_merges(ws, coords):
    ws.merged_cells = MultiCellRange([MergedCellRange(ws, c) for c in coords])


def print_area_last_row(ws):
    pa = ws.print_area
    m = re.search(r"\$([A-Z]+)\$(\d+)$", pa if isinstance(pa, str) else ",".join(pa))
    return int(m.group(2))


# ---------------------------------------------------------------- 各シートの変更
def change_genba_master(ws, log):
    """現場情報マスター: 行 24〜30（A〜H）に V34 設定ブロックとメモ。"""
    for col in range(1, 9):
        if ws.cell(24, col).value is not None or any(ws.cell(r, col).value is not None for r in range(25, 31)):
            raise SystemExit("現場情報マスター A24:H30 が空いていません")
    # 見出し（行 3 と同じ書式・結合）
    for col in range(1, 9):
        copy_style(ws.cell(3, col), ws.cell(24, col))
    ws["A24"] = "【 労務の計算設定（V34） 】"
    ws.row_dimensions[24].height = ws.row_dimensions[3].height
    merges = [str(r) for r in ws.merged_cells.ranges] + ["A24:H24"]
    for name, (row, label, val, guide) in GN.items():
        for col in range(1, 9):
            copy_style(ws.cell(4, col), ws.cell(row, col))
        ws.cell(row, 1).value = row - 24
        ws.cell(row, 2).value = label
        ws.cell(row, 4).value = val
        ws.cell(row, 7).value = guide
        ws.row_dimensions[row].height = 24
        merges += ["B%d:C%d" % (row, row), "D%d:F%d" % (row, row), "G%d:H%d" % (row, row)]
    # メモ（行 2 の注記と同じ書式）
    for row, text in ((29, NOTE_V34), (30, NOTE_OVERRIDE)):
        for col in range(1, 9):
            copy_style(ws.cell(2, col), ws.cell(row, col))
        ws.cell(row, 1).value = text
        ws.row_dimensions[row].height = ws.row_dimensions[2].height
        merges.append("A%d:H%d" % (row, row))
    set_merges(ws, merges)
    log.append("現場情報マスター: A24:H28 設定ブロック、A29/A30 注記を追加")


def change_master(ws, log):
    """マスター（作業員マスター）: E=残業単価（円/H）を新設、備考を F へ。"""
    if ws["E2"].value != "備考" or ws["F2"].value is not None:
        raise SystemExit("マスター E2/F2 が想定と違います: %r %r" % (ws["E2"].value, ws["F2"].value))
    for r in range(1, 33):
        if r >= 3 and ws.cell(r, 6).value is not None:
            raise SystemExit("マスター F%d が空いていません" % r)
    # 1 行目: タイトル結合 A1:E1 → A1:F1
    copy_style(ws["E1"], ws["F1"])
    merges = [str(r) if str(r) != "A1:E1" else "A1:F1" for r in ws.merged_cells.ranges]
    set_merges(ws, merges)
    for r in range(2, 33):
        e, f, d = ws.cell(r, 5), ws.cell(r, 6), ws.cell(r, 4)
        copy_style(e, f)
        f.value = e.value
        if r >= 3:
            copy_style(d, e)  # 黄色の入力セル（D と同じ）
            e.value = None
    ws["E2"] = "残業単価（円/H）"
    ws["E2"].comment = Comment("空欄なら 日当÷基準時間×割増率（現場情報マスターの労務の計算設定）で計算します。"
                               "\n入力した場合はその金額（円/時間）を残業1時間あたりの単価に使います。", "V34")
    ws["E2"].comment.width = 260
    ws["E2"].comment.height = 90
    log.append("マスター: E2『残業単価（円/H）』新設（E3:E32 黄色入力）、備考を F2:F32 へ移動、A1:F1 結合")


def change_day_sheet(ws, validations, log):
    last = print_area_last_row(ws)
    # 1) 列幅: J=13 のまま、K=8.5、L=14（M 以降は元の 2）
    explode_columns(ws)
    ws.column_dimensions["K"].width = 8.5
    ws.column_dimensions["L"].width = 14

    # 2) K の書式を L へ（1〜最終行。1〜4 行は右端の罫線を L に持っていくため）
    for r in range(1, last + 1):
        k, l = ws.cell(r, COL_K), ws.cell(r, COL_L)
        if k.has_style:
            copy_style(k, l)

    # 3) 見出し・作業員テーブル・合計行
    if ws["K7"].value != "備考（職種など）":
        raise SystemExit("%s K7 が想定と違います: %r" % (ws.title, ws["K7"].value))
    ws["L7"] = ws["K7"].value
    copy_style(ws["H7"], ws["K7"])
    ws["K7"] = "残業\n(H)"
    for r in WORKER_ROWS:
        k, l = ws.cell(r, COL_K), ws.cell(r, COL_L)
        l.value = k.value
        copy_style(ws.cell(r, 7), k)  # G（実働）と同じ計算セル書式
        ws.cell(r, 8).value = "=IFERROR(IF(G{r}<=GN_SHOTEI,ROUND(G{r}/GN_SHOTEI,2),1),0)".format(r=r)
        k.value = "=IFERROR(MAX(G{r}-GN_ZANGYO_JOGEN,0),0)".format(r=r)
        ws.cell(r, 9).value = (
            "=IFERROR(J{r}*H{r}+K{r}*IF(N(IFERROR(VLOOKUP(B{r},マスター!$B$3:$E$32,4,0),0))>0,"
            "VLOOKUP(B{r},マスター!$B$3:$E$32,4,0),"
            "ROUND(J{r}/GN_ZANGYO_KIJUN*GN_WARIMASHI,0)),0)").format(r=r)
    if ws["K18"].value is not None:
        raise SystemExit("%s K18 が空いていません" % ws.title)
    copy_style(ws["H18"], ws["K18"])
    ws["K18"] = "=SUM(K8:K17)"

    # 4) 結合: 右端が K の結合は L まで広げる。単独の K セル（罫線付き。進捗率・日付欄）は K:L を結合
    merged_k = set()
    coords = []
    extended = 0
    for rng in ws.merged_cells.ranges:
        if rng.max_col == COL_K:
            coords.append("%s%d:L%d" % (get_column_letter(rng.min_col), rng.min_row, rng.max_row))
            merged_k.update(range(rng.min_row, rng.max_row + 1))
            extended += 1
        elif rng.max_col >= COL_L or rng.min_col >= COL_L:
            raise SystemExit("%s: 列 L 以降にかかる結合 %s があります" % (ws.title, rng))
        else:
            coords.append(str(rng))
    extra = []
    for r in range(1, last + 1):
        if r in merged_k or 7 <= r <= 18:
            continue
        k = ws.cell(r, COL_K)
        if k.border.left.style or k.value is not None:
            coords.append("K%d:L%d" % (r, r))
            extra.append("K%d:L%d" % (r, r))
    set_merges(ws, coords)

    # 5) 印刷範囲
    ws.print_area = "A1:L%d" % last

    # 6) 入力規則（x14 は openpyxl が落とすので再作成。K8:K17 にかかるものは L へ）
    restored = 0
    for v in validations:
        if v["kind"] != "x14":
            continue  # 標準の入力規則は openpyxl が保持する
        sq = []
        for part in v["sqref"].split():
            m = re.fullmatch(r"K(\d+)(?::K(\d+))?", part)
            if m and all(8 <= int(x) <= 17 for x in m.groups() if x):
                part = part.replace("K", "L")
            sq.append(part)
        a = v["attrs"]
        dv = DataValidation(
            type=a.get("type"), operator=a.get("operator"),
            formula1=v["formula1"], formula2=v["formula2"],
            allow_blank=a.get("allowBlank") == "1",
            showInputMessage=a.get("showInputMessage") == "1",
            showErrorMessage=a.get("showErrorMessage") == "1",
            promptTitle=a.get("promptTitle"), prompt=a.get("prompt"),
            errorTitle=a.get("errorTitle"), error=a.get("error"),
            errorStyle=a.get("errorStyle"), imeMode=a.get("imeMode"),
            sqref=" ".join(sq))
        ws.add_data_validation(dv)
        restored += 1
    log.append("%s: 結合 %d 件を L まで拡張、追加結合 %s、印刷範囲 A1:L%d、入力規則 %d 件を再作成"
               % (ws.title, extended, ",".join(extra) or "なし", last, restored))
    return restored


def change_shukei(ws, log):
    pat = re.compile(r"('\d+回目'!)K(\d+)")
    n = 0
    for row in ws.iter_rows(min_col=4, max_col=4):
        c = row[0]
        if isinstance(c.value, str):
            def rep(m):
                return m.group(1) + ("L" if 8 <= int(m.group(2)) <= 17 else "K") + m.group(2)
            new = pat.sub(rep, c.value)
            if new != c.value:
                c.value = new
                n += 1
    log.append("集計データ: 列 D の 備考 参照 %d 件を K→L に変更" % n)
    return n


# ---------------------------------------------------------------- zip 後処理（ボタン図形の復元）
def reinject_drawings(tmp_path, dst_path, drawings, log):
    zin = zipfile.ZipFile(tmp_path)
    parts = _workbook_parts(zin)
    names = set(zin.namelist())
    files = {n: zin.read(n) for n in zin.namelist()}
    infos = {n: zin.getinfo(n) for n in zin.namelist()}
    zin.close()

    ct = files["[Content_Types].xml"].decode("utf-8")
    added = 0
    for idx, (sheet, (_src_target, xml)) in enumerate(sorted(drawings.items(), key=lambda x: DAY_SHEETS.index(x[0])), 1):
        part = parts[sheet]
        dpart = "xl/drawings/drawing%d.xml" % idx
        if dpart in names:
            raise SystemExit("出力に既に %s があります" % dpart)
        # ボタンの右端を列 L の右（col index 12）まで広げる（J:K → J:L の結合に合わせる）
        x = xml.decode("utf-8")
        x, nsub = re.subn(r"(<xdr:to><xdr:col>)11(</xdr:col>)", r"\g<1>12\g<2>", x)
        files[dpart] = x.encode("utf-8")
        # sheet rels
        rp = _rels_path(part)
        rid = "rIdV34drw"
        if rp in files:
            rels = files[rp].decode("utf-8")
            if rid in rels:
                raise SystemExit("rel id collision")
            rels = rels.replace("</Relationships>",
                                '<Relationship Id="%s" Type="%s" Target="../drawings/drawing%d.xml"/></Relationships>'
                                % (rid, REL_DRAWING, idx))
        else:
            rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    '<Relationships xmlns="%s"><Relationship Id="%s" Type="%s" Target="../drawings/drawing%d.xml"/>'
                    '</Relationships>' % (NS_PKG_REL, rid, REL_DRAWING, idx))
        files[rp] = rels.encode("utf-8")
        # sheet XML に <drawing r:id> を正しい位置へ
        s = files[part].decode("utf-8")
        if "<drawing " in s:
            raise SystemExit("%s already has a drawing" % part)
        root_m = re.search(r"<worksheet\b[^>]*>", s)
        root_tag = root_m.group(0)
        if 'xmlns:r="%s"' % NS_R not in root_tag:
            s = s.replace(root_tag, root_tag[:-1] + ' xmlns:r="%s">' % NS_R, 1)
        elem = '<drawing r:id="%s"/>' % rid
        m = re.search(r"<(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|"
                      r"webPublishItems|tableParts|extLst)\b|</worksheet>", s)
        s = s[:m.start()] + elem + s[m.start():]
        files[part] = s.encode("utf-8")
        ct = ct.replace("</Types>", '<Override PartName="/%s" ContentType="%s"/></Types>' % (dpart, CT_DRAWING))
        added += 1
        if nsub != 6:
            log.append("注意: %s のボタン %d 個だけ右端を広げました" % (sheet, nsub))
    files["[Content_Types].xml"] = ct.encode("utf-8")

    with zipfile.ZipFile(dst_path, "w", zipfile.ZIP_DEFLATED) as zout:
        order = list(infos)  # 元の順序（[Content_Types].xml が先頭）
        for n in files:
            if n not in infos:
                order.append(n)
        for n in order:
            zout.writestr(n, files[n])
    log.append("ボタン図形（drawing）を %d シートに復元（右端を列 L まで拡張）" % added)
    return added


# ---------------------------------------------------------------- main
def main(src, dst):
    log = []
    with zipfile.ZipFile(src) as zf:
        parts = _workbook_parts(zf)
        validations = read_source_validations(zf, parts)
        drawings = read_source_drawings(zf, parts)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        wb = openpyxl.load_workbook(src, keep_vba=True)

    change_genba_master(wb["現場情報マスター"], log)
    change_master(wb["マスター"], log)
    restored = {}
    for name in DAY_SHEETS:
        restored[name] = change_day_sheet(wb[name], validations.get(name, []), log)
    change_shukei(wb["集計データ"], log)

    for name, (row, _l, _v, _g) in GN.items():
        if name in wb.defined_names:
            raise SystemExit("defined name %s already exists" % name)
        wb.defined_names.add(DefinedName(name, attr_text="現場情報マスター!$D$%d" % row))
    # openpyxl は計算結果のキャッシュを書かないので、開いたときに全再計算させる
    wb.calculation.fullCalcOnLoad = True

    with tempfile.TemporaryDirectory() as td:
        tmp = posixpath.join(td, "v34_tmp.xlsm")
        wb.save(tmp)
        reinject_drawings(tmp, dst, drawings, log)

    total = sum(len(v) for v in validations.values())
    by_kind = {}
    for name, items in validations.items():
        kind = "日報(1〜31回目)" if name in DAY_SHEETS else name
        for it in items:
            key = (kind, it["kind"])
            by_kind[key] = by_kind.get(key, 0) + 1
    log.append("元ファイルの入力規則: 合計 %d 件 %s" % (total, by_kind))
    log.append("x14 入力規則の再作成: %d 件（日報 31 シート）" % sum(restored.values()))
    print("\n".join(log))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    if sys.argv[1] == sys.argv[2]:
        raise SystemExit("src と dst は別のファイルにしてください")
    main(sys.argv[1], sys.argv[2])
