"""Python 側（Excel 出力）のテスト。

`npm run test:py`（= python3 -m unittest discover -s python/tests -t .）で実行する。
テストから `genba_export` を import できるよう、`python/` を sys.path に足す。
"""
import os
import sys

PYTHON_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(PYTHON_DIR)
if PYTHON_DIR not in sys.path:
    sys.path.insert(0, PYTHON_DIR)
