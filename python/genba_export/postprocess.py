"""openpyxl で保存した xlsm を、原本の zip から補う。

Task 1 では「`xl/vbaProject.bin` が出力に無ければ原本から足す」だけ。
x14 拡張の入力規則（プルダウン）と「＋ 行追加」ボタン（drawing）の復元は Task 3。
"""
from __future__ import annotations

import io
import zipfile

VBA_PART = "xl/vbaProject.bin"


def restore_parts(template_path: str, saved: bytes) -> bytes:
    """openpyxl が保存した xlsm（saved）に、原本から落ちた部品を戻して返す。"""
    with zipfile.ZipFile(io.BytesIO(saved)) as zout:
        if VBA_PART in zout.namelist():
            return saved
        entries = [(info, zout.read(info.filename)) for info in zout.infolist()]
    with zipfile.ZipFile(template_path) as zsrc:
        vba = zsrc.read(VBA_PART)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zw:
        for info, data in entries:
            zw.writestr(info, data)
        zw.writestr(VBA_PART, vba)
    return buf.getvalue()
