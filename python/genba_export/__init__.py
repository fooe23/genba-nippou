"""現場日報アプリの Excel 出力（V34 雛形の入力セルだけを埋める）。

- `layout`      … 雛形 V34 のセル対応表（定数）
- `fill`        … payload を雛形に書き込んで xlsm のバイト列を返す
- `postprocess` … openpyxl 保存後の zip を原本で補う
"""
