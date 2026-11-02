"""雛形 V34（templates/現場管理台帳_V34_原本.xlsm）のセル対応表。

計画書 docs/superpowers/plans/2026-11-03-phase2-excel-export.md の
「雛形 V34 のセル対応表」をそのまま定数にしたもの。書き込むのはここに挙げたセルだけ。
"""
from __future__ import annotations

# ---------------------------------------------------------------- 現場情報マスター
SITE_INFO_SHEET = "現場情報マスター"

# payload["site"] のキー → セル
SITE_INFO_CELLS = {
    "name": "D4",             # 現場名
    "client_name": "D5",      # 客先名（請求先）
    "project_name": "D6",     # 工事名
    "project_no": "D7",       # 工事番号
    "overview": "D8",         # 工事概要
    "contract_amount": "D9",  # 工事総請負金額（数値）
    "start_date": "D10",      # 着工予定日（date）
    "end_date": "D11",        # 竣工予定日（date）
    "contract_type": "D12",   # 請負の種類
}
SITE_DATE_KEYS = ("start_date", "end_date")
# エラー文言に出す日本語名
SITE_DATE_LABELS = {"start_date": "着工予定日", "end_date": "竣工予定日"}

# payload["settings"] のキー → セル（定義名 GN_* の参照先）
SETTINGS_CELLS = {
    "shotei_hours": "D25",          # GN_SHOTEI
    "fixed_overtime_limit": "D26",  # GN_ZANGYO_JOGEN
    "overtime_multiplier": "D27",   # GN_WARIMASHI
    "overtime_base_hours": "D28",   # GN_ZANGYO_KIJUN
}

# ---------------------------------------------------------------- マスター
MASTER_SHEET = "マスター"

# payload のキー → 表の位置と列。columns は payload の各要素のキー → 列。
# limit 件を超えたら error_code の ExportError。
MASTER_BLOCKS = {
    "workers": {
        "first_row": 3, "last_row": 32, "limit": 30,
        "columns": {"name": "B", "trade": "C", "daily_rate": "D", "overtime_rate": "E", "note": "F"},
        "error_code": "too_many_workers", "label": "作業員",
    },
    "suppliers": {
        "first_row": 3, "last_row": 32, "limit": 30,
        "columns": {"name": "H", "category": "I", "contact": "J", "note": "K"},
        "error_code": "too_many_suppliers", "label": "取引先",
    },
    "vehicles": {
        "first_row": 3, "last_row": 22, "limit": 20,
        "columns": {"name": "N", "kind": "O", "km_per_l": "P", "note": "Q"},
        "error_code": "too_many_vehicles", "label": "車両",
    },
    "lease_items": {
        "first_row": 3, "last_row": 22, "limit": 20,
        "columns": {"name": "T", "spec": "U", "unit_price": "V", "note": "W"},
        "error_code": "too_many_lease_items", "label": "リース品",
    },
}

# 前月繰越：作業員 i（0 始まり、マスター行 3+i）→ 行 36+i。C 人工・D 労務費。
CARRYOVER_ROWS = {
    "first_row": 36, "last_row": 65,
    "columns": {"carry_man_days": "C", "carry_cost": "D"},
}

# ---------------------------------------------------------------- 日報（N回目）
DAY_SHEETS = [f"{i}回目" for i in range(1, 32)]
MAX_DAYS = len(DAY_SHEETS)

# 1 日分の単独セル
DAY_CELLS = {
    "date": "F2",             # 日付（date）
    "weather": "F3",          # 天候
    "supervisor": "F4",       # 作業責任者
    "common_start": "B6",     # 共通 開始（time）
    "common_end": "C6",       # 共通 終了（time）
    "common_break_min": "D6",  # 共通 休憩（分）
    "common_gap_min": "E6",   # 共通 中抜（分）
    "cumulative_cost": "E60",  # 累計原価（繰越は含まない）
    "output_total": "H60",    # 本日出来高
    "issues": "A71",          # 重要事項（A71:L74 結合）
    "notes": "A76",           # 連絡事項（A76:L79 結合。1 行目は【通算M回目】）
    "created_by": "B80",      # 作成者
    "reviewed_by": "E80",     # 確認者
    "approved_by": "H80",     # 承認者
    "approved_at": "K80",     # 承認日（date）
}

# 日報の明細表。payload["days"][n] のキー → 表。columns は明細のキー → 列。
# formula_columns は雛形では数式の列。payload の値とマスターの値が違う行だけ値を書く
# （key: 明細の値のキー、master_key: 雛形のマスター値のキー）。
# max は雛形の明細行数（last_row - first_row + 1）。超えたら rows_overflow（Task 6 で行挿入）。
DAY_TABLES = {
    "labor": {
        "label": "作業員", "first_row": 8, "last_row": 17, "total_row": 18,
        "columns": {"name": "B", "start": "C", "end": "D", "break_min": "E", "gap_min": "F", "note": "L"},
        "time_columns": ("start", "end"),
        "formula_columns": {"daily_rate": {"column": "J", "master_key": "master_daily_rate"}},
    },
    "fuel": {
        "label": "車両", "first_row": 21, "last_row": 23, "total_row": 24,
        "columns": {"name": "B", "distance_km": "D", "price_per_l": "E", "note": "H"},
        "time_columns": (),
        "formula_columns": {},
    },
    "lease": {
        "label": "リース", "first_row": 27, "last_row": 32, "total_row": 33,
        "columns": {"name": "B", "spec": "C", "unit": "D", "qty": "E", "note": "H"},
        "time_columns": (),
        "formula_columns": {"unit_price": {"column": "F", "master_key": "master_unit_price"}},
    },
    "cash": {
        "label": "現金購入", "first_row": 36, "last_row": 41, "total_row": 42,
        "columns": {"name": "B", "spec": "C", "unit": "D", "qty": "E", "unit_price": "F", "vendor": "H"},
        "time_columns": (),
        "formula_columns": {},
    },
    "credit": {
        "label": "買掛購入", "first_row": 45, "last_row": 50, "total_row": 51,
        "columns": {"name": "B", "spec": "C", "unit": "D", "qty": "E", "unit_price": "F", "vendor": "H"},
        "time_columns": (),
        "formula_columns": {},
    },
    "work": {
        "label": "作業内容", "first_row": 63, "last_row": 68, "total_row": 69,
        "columns": {"trade": "B", "description": "C", "qty": "E", "unit": "F", "man_days": "G", "unit_price": "I"},
        "time_columns": (),
        "formula_columns": {},
    },
}

# 原本の 2回目 だけは作業内容の表が 8 行（63〜70 行）あり、その下が 2 行ずれている
# （V34_変更点.md：「2回目は K82」「印刷範囲 A1:L82」）。合計行 71 の数式は SUM(G63:G68) /
# SUM(J63:J68) のままなので、書く明細は他のシートと同じ 63〜68 行（6 行）に留める。
DAY_SHEET_OVERRIDES = {
    "2回目": {
        "cells": {
            "issues": "A73", "notes": "A78",
            "created_by": "B82", "reviewed_by": "E82", "approved_by": "H82", "approved_at": "K82",
        },
        "tables": {"work": {"total_row": 71}},
    },
}


def day_cells(sheet_name: str) -> dict:
    """そのシートの単独セル（DAY_CELLS に 2回目 などの例外を重ねたもの）。"""
    cells = dict(DAY_CELLS)
    cells.update(DAY_SHEET_OVERRIDES.get(sheet_name, {}).get("cells", {}))
    return cells


def day_tables(sheet_name: str) -> dict:
    """そのシートの明細表（DAY_TABLES に 2回目 などの例外を重ねたもの）。"""
    overrides = DAY_SHEET_OVERRIDES.get(sheet_name, {}).get("tables", {})
    tables = {}
    for key, table in DAY_TABLES.items():
        merged = dict(table)
        merged.update(overrides.get(key, {}))
        merged["max"] = merged["last_row"] - merged["first_row"] + 1
        tables[key] = merged
    return tables


# 原本と変わってはいけない定義名
DEFINED_NAMES = ("GN_SHOTEI", "GN_ZANGYO_JOGEN", "GN_WARIMASHI", "GN_ZANGYO_KIJUN")
