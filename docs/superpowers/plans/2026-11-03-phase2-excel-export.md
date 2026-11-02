# 第2計画：Excel 出力（V34 原本への埋め込み） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場×年月を指定すると、`templates/現場管理台帳_V34_原本.xlsm` に日報・マスター・前月繰越を書き込んだ xlsm（数式・書式・マクロ・プルダウンが原本どおり）をダウンロードでき、Storage に保存して後から再ダウンロードできる。

**Architecture:** Python（openpyxl `keep_vba=True`）の純粋な「JSON → xlsm」関数を `excel/` に置き、pytest で原本との差分を検査する。Vercel の Python Function（`api/excel-fill.py`）がそれを HTTP で公開し、Next.js の Route Handler（`/api/export/excel`）がセッション確認・データ収集（RLS 経由）・JSON 組み立て・Python 呼び出し・Storage 保存・ダウンロード応答を担う。Python は DB に触らず、Next.js とは共有シークレットで結ぶ。

**Tech Stack:** openpyxl 3.1（Python 3.12 on Vercel／3.9 ローカル）、pytest、Vercel Python Runtime、Next.js 16 Route Handler、Supabase Storage（`gn-exports`）、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-genba-nippou-design.md` §8（Excel 出力）、§3（生成方式）、§11（繰越）。雛形の変更点は `templates/V34_変更点.md`、既存の復元処理は `scripts/make_v34.py`（x14 プルダウンの再作成、「＋ 行追加」ボタンの再注入）。計算ルールの記録は `docs/superpowers/plans/2026-10-30-phase1-record.md`。

## Global Constraints
- 原本は `templates/現場管理台帳_V34_原本.xlsm`（変更しない）。出力ファイル名は `[現場名]_[YYYY年MM月].xlsm`（現場名の `\ / : * ? " < > |` は `_` に置換）。
- **入力セル以外に書かない**。数式・見出し・書式・結合・印刷範囲・定義名（GN_*）・VBA は原本のまま。openpyxl で落ちるもの（x14 の入力規則、「＋ 行追加」ボタンの drawing）は `scripts/make_v34.py` と同じ方法で復元する。
- その月の日報が **31 件を超えたら出力せず** `日報が31件を超えています（N件）。雛形の上限のため出力できません。` を返す。
- Python は DB・Supabase に触らない。Next.js からの JSON だけを受け取り、`x-export-secret` ヘッダーが環境変数 `EXCEL_EXPORT_SECRET` と一致しないときは 401。
- Route Handler は `requireProfile` 相当（未ログインは 401）。現場の可視性は RLS に任せる（削除済み現場は 404）。
- 文言は日本語。スマホ 375px、タップ 44px。Server Action／Route Handler は throw せず `{ ok, error }` か適切な HTTP ステータスを返す。
- 雛形の人工・残業の計算は Excel 側の数式（GN_* 設定）で行うので、`現場情報マスター!D25:D28` に `gn_settings` の 4 値を書く。**Excel の労務費は、マスターシートに書いた日当・残業単価から Excel が計算する。** 月の途中で日当が変わった作業員は、アプリの保存値と Excel の値が食い違う（既知の制約。マスターには「その月の最終日報日時点の有効単価」を書く）。

## Review Focus
- 作業員が 11 人以上／車両 4 台以上／リース・現金・買掛・作業内容が 7 行以上の日：行を挿入し、同シートの合計・本日原価集計・集計データ・月次集計・出面一覧の参照がずれないこと（Task 3 のテストで、挿入後の数式文字列を検査）。
- その月に日報が 0 件：出力ボタンを出さない（Task 6）。1 件だけ：`2回目` 以降は空のまま（F2 空、数式はそのまま）。
- 現場名に `/` や `:` が入る：ファイル名が置換される（Task 5 のテスト）。Storage のパスはファイル名ではなく `<site_id>/<YYYY-MM>/<timestamp>.xlsm`。
- 承認されていない日報を含む月：出力はできる（B80〜K80 の確認者・承認者・日付は承認済みのときだけ書く）。画面に「未承認の日報 N 件を含みます」と出す（Task 6）。
- 前月繰越：出力月より前の労務行の人工・労務費（作業員ごと）＋ `gn_carryovers`。繰越基準日より前の日報は除く（アプリの `workerCumulative` と同じ規則。Task 5 でその関数を再利用する）。

---

## ファイル構成

| 場所 | 役割 |
|---|---|
| `excel/__init__.py`, `excel/layout.py` | V34 の座標定義（シート名・表の行範囲・列・合計行・参照元）。定数だけ |
| `excel/fill.py` | `fill_workbook(payload: dict, template_path: str) -> bytes`。入力セルへの書き込み、繰越、ヘッダ |
| `excel/rows.py` | 行の挿入と数式の参照書き換え（§8.4） |
| `excel/restore.py` | `scripts/make_v34.py` から移した「x14 入力規則の再作成」「drawing の再注入」 |
| `excel/validate.py` | `assert_untouched(original_path, output_bytes, written_cells)`：原本との差分検査（テスト専用） |
| `excel/tests/*.py` | pytest |
| `requirements.txt` | `openpyxl==3.1.5` |
| `api/excel-fill.py` | Vercel Python Function（HTTP: POST JSON → xlsm） |
| `vercel.json` | Python 関数の `maxDuration`・`memory`、テンプレートの同梱 |
| `src/lib/export/payload.ts` | DB の読み取り結果 → Python に渡す JSON（純関数） |
| `src/lib/export/filename.ts` | ファイル名・Storage パス |
| `src/lib/db/exports.ts` | 出力履歴（Storage の一覧）と署名 URL |
| `src/app/api/export/excel/route.ts` | Route Handler |
| `src/components/site/ExcelExportSection.tsx` | 現場詳細の「Excel 出力」 |
| `src/content/guide/excel.md` | ガイド |

Python のパッケージは Next.js とは独立（`package.json` のテストには含めない）。ローカルは `python3 -m pytest excel/tests`。

---

### Task 1: Python の座標定義と基本の埋め込み（行挿入なし）

**Files:**
- Create: `excel/__init__.py`, `excel/layout.py`, `excel/fill.py`, `excel/validate.py`, `requirements.txt`, `excel/tests/conftest.py`, `excel/tests/test_fill.py`, `excel/tests/fixtures/payload_basic.json`

**Interfaces:**
- Produces: `fill_workbook(payload, template_path) -> bytes`（xlsm のバイト列）。`payload` の形は下記（Task 5 の `buildExportPayload` が同じ形を作る）。
- Produces: `layout.py` の定数：`SITE_SHEET='現場情報マスター'`, `MASTER_SHEET='マスター'`, `DAY_SHEET(n)='{n}回目'`, `SUMMARY_SHEETS=['月次集計','現場原価集計','集計データ','出面一覧']`, 表定義 `TABLES = { 'labor': Table(first=8, last=17, total=18, cols={'name':'B','start':'C','end':'D','break':'E','gap':'F','note':'L'}), 'vehicle': Table(21,23,24,{'name':'B','distance':'D','price':'E','note':'H'}), 'lease': Table(27,32,33,{'name':'B','spec':'C','unit':'D','qty':'E','note':'H'}), 'cash': Table(36,41,42,{'name':'B','spec':'C','unit':'D','qty':'E','price':'F','vendor':'H'}), 'credit': Table(45,50,51,{...同じ}), 'work': Table(63,68,69,{'trade':'B','desc':'C','qty':'E','unit':'F','man_days':'G','price':'I'}) }`、単独セル `CELLS = {'date':'F2','weather':'F3','supervisor':'F4','common_start':'B6','common_end':'C6','common_break':'D6','common_gap':'E6','cum_cost':'E60','output':'H60','issues':'A71','notes':'A76','creator':'B80','reviewer':'E80','approver':'H80','approved_date':'K80'}`、マスター表 `MASTER = {'workers': (3, 32, {'no':'A','name':'B','trade':'C','daily_rate':'D','overtime_rate':'E','note':'F'}), 'suppliers': (3, 30, {'no':'G','name':'H','category':'I','contact':'J','note':'K'}), 'vehicles': (3, 22, {'no':'M','name':'N','kind':'O','km_per_l':'P','note':'Q'}), 'lease_items': (3, 22, {'no':'S','name':'T','spec':'U','unit_price':'V','note':'W'})}`、繰越 `CARRY = (36, 65, {'man_days':'C','cost':'D'})`（作業員 i 行目 ↔ 繰越 i 行目）、現場情報 `SITE_CELLS = {'name':'D4','client':'D5','project':'D6','project_no':'D7','overview':'D8','contract_amount':'D9','start_date':'D10','end_date':'D11','contract_type':'D12','shotei':'D25','overtime_limit':'D26','multiplier':'D27','base_hours':'D28'}`。

payload（JSON）：
```json
{ "site": {"name","client","project","project_no","overview","contract_amount","start_date","end_date","contract_type"},
  "settings": {"shotei_hours":7.5,"fixed_overtime_limit":8,"overtime_multiplier":1.25,"overtime_base_hours":8},
  "masters": {"workers":[{"name","trade","daily_rate","overtime_rate","note","carry_man_days","carry_cost"}],
              "suppliers":[{"name","category","contact","note"}], "vehicles":[{"name","kind","km_per_l","note"}],
              "lease_items":[{"name","spec","unit_price","note"}]},
  "reports": [ { "date":"2026-11-01","weather","supervisor","common":{"start","end","break_min","gap_min"},
                 "labor":[{"name","start","end","break_min","gap_min","note"}],
                 "vehicles":[{"name","distance_km","price_per_l","note"}],
                 "lease":[{"name","spec","unit","qty","note"}],
                 "cash":[{"name","spec","unit","qty","unit_price","vendor"}],
                 "credit":[{"name","spec","unit","qty","unit_price","vendor"}],
                 "work":[{"trade","description","qty","unit","man_days","unit_price"}],
                 "cumulative_cost": 123456, "output_total": 50000,
                 "issues_text":"…", "notes_text":"…", "total_index": 12,
                 "creator":"…", "reviewer":null, "approver":null, "approved_date":null } ] }
```
`reports` は日付順で最大 31 件。`labor[].start/end` が null の行は C・D を空のまま（雛形の数式が共通値を使う）。日付は Excel の日付型で書く（文字列ではなく `datetime.date`）。金額・数量は数値。空文字は書かない（None のまま）。

- [ ] **Step 1: `excel/validate.py` と失敗するテストを書く**

```python
# excel/tests/test_fill.py
def test_writes_header_and_labor(template, payload_basic):
    out = fill_workbook(payload_basic, template)
    wb = load_workbook(io.BytesIO(out), keep_vba=True)
    ws = wb["1回目"]
    assert ws["F2"].value == date(2026, 11, 1)
    assert ws["F3"].value == "晴れ" and ws["F4"].value == "検証太郎"
    assert (ws["B6"].value, ws["C6"].value, ws["D6"].value, ws["E6"].value) == ("08:00", "17:30", 90, 0)
    assert ws["B8"].value == "山田 太郎" and ws["C8"].value is None   # 個別時間なし
    assert ws["B9"].value == "鈴木 一郎" and ws["C9"].value == "08:00" and ws["D9"].value == "12:00"
    assert ws["L8"].value == "大工"
    assert ws["E60"].value == 10600 and ws["H60"].value == 50000
    assert ws["A76"].value.startswith("【通算12回目】\n")
    assert wb["2回目"]["F2"].value is None                            # 2件目は空のまま

def test_site_master_and_settings(template, payload_basic):
    ws = wb["現場情報マスター"]; assert ws["D4"].value == "検証現場X"; assert ws["D9"].value == 10_000_000
    assert ws["D25"].value == 7.5 and ws["D28"].value == 8
    wm = wb["マスター"]; assert wm["B3"].value == "山田 太郎" and wm["D3"].value == 18000 and wm["E3"].value is None
    assert wm["C36"].value == 2.5 and wm["D36"].value == 45000      # 前月繰越

def test_untouched_cells_equal_original(template, payload_basic):
    out = fill_workbook(payload_basic, template)
    assert_untouched(template, out, written_cells(payload_basic))   # 数式・定義名・シート数・vbaProject.bin の一致

def test_too_many_reports_raises(template, payload_basic):
    payload = {**payload_basic, "reports": payload_basic["reports"] * 32}
    with pytest.raises(ValueError, match="31"):
        fill_workbook(payload, template)
```
`assert_untouched` は、原本と出力の両方を `load_workbook(keep_vba=True)` で開き、全シート・全セルについて「書き込み対象セル以外は value（数式文字列を含む）が等しい」「`wb.defined_names` が等しい」「`sheetnames` が等しい」こと、さらに zip 内の `xl/vbaProject.bin` のバイト列が等しいことを検査する。`written_cells(payload)` は `fill_workbook` が書いた `{(sheet, coord)}` を返す補助（`fill.py` が返す記録を使う）。

- [ ] **Step 2: テストが失敗することを確認**　Run: `python3 -m pytest excel/tests -q`　Expected: ImportError（fill_workbook 未定義）

- [ ] **Step 3: `excel/layout.py`・`excel/fill.py` を実装**

`fill_workbook(payload, template_path)`：`load_workbook(template_path, keep_vba=True)` → `warnings` で x14 の警告を抑止 → 31 件超なら `ValueError('日報が31件を超えています（N件）')` → 現場情報・設定 → マスター 4 表（No. は 1 から連番、`overtime_rate` は None/0 なら空）→ 繰越（作業員 i 行目の C/D）→ 各日報を `N回目` に（`total_index` から `A76` の先頭行 `【通算M回目】` を作り、`notes_text` を改行で続ける。`issues_text` はそのまま A71）→ `io.BytesIO` に保存して bytes を返す。書いたセルを `fill.last_written: set[(sheet, coord)]` に記録する。時刻は `"HH:MM"` の文字列（雛形の入力規則はリスト。B6〜E6 は数値 `(C6-B6)*24` で計算するので、**B6・C6 と作業員の C・D は Excel の時刻として `datetime.time` で書く**。テストの期待値も `time(8, 0)` に直す）。

- [ ] **Step 4: テストが通ることを確認**　Run: `python3 -m pytest excel/tests -q`　Expected: 4 passed

- [ ] **Step 5: Commit**　`git add excel requirements.txt && git commit -m "feat(excel): V34 原本への基本の埋め込み（Python、行挿入なし）"`

---

### Task 2: 落ちた入力規則と「＋ 行追加」ボタンの復元

**Files:**
- Create: `excel/restore.py`, `excel/tests/test_restore.py`
- Modify: `excel/fill.py`（保存前後に restore を呼ぶ）, `scripts/make_v34.py`（復元処理を `excel/restore.py` から import して重複を消す。挙動は変えない）

**Interfaces:**
- Produces: `read_validations(template_path) -> dict[sheet, list]`, `apply_validations(wb, validations)`, `reinject_drawings(template_path, output_bytes) -> bytes`（`scripts/make_v34.py` の `read_source_validations` / `read_source_drawings` / `reinject_drawings` を関数化したもの）。

- [ ] **Step 1: 失敗するテスト**

```python
def test_validations_restored(template, payload_basic):
    wb = load_workbook(io.BytesIO(fill_workbook(payload_basic, template)), keep_vba=True)
    dvs = wb["1回目"].data_validations.dataValidation
    sqrefs = " ".join(str(d.sqref) for d in dvs)
    assert "F3" in sqrefs and "B8" in sqrefs and "B21" in sqrefs and "B27" in sqrefs   # 天候・作業員・車両・品目
    assert any("D12" in str(d.sqref) for d in wb["現場情報マスター"].data_validations.dataValidation)

def test_add_row_button_kept(template, payload_basic):
    out = fill_workbook(payload_basic, template)
    with zipfile.ZipFile(io.BytesIO(out)) as zf:
        names = zf.namelist()
        assert any(n.startswith("xl/drawings/drawing") for n in names)
        sheet1 = zf.read("xl/worksheets/sheet3.xml").decode()      # 1回目（シート順は conftest で解決する）
        assert "<drawing " in sheet1
```
- [ ] **Step 2: 失敗を確認**　Run: `python3 -m pytest excel/tests/test_restore.py -q`　Expected: FAIL（入力規則 0 件・drawing なし）
- [ ] **Step 3: `excel/restore.py` を実装し、`fill_workbook` の保存直前に `apply_validations`、保存直後に `reinject_drawings` を通す。`scripts/make_v34.py` は同じ関数を使うよう書き換え、`python3 scripts/make_v34.py templates/現場管理台帳_V33_原本.xlsm /tmp/claude-501/v34_check.xlsm` が今までと同じファイル（`templates/現場管理台帳_V34_原本.xlsm` と全セル一致）を作ることを `assert_untouched` で確認する**
- [ ] **Step 4: 通ることを確認**　Run: `python3 -m pytest excel/tests -q`　Expected: all passed
- [ ] **Step 5: Commit**　`git commit -m "feat(excel): 入力規則と行追加ボタンを原本から復元"`

---

### Task 3: 行が足りない日の行挿入と参照の書き換え（§8.4）

**Files:**
- Create: `excel/rows.py`, `excel/tests/test_rows.py`
- Modify: `excel/fill.py`（表の件数が定員を超えたら `rows.expand_table` を先に呼ぶ）, `excel/layout.py`（`集計データ` の各回目のブロック定義を追加）

**Interfaces:**
- Produces: `expand_table(wb, day_sheet: str, table: str, extra: int) -> None`。`shift_refs(formula: str, target_sheet: str, from_row: int, by: int, current_sheet: str) -> str`（`openpyxl.formula.Tokenizer` で RANGE トークンだけを書き換える。`target_sheet` への参照（同シート内の無印参照、または `'N回目'!` 付き）で行番号 ≥ `from_row` のものを `by` 行ずらす。`$` 付き（絶対）も同様にずらす。他シートへの参照は触らない）。

アルゴリズム（`expand_table`）：
1. `table.last` の直下に `extra` 行を `ws.insert_rows(last+1, extra)`（openpyxl は参照を直さない）。
2. まず **そのブック内の全シートの全数式** を `shift_refs(..., target_sheet=day_sheet, from_row=last+1, by=extra)` で書き換える（挿入行より下を指す参照だけがずれる。合計 `SUM(G8:G17)` は終端 17 が `from_row` 未満なので変わらないので、次で広げる）。
3. 合計行の `SUM` 範囲を `first..last+extra` に広げる（表の `total` 行の全数式について `last` → `last+extra`）。
4. 挿入した各行に、直上の明細行（`last` 行）の数式を相対参照で複製（`openpyxl.formula.translate.Translator`）し、書式・行の高さ・結合（`C63:D63` のような行内結合）を複製。A 列の項番を連番で書く。
5. 印刷範囲の終端行と、`A71:L74`・`A76:L79` などの結合の行番号は手順 2 で ws 側の `merged_cells` と `print_area` も同じ規則でずらす（`insert_rows` は結合を動かさないため自前で）。
6. `labor` のときは `集計データ` にもその回目の労務ブロック（`B=回目` の値が一致する `A='労務'` の行の直下）に `extra` 行を挿入し、`C/D/E/F` の数式（`'N回目'!B{row}` 等）を新しい行番号で書く。`出面一覧`・`月次集計` は列全体の SUMIFS／固定セル参照なので手順 2 だけで足りる（`COUNTA('1回目'!B8:B17)` は手順 3 と同じ規則で終端を広げる）。
7. `drawing`（＋ 行追加ボタン）のアンカー行は動かさない（ボタンは表の見出し行にあり、挿入行より上）。

- [ ] **Step 1: 失敗するテスト**

```python
def test_shift_refs():
    assert shift_refs("=SUM(G53:G57)", "1回目", 18, 2, "1回目") == "=SUM(G55:G59)"
    assert shift_refs("=I18", "1回目", 18, 2, "1回目") == "=I20"
    assert shift_refs("=SUM(G8:G17)", "1回目", 18, 2, "1回目") == "=SUM(G8:G17)"       # 挿入点より上は不変
    assert shift_refs("='1回目'!G58", "1回目", 18, 2, "月次集計") == "='1回目'!G60"
    assert shift_refs("='2回目'!G58", "1回目", 18, 2, "月次集計") == "='2回目'!G58"     # 別シートは不変
    assert shift_refs("=IFERROR('1回目'!$F$2,\"\")", "1回目", 18, 2, "出面一覧") == "=IFERROR('1回目'!$F$2,\"\")"

def test_twelve_workers(template, payload_basic):
    p = with_labor_rows(payload_basic, 12)
    wb = load_workbook(io.BytesIO(fill_workbook(p, template)), keep_vba=True)
    ws = wb["1回目"]
    assert ws["B19"].value == p["reports"][0]["labor"][11]["name"]
    assert ws["I20"].value == "=SUM(I8:I19)" and ws["K20"].value == "=SUM(K8:K19)"
    assert ws["G55"].value == "=I20"                       # 本日原価集計の労務費（2行下がる）
    assert ws["G60"].value == "=SUM(G55:G59)"              # 本日原価合計
    assert ws["H19"].value.startswith("=IFERROR(IF(G19<=GN_SHOTEI")
    assert wb["月次集計"]["D4"].value == "='1回目'!I20" and wb["月次集計"]["C4"].value == "=COUNTA('1回目'!B8:B19)"
    assert wb["月次集計"]["D5"].value == "='2回目'!I18"
    assert ws.print_area == "'1回目'!$A$1:$L$82"
    sd = wb["集計データ"]
    labor_rows_1 = [r for r in range(2, sd.max_row + 1) if sd[f"A{r}"].value == "労務" and sd[f"B{r}"].value in (1, "1")]
    assert len(labor_rows_1) == 12 and sd[f"C{labor_rows_1[-1]}"].value == "=IFERROR('1回目'!B19,\"\")"

def test_seven_work_rows_and_vehicles(template, payload_basic):
    p = with_rows(payload_basic, work=7, vehicles=4)
    ...  # 作業内容 7 行目が 70 行目（挿入後）、J70 の数式、合計 J71=SUM(J64:J70)（車両で 1 行、作業で 1 行ずれる）、A72 の結合が A73:L76 に移ること
```
- [ ] **Step 2: 失敗を確認**　Run: `python3 -m pytest excel/tests/test_rows.py -q`　Expected: FAIL
- [ ] **Step 3: `excel/rows.py` を実装し、`fill.py` から表ごとに呼ぶ（上の表から順に。1 つの表を広げたら次の表の行番号は `layout` の値＋累積のずれで計算する）**
- [ ] **Step 4: 通ることを確認**　Run: `python3 -m pytest excel/tests -q`　Expected: all passed
- [ ] **Step 5: 利用者確認用の見本を作る**　`python3 -c "..."` で 12 人・車両 4・作業 7 の見本 `/tmp/claude-501/sample_expand.xlsm` を出し、Excel で開いて月次集計の値が妥当かを利用者に確認してもらう（この計画の最後にまとめて）。
- [ ] **Step 6: Commit**　`git commit -m "feat(excel): 定員を超える日の行挿入と参照の書き換え"`

---

### Task 4: Vercel の Python Function

**Files:**
- Create: `api/excel-fill.py`, `vercel.json`, `api/_template/README.md`
- Modify: `.env.example`（`EXCEL_EXPORT_SECRET=`）, `README.md`（Vercel の環境変数に `EXCEL_EXPORT_SECRET` を追加、Python 関数の説明）, `.gitignore`（`__pycache__/`, `.pytest_cache/`）

**Interfaces:**
- Produces: `POST /api/excel-fill`（ヘッダー `x-export-secret`、本文は Task 1 の payload JSON）→ 200 `application/vnd.ms-excel.sheet.macroEnabled.12` のバイト列、401（秘密不一致）、400（payload 不正・31 件超：本文 `{ "error": "…" }`）、500（それ以外。本文に原因は出さず `console` に残す）。

- [ ] **Step 1: `api/excel-fill.py` を実装**　`BaseHTTPRequestHandler` 形式（Vercel Python Runtime）。`sys.path` に repo ルートを足して `from excel.fill import fill_workbook`。テンプレートのパスは `os.path.join(os.path.dirname(__file__), '..', 'templates', '現場管理台帳_V34_原本.xlsm')`。本文は 5MB まで。
- [ ] **Step 2: `vercel.json`**
```json
{ "functions": { "api/excel-fill.py": { "maxDuration": 60, "memory": 1024, "includeFiles": "templates/現場管理台帳_V34_原本.xlsm" } } }
```
`includeFiles` が Python で効かない場合の予備：テンプレートを `api/_template/現場管理台帳_V34_原本.xlsm` にもコピーし（`_` 始まりのディレクトリは関数にならない）、関数はまず `templates/`、無ければ `api/_template/` を読む。README にその旨を書く。
- [ ] **Step 3: ローカルで関数を直接呼ぶテスト**　`excel/tests/test_api.py`：`api/excel-fill.py` の handler を `http.server` で起動して POST し、401（秘密なし）と 200（正しい秘密＋`payload_basic`）、400（32 件）を確認。
- [ ] **Step 4: 配置の確認（利用者と）**　push 後、Vercel の環境変数 `EXCEL_EXPORT_SECRET` を設定（利用者）→ `curl -X POST https://genba-nippou-ten.vercel.app/api/excel-fill` が 401 を返すこと、正しい秘密で `payload_basic.json` を送ると xlsm が返ることを私が確認する。Python のビルドが失敗したら、ログを読んで対処（`requirements.txt`、ランタイム版）。
- [ ] **Step 5: Commit**　`git commit -m "feat(api): Excel 出力の Python Function（Vercel）"`

---

### Task 5: Next.js 側のデータ収集と Route Handler

**Files:**
- Create: `src/lib/export/payload.ts`, `src/lib/export/filename.ts`, `src/lib/db/exports.ts`, `src/app/api/export/excel/route.ts`, `tests/export/payload.test.ts`, `tests/export/filename.test.ts`
- Modify: `src/lib/db/reports.ts`（月の日報を明細付きでまとめて読む `listReportsWithLines(siteId, month)`：既存 `getReport` のページング規則に従う）, `src/lib/db/summary.ts`（繰越に使う `loadLaborEntries` はそのまま）

**Interfaces:**
- Consumes: `workerCumulative(entries, carryovers, workerNames, period)`（`src/lib/calc/aggregate.ts`。繰越＝`period.from` より前の分）、`visitNumbers(allDates, date)`（通算回目）、`rateAt(rates, date)`、`getSettings()`、`listWorkers/…`、`getSiteMasters(siteId)`（現場で使うマスター）、`listSiteMembers`（確認者・承認者の氏名）、`listReportHeads`。
- Produces: `buildExportPayload(input: ExportInput): ExportPayload`（純関数。`ExportInput` は上の読み取り結果の束。`ExportPayload` は Task 1 の JSON と同じ型）。`exportFileName(siteName, month) -> string`（`[現場名]_[YYYY年MM月].xlsm`、禁止文字は `_`）。`storagePath(siteId, month, now) -> string`（`<site_id>/<YYYY-MM>/<YYYYMMDD-HHmmss>.xlsm`）。`listExports(siteId) -> { path, month, createdAt, size }[]`、`signedUrl(path) -> string`（60 秒）。

規則：
- `reports` は `month` の日報を日付順に。`labor[].start/end` は個別時間がなければ null。`cumulative_cost` はその日までの（月をまたいだ）`cost_total` の累計（繰越初期値は含めない）。`output_total` はその日の `output_total`。`total_index` は `visitNumbers`。
- `masters.workers` は「現場で使う作業員（`gn_site_workers`）∪ その月の労務行で参照した作業員」を名前順。`daily_rate` は `rateAt(rates, その月の最終日報日)`、`overtime_rate` はマスター値。`carry_man_days/carry_cost` は `workerCumulative` の繰越（`period.from` = 月初）。取引先・車両・リース品も「現場で使う ∪ 使った」。30／20 件を超えたら先頭から切り、`warnings` に `作業員が30人を超えたため、31人目以降はマスターに書いていません` を積む（Route Handler がヘッダー `x-export-warnings` で返し、画面に出す）。
- `creator` は `created_by` の氏名、`reviewer/approver` は `reviewed_by/approved_by` の氏名、`approved_date` は承認日（`status === 'approved'` のときだけ）。

Route Handler `GET /api/export/excel?site=<uuid>&month=YYYY-MM`：
1. `getCurrentProfile()`（null → 401）。`site` が UUID でない／`month` が形式外 → 400。`getSite`（null または削除済み → 404）。
2. 読み取り → `buildExportPayload` → 日報 0 件なら 400 `{ error: 'この月の日報がありません' }`、32 件以上なら 400。
3. `fetch(`${origin}/api/excel-fill`, { method: 'POST', headers: { 'x-export-secret': process.env.EXCEL_EXPORT_SECRET }, body })`（`origin` はリクエストの URL から。ローカルでは Python 関数が無いので、`EXCEL_FILL_URL` が設定されていればそれを使う）。非 200 → 502 `{ error: 'Excel の生成に失敗しました。しばらくしてからもう一度お試しください。' }`。
4. Storage `gn-exports` に `storagePath` で upload（`contentType` は xlsm の MIME）。失敗しても応答は返す（`x-export-saved: 0`）。
5. 200、`Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(name)>`、本文はバイト列。

- [ ] **Step 1: テスト（payload・filename）を書く**　`tests/export/payload.test.ts`：2 日分の入力から `reports[0].total_index`、`cumulative_cost`（前月分を含む）、個別時間 null の扱い、`masters.workers` の順と `daily_rate`（最終日報日時点）、繰越の値（`workerCumulative` と一致）、31 件超で `tooMany: true`。`tests/export/filename.test.ts`：`村山邸/母屋:改修` → `村山邸_母屋_改修_2026年11月.xlsm`。
- [ ] **Step 2: 失敗を確認**　Run: `npm test -- tests/export`　Expected: FAIL
- [ ] **Step 3: 実装**（`payload.ts`, `filename.ts`, `reports.ts` の読み取り追加, `exports.ts`, `route.ts`）
- [ ] **Step 4: 通ることを確認**　Run: `npm test && npx tsc --noEmit && npm run lint`
- [ ] **Step 5: Commit**　`git commit -m "feat(export): Excel 出力のデータ収集・Route Handler・Storage 保存"`

---

### Task 6: 画面・ガイド・記録

**Files:**
- Create: `src/components/site/ExcelExportSection.tsx`
- Modify: `src/app/(app)/sites/[siteId]/page.tsx`（「集計を見る」の下に配置）, `src/content/guide/excel.md`（「Excel出力（第2計画で追記）」→ 本文）, `src/lib/guide.ts`（題名を「Excel出力」に）, `tests/guide.test.ts`, `docs/superpowers/plans/README.md`（第2計画の行を本ファイル名に）, `docs/superpowers/plans/2026-10-30-phase1-record.md`（「第2計画 2026-11-03」節）, `README.md`

**Interfaces:** `ExcelExportSection({ siteId, months: { month: string; count: number; unapproved: number }[], exports: ExportEntry[] })`（サーバーで集計して渡す）。

- [ ] **Step 1: 実装**　月の選択（日報のある月だけ。既定は最新月）、「Excel を出力」ボタン（`<a href="/api/export/excel?site=…&month=…" download>` ではなく `fetch` → `blob` → `a.click()` にして、エラー JSON を日本語で表示できるようにする）、「未承認の日報 N 件を含みます」の注記、`x-export-warnings` の表示、過去の出力一覧（月・日時・サイズ、「ダウンロード」は署名 URL を Server Action で取って開く）。完了現場・閲覧専用でも出力できる。
- [ ] **Step 2: ガイド**　「現場詳細 → Excel を出力」「ファイル名」「前月繰越は自動」「作業員は 30 人まで」「月の途中で日当が変わった場合の注意」「出力したファイルは後からダウンロードできる」「＋ 行追加の備考が残る既知の注意（V34_変更点.md）」。
- [ ] **Step 3: `npm test && npx tsc --noEmit && npm run lint && npm run build`**
- [ ] **Step 4: Commit**　`git commit -m "feat(site): Excel 出力の画面とガイド"`

---

### Task 7: 本番での検証（利用者と）

- [ ] 村山邸の 2026 年 11 月を出力 → Excel で開く：マクロ警告が出て有効化できる（VBA が残っている）、天候・作業員名のプルダウンが効く、`1回目` の日付・作業員・時刻が合う、月次集計の労務費・本日原価がアプリの集計画面と一致する、マスターシートの日当・残業単価・前月繰越が合う。
- [ ] 作業員 12 人の日報を試験で作って出力 → 行が増え、合計・月次集計が合う。
- [ ] 現場詳細の出力一覧から再ダウンロードできる。
- [ ] 結果と据え置き事項を記録に書く。

## セルフレビュー（作成時）
- 仕様 §8.1〜8.5 の各項目：8.1（単位・ファイル名・再出力・Storage・31 件超）→ Task 5/6。8.2（keep_vba・入力セルのみ・行挿入・プルダウン再設定）→ Task 1/2/3。8.3 対応表 → Task 1 の `layout.py`（V34 で備考が L 列、残業単価が E 列に変わった点を反映。`マスター G3〜K32` は実ファイルでは取引先が G3〜K30 なので 30 件）。8.4 → Task 3。8.5 → Task 5（`workerCumulative` を再利用）。§3 の Python 関数 → Task 4。
- Task 間の名前：`fill_workbook` / payload の JSON 形（Task 1 ↔ 5）、`EXCEL_EXPORT_SECRET`（Task 4 ↔ 5）、`storagePath`（Task 5 ↔ 6）を統一した。
- 未決：Vercel の Python 関数でテンプレートを同梱する方法（`includeFiles` が効かない場合の予備を Task 4 に書いた）。Hobby プランの関数時間（60 秒指定、超える場合は 300 秒まで上げられる）。
