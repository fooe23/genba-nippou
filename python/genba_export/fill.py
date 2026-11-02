"""payload（月次データ）を V34 雛形の入力セルに書き込み、xlsm のバイト列を返す。

雛形は変更しない。毎回原本を開き、layout.py の対応表にあるセルだけに書く。
数式・書式・結合・印刷設定・VBA・定義名には触れない。
"""
from __future__ import annotations

import datetime
import io
import os
import re
import warnings
from typing import Any, Optional

import openpyxl

from . import layout, postprocess

# openpyxl は x14 拡張の入力規則を読めず警告を出す（復元は postprocess / Task 3）
warnings.filterwarnings("ignore", message="Data Validation extension")


class ExportError(Exception):
    """出力できないときの例外。code は機械向け、message は利用者向けの日本語。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message}


# ---------------------------------------------------------------- 値の変換
def _text(value: Any) -> Any:
    """空文字は空欄として扱う。"""
    if value is None or value == "":
        return None
    return value


def to_date(value: Any, field: str = "日付") -> Optional[datetime.date]:
    """'YYYY-MM-DD' → datetime.date。None / 空文字は None。"""
    if value is None or value == "":
        return None
    if isinstance(value, datetime.date) and not isinstance(value, datetime.datetime):
        return value
    try:
        return datetime.datetime.strptime(str(value), "%Y-%m-%d").date()
    except ValueError:
        raise ExportError("invalid_payload", "%sの形式が正しくありません（%s）" % (field, value))


def to_time(value: Any, field: str = "時刻") -> Optional[datetime.time]:
    """'HH:MM'（'HH:MM:SS' も可）→ datetime.time。None / 空文字は None。"""
    if value is None or value == "":
        return None
    if isinstance(value, datetime.time):
        return value
    s = str(value)
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    raise ExportError("invalid_payload", "%sの形式が正しくありません（%s）" % (field, value))


_JST = datetime.timezone(datetime.timedelta(hours=9))
_ISO_DATETIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})"
    r"(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?"
    r"\s*(Z|[+-]\d{2}(?::?\d{2})?)?$")


def to_date_from_iso(value: Any, field: str = "日付") -> Optional[datetime.date]:
    """ISO 8601 の日時（'2026-11-02T01:15:00+00:00' など）→ 日本時間の日付。

    時差が付いていれば日本時間に直してから日付を取る（Supabase の timestamptz は UTC で返る）。
    時差が無ければ、書かれている日付部分をそのまま使う。None / 空文字は None。
    """
    if value is None or value == "":
        return None
    m = _ISO_DATETIME.match(str(value).strip())
    if not m:
        raise ExportError("invalid_payload", "%sの形式が正しくありません（%s）" % (field, value))
    year, month, day, hh, mm, ss, tz = m.groups()
    try:
        d = datetime.date(int(year), int(month), int(day))
        if hh is None or tz is None:
            return d
        dt = datetime.datetime(d.year, d.month, d.day, int(hh), int(mm), int(ss or 0))
        if tz == "Z":
            offset = datetime.timedelta(0)
        else:
            sign = -1 if tz[0] == "-" else 1
            digits = tz[1:].replace(":", "")
            offset = sign * datetime.timedelta(hours=int(digits[:2]), minutes=int(digits[2:] or 0))
        return dt.replace(tzinfo=datetime.timezone(offset)).astimezone(_JST).date()
    except ValueError:
        raise ExportError("invalid_payload", "%sの形式が正しくありません（%s）" % (field, value))


def _set(ws, ref: str, value: Any) -> None:
    """セルに値を書く。原本に表示形式があるセル（General 以外）は、その表示形式を保つ。

    openpyxl は date / time を書くと表示形式を日付形式に変えることがある。General のセル
    （日付の F2・K80 など）はそれに任せ、h:mm などが付いているセルは原本のままにする。
    """
    cell = ws[ref]
    fmt = cell.number_format
    cell.value = value
    if fmt != "General" and cell.number_format != fmt:
        cell.number_format = fmt


def _jp_date(d: Optional[datetime.date]) -> str:
    return "%d年%d月%d日" % (d.year, d.month, d.day) if d else "日付なし"


# ---------------------------------------------------------------- 入口
def fill_workbook(template_path: str, payload: dict) -> bytes:
    """雛形を開いて payload を書き、xlsm のバイト列を返す。"""
    if not isinstance(payload, dict):
        raise ExportError("invalid_payload", "出力データの形式が正しくありません")
    if not template_path or not os.path.isfile(template_path):
        raise ExportError("template_not_found", "雛形ファイルが見つかりません")
    _check_limits(payload)

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Data Validation extension")
        wb = openpyxl.load_workbook(template_path, keep_vba=True)

    _write_site_info(wb, payload)
    _write_masters(wb, payload)
    _write_carryover(wb, payload)
    for day in payload.get("days") or []:
        _write_day(wb[_day_sheet_name(day)], day)

    # openpyxl は数式の計算結果を保存しないので、開いたときに Excel に全再計算させる
    wb.calculation.fullCalcOnLoad = True

    buf = io.BytesIO()
    wb.save(buf)
    return postprocess.restore_parts(template_path, buf.getvalue())


def _check_limits(payload: dict) -> None:
    for key, block in layout.MASTER_BLOCKS.items():
        items = payload.get(key) or []
        if len(items) > block["limit"]:
            raise ExportError(
                block["error_code"],
                "%sが %d 件あります。雛形に書けるのは %d 件までです" % (block["label"], len(items), block["limit"]))
    days = payload.get("days") or []
    if len(days) > layout.MAX_DAYS:
        raise ExportError(
            "too_many_days",
            "この月の日報が %d 件あります。雛形に書けるのは %d 件までです" % (len(days), layout.MAX_DAYS))
    # 雛形を開く前に、日報の形と行数を確かめる（途中まで書いてから失敗しないように）
    seen = set()
    for day in days:
        if not isinstance(day, dict):
            raise ExportError("invalid_payload", "日報のデータの形式が正しくありません")
        sheet = _day_sheet_name(day)
        if sheet in seen:
            raise ExportError("invalid_payload", "日報の回目（%s）が重複しています" % sheet)
        seen.add(sheet)
        date = to_date(day.get("date"), "日報の日付")
        for key, table in layout.day_tables(sheet).items():
            n = len(day.get(key) or [])
            if n > table["max"]:
                raise ExportError(
                    "rows_overflow",
                    "%s の%sが%d行で、雛形の%d行を超えています" % (_jp_date(date), table["label"], n, table["max"]))


# ---------------------------------------------------------------- 現場情報マスター
def _write_site_info(wb, payload: dict) -> None:
    ws = wb[layout.SITE_INFO_SHEET]
    site = payload.get("site") or {}
    for key, cell in layout.SITE_INFO_CELLS.items():
        value = site.get(key)
        if key in layout.SITE_DATE_KEYS:
            value = to_date(value, layout.SITE_DATE_LABELS[key])
        _set(ws, cell, _text(value))
    settings = payload.get("settings") or {}
    for key, cell in layout.SETTINGS_CELLS.items():
        value = settings.get(key)
        # 設定値が無いときは雛形の既定値を残す（空にすると GN_* を使う数式が崩れる）
        if value is not None:
            ws[cell].value = value


# ---------------------------------------------------------------- マスター
def _write_masters(wb, payload: dict) -> None:
    ws = wb[layout.MASTER_SHEET]
    for key, block in layout.MASTER_BLOCKS.items():
        items = payload.get(key) or []
        for i, row in enumerate(range(block["first_row"], block["last_row"] + 1)):
            item = items[i] if i < len(items) else {}
            for field, col in block["columns"].items():
                # 使わない行も空にする（雛形に入っている見本の行を残さない）
                ws["%s%d" % (col, row)].value = _text(item.get(field))


def _write_carryover(wb, payload: dict) -> None:
    """前月繰越（人工・労務費）。作業員マスターと同じ並び。使わない行は 0。"""
    ws = wb[layout.MASTER_SHEET]
    workers = payload.get("workers") or []
    spec = layout.CARRYOVER_ROWS
    for i, row in enumerate(range(spec["first_row"], spec["last_row"] + 1)):
        worker = workers[i] if i < len(workers) else {}
        for field, col in spec["columns"].items():
            value = worker.get(field)
            ws["%s%d" % (col, row)].value = 0 if value is None else value


# ---------------------------------------------------------------- 日報（N回目）
def _day_sheet_name(day: dict) -> str:
    index = day.get("index")
    if isinstance(index, bool) or not isinstance(index, int) or not 1 <= index <= layout.MAX_DAYS:
        raise ExportError("invalid_payload", "日報の回目（%s）が正しくありません" % (index,))
    return layout.DAY_SHEETS[index - 1]


def _one_newline(text: Any) -> str:
    """セル内改行は \\n にそろえる（\\r\\n・\\r が来ても Excel で同じに見えるように）。"""
    return str(text).replace("\r\n", "\n").replace("\r", "\n")


def _issues_text(day: dict) -> Optional[str]:
    """重要事項：文章のあとに、件を「・」付きで 1 行ずつ。"""
    lines = []
    text = _text(day.get("issues_text"))
    if text is not None:
        lines.append(_one_newline(text))
    for issue in day.get("issues") or []:
        issue = _text(issue)
        if issue is not None:
            lines.append("・%s" % _one_newline(issue))
    return "\n".join(lines) if lines else None


def _notes_text(day: dict) -> Optional[str]:
    """連絡事項：1 行目に【通算M回目】、そのあとに連絡事項の文章。"""
    lines = []
    if day.get("total_index") is not None:
        lines.append("【通算%s回目】" % day["total_index"])
    text = _text(day.get("notes_text"))
    if text is not None:
        lines.append(_one_newline(text))
    return "\n".join(lines) if lines else None


def _write_day(ws, day: dict) -> None:
    """1 日分の日報を N回目 シートに書く。明細の無い行は原本（空）のまま触らない。"""
    cells = layout.day_cells(ws.title)
    date = to_date(day.get("date"), "日報の日付")
    where = _jp_date(date)
    common = day.get("common") or {}
    values = {
        "date": date,
        "weather": _text(day.get("weather")),
        "supervisor": _text(day.get("supervisor")),
        "common_start": to_time(common.get("start"), "%s の共通の開始時刻" % where),
        "common_end": to_time(common.get("end"), "%s の共通の終了時刻" % where),
        "common_break_min": _text(common.get("break_min")),
        "common_gap_min": _text(common.get("gap_min")),
        "cumulative_cost": _text(day.get("cumulative_cost")),
        "output_total": _text(day.get("output_total")),
        "issues": _issues_text(day),
        "notes": _notes_text(day),
        "created_by": _text(day.get("created_by")),
        "reviewed_by": _text(day.get("reviewed_by")),
        "approved_by": _text(day.get("approved_by")),
        "approved_at": to_date_from_iso(day.get("approved_at"), "%s の承認日" % where),
    }
    for key, ref in cells.items():
        _set(ws, ref, values[key])

    for key, table in layout.day_tables(ws.title).items():
        rows = day.get(key) or []
        for i, item in enumerate(rows):
            if not isinstance(item, dict):
                raise ExportError("invalid_payload", "%s の%sの明細の形式が正しくありません" % (where, table["label"]))
            row = table["first_row"] + i
            for field, col in table["columns"].items():
                value = item.get(field)
                if field in table["time_columns"]:
                    value = to_time(value, "%s の%s %d 行目の%s" % (
                        where, table["label"], i + 1, "開始時刻" if field == "start" else "終了時刻"))
                _set(ws, "%s%d" % (col, row), _text(value))
            # 日当・リース単価は雛形では数式（マスターを引く）。保存値がマスター値と違う行だけ値で上書き
            for field, spec in table["formula_columns"].items():
                value = item.get(field)
                if value is not None and value != item.get(spec["master_key"]):
                    _set(ws, "%s%d" % (spec["column"], row), value)
