"""payload（月次データ）を V34 雛形の入力セルに書き込み、xlsm のバイト列を返す。

雛形は変更しない。毎回原本を開き、layout.py の対応表にあるセルだけに書く。
数式・書式・結合・印刷設定・VBA・定義名には触れない。
"""
from __future__ import annotations

import datetime
import io
import os
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
    # 日報（N回目）の書き込みは Task 2 以降

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


# ---------------------------------------------------------------- 現場情報マスター
def _write_site_info(wb, payload: dict) -> None:
    ws = wb[layout.SITE_INFO_SHEET]
    site = payload.get("site") or {}
    for key, cell in layout.SITE_INFO_CELLS.items():
        value = site.get(key)
        if key in layout.SITE_DATE_KEYS:
            value = to_date(value, key)
        ws[cell].value = _text(value)
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
