# 第2計画：Excel 出力（V34 原本をそのまま埋める）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場×年月を指定すると、雛形 `templates/現場管理台帳_V34_原本.xlsm` の入力セルだけにアプリの日報データを書き込んだ xlsm（数式・書式・マクロ・プルダウンは原本のまま）をダウンロードでき、同じファイルが Storage にも残る。

**Architecture:** Next.js の Route Handler（`/api/export`）が認証と月次データの収集を行い、JSON（payload）を Python 関数に渡す。Python（openpyxl, `keep_vba=True`）が雛形を開いて payload を対応表どおりに書き、保存後に zip を直接編集して openpyxl が落とすプルダウン（x14 拡張）と「＋ 行追加」ボタン（drawing）を原本から戻す。Python は Vercel の Python Functions（`api/export/fill.py`）として同じデプロイに同居し、Node 側からは共有秘密ヘッダ付きの内部 POST で呼ぶ。ローカル開発では同じ Python モジュールを子プロセスで実行する。行が足りない日の行挿入は、雛形のレイアウト定義に基づく参照の書き換えを Python 側で行う（Task 6）。

**Tech Stack:** Next.js 16 Route Handler / TypeScript / Vitest（既存）、Python 3.12（Vercel）・3.9（ローカル）、openpyxl 3.1.5、unittest（Python のテスト）、Supabase Storage（バケット `gn-exports`、パス `<site_id>/<YYYY-MM>/<file>`）。

**Spec:** `docs/superpowers/specs/2026-10-30-genba-nippou-design.md` §8（Excel出力）、§8.4（行挿入）、§8.5（前月繰越）、§11、§14（テスト）。雛形は V34 原本（`templates/V34_変更点.md` が V33 からの差分）。計算ルールは `docs/superpowers/plans/2026-10-30-phase1-record.md`「決定（2026-10-31）人工・残業ルール」。

## Global Constraints
- 雛形は `templates/現場管理台帳_V34_原本.xlsm`。**原本ファイルは変更しない。** 出力は常にこの原本を開いて埋める。
- 書き込むのは下の対応表の入力セルだけ。数式セル・見出し・書式・結合・印刷設定・VBA（`xl/vbaProject.bin`）・定義名（`GN_SHOTEI` ほか 3 つ）には触れない。例外は Task 4 の「日当・リース単価の上書き」（スナップショットが雛形のマスター値と違う行だけ、数式セルに値を書く）。
- ファイル名は `[現場名]_[YYYY年MM月].xlsm`（現場名の `/ \ : * ? " < > |` は `_` に置換）。
- その月の日報が 32 件以上なら出力しない（雛形の上限 31 シート）。
- 出力できるのは社員と管理者（`profiles.account_type = 'employee'` または `is_admin`）。協力会社は不可。削除済みの現場は不可（完了現場は可）。
- Python の Vercel 関数は `api/export/fill.py`。秘密は環境変数 `GN_EXPORT_SECRET`（Node と Python の両方で読む）。Node → Python の呼び先は `process.env.GN_EXPORT_FILL_URL`（未設定なら `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/export/fill`）。ローカル（`process.env.VERCEL` 無し）では `python3 python/run_fill.py` を子プロセスで実行（stdin に JSON、stdout に xlsm）。
- Python の依存は `requirements.txt`（`openpyxl==3.1.5` のみ）。純 Python 以外は入れない。
- Server Action／Route Handler の失敗は JSON `{ ok: false, error: '日本語の文言' }` で返す。UI は日本語、375px、44px。
- 既存の約束事：読み取りは `src/lib/db/*.ts`（`server-only`）、純関数は `src/lib/export/*.ts` と `python/genba_export/*.py`、テストは `tests/**`（Vitest）と `python/tests/**`（unittest）。

## Review Focus
- 日当がその月の途中で変わった作業員：雛形のマスターには 1 つの日当しか書けない。各日の労務費は保存値（スナップショット）と一致していなければならない → Task 4 の上書き規則と Task 1 の J 列テスト。
- 作業員が 11 人以上・車両 4 台以上などの日：行挿入後も 月次集計・集計データ・出面一覧 の参照が正しいこと → Task 6 のテスト（参照文字列の検査）と Task 7 の利用者確認。
- 同じ作業員が 1 日に 2 行（午前・午後で別の時間）あるとき：雛形は行ごとに VLOOKUP するので問題ないが、出面一覧は名前で SUMIFS するため 2 行の合計になる（アプリの作業員別累計と同じ）。Task 4 のテストで 2 行を含める。
- 時間が入っていない行（共通時間で計算）：C・D を空のまま書き、E・F も空にする（雛形の数式が共通値を使う）。個別の休憩・中抜だけ入っている行は C・D が空だと雛形は共通実働を使うので、**C・D が空で E か F だけある行は、共通の開始・終了を C・D に書く**（Task 4）。
- 日報が 0 件の月、現場に作業員が未選択の月、承認者が未設定の日報、重要事項が 0 件、改行を含む連絡事項：いずれも例外にせず空欄で出す（Task 4・5 のテスト）。

---

## 雛形 V34 のセル対応表（Python の `layout.py` に定数として持つ）

| 場所 | セル | 書く値 |
|---|---|---|
| 現場情報マスター | D4〜D12 | 現場名、客先名、工事名、工事番号、工事概要、工事総請負金額（数値）、着工予定日（date）、竣工予定日（date）、請負の種類 |
| 現場情報マスター | D25〜D28 | 労務の設定（所定、固定残業上限、割増率、基準時間）＝ `gn_settings` の値 |
| マスター（作業員） | 行 3〜32、B 名前・C 職種・D 日当・E 残業単価・F 備考 | この月の出力対象の作業員（Task 4 の選び方）。最大 30 人 |
| マスター（取引先） | 行 3〜32、H 名前・I 区分・J 担当者・K 備考 | 最大 30 件 |
| マスター（車両） | 行 3〜22、N 名前・O 種別・P 燃費・Q 備考 | 最大 20 台 |
| マスター（リース品） | 行 3〜22、T 品目・U 規格・V 単価・W 備考 | 最大 20 件 |
| マスター（前月繰越） | 行 36〜65、C 人工・D 労務費 | 作業員 i（行 3+i）に対応。出力月より前の全日報の人工・労務費の合計＋ `gn_carryovers` |
| `N回目` | F2（date）、F3、F4 | 日付、天候、作業責任者 |
| `N回目` | B6（time）、C6（time）、D6、E6 | 共通の開始・終了・休憩分・中抜分 |
| `N回目` 作業員 | 行 8〜17：B 名前、C 開始（time）、D 終了（time）、E 休憩、F 中抜、L 備考。J は数式（例外あり） | 労務行 |
| `N回目` 車両 | 行 21〜23：B 車両名、D 走行距離、E 燃料単価、H 備考 | 燃料行（C 燃費は数式） |
| `N回目` リース | 行 27〜32：B 品目、C 規格、D 単位、E 数量、H 備考。F は数式（例外あり） | リース行 |
| `N回目` 現金 | 行 36〜41：B 品目、C 規格、D 単位、E 数量、F 購入単価、H 購入先 | 現金行 |
| `N回目` 買掛 | 行 45〜50：B 品目、C 規格、D 単位、E 数量、F 仕入単価、H 仕入先 | 買掛行 |
| `N回目` | E60 | 累計原価（この日までの `cost_total` の累計。繰越は含まない） |
| `N回目` | H60 | 本日出来高（`output_total`） |
| `N回目` 作業内容 | 行 63〜68：B 工種、C 施工内容（C:D 結合）、E 数量、F 単位、G 投入人工、I 施工単価 | 作業内容行 |
| `N回目` | A71（A71:L74 結合） | 重要事項の文章＋`gn_report_issues` の件を「・」付きで改行区切りで追記 |
| `N回目` | A76（A76:L79 結合） | 1 行目 `【通算M回目】`、2 行目以降に連絡事項 |
| `N回目` | B80、E80、H80、K80（date） | 作成者名、確認者名、承認者名、承認日（承認済みのときだけ） |
| 月次集計・現場原価集計・集計データ・出面一覧 | — | 書かない（数式） |

雛形の明細行数：作業員 10、車両 3、リース 6、現金 6、買掛 6、作業内容 6。日付の time 値は `datetime.time`、日付は `datetime.date` で書く（雛形の表示形式がそのまま効く）。

---

### Task 1: Python パッケージの骨格と「現場情報・マスター・繰越」の書き込み

**Files:**
- Create: `python/genba_export/__init__.py`, `python/genba_export/layout.py`, `python/genba_export/fill.py`, `python/genba_export/postprocess.py`, `python/run_fill.py`, `python/tests/__init__.py`, `python/tests/test_fill_masters.py`, `python/tests/fixtures/payload_small.json`, `requirements.txt`
- Modify: `package.json`（`"test:py": "python3 -m unittest discover -s python/tests -t ."`）、`.gitignore`（`python/**/__pycache__/`）

**Interfaces:**
- Produces: `fill.fill_workbook(template_path: str, payload: dict) -> bytes`（xlsm のバイト列）。`layout.py` の定数 `SITE_INFO_CELLS`, `MASTER_BLOCKS`, `CARRYOVER_ROWS`, `DAY_TABLES`（各表の `first_row, last_row, total_row, columns`）、`DAY_CELLS`。
- payload の形（Task 4 の TypeScript 側と一致させる。キーは snake_case）:
  ```json
  { "file_name": "現場_2026年11月.xlsm",
    "site": { "name": "", "client_name": null, "project_name": null, "project_no": null, "overview": null, "contract_amount": null, "start_date": null, "end_date": null, "contract_type": null },
    "settings": { "shotei_hours": 7.5, "fixed_overtime_limit": 8, "overtime_multiplier": 1.25, "overtime_base_hours": 8 },
    "workers": [ { "name": "", "trade": null, "daily_rate": null, "overtime_rate": null, "note": null, "carry_man_days": 0, "carry_cost": 0 } ],
    "suppliers": [ { "name": "", "category": null, "contact": null, "note": null } ],
    "vehicles": [ { "name": "", "kind": null, "km_per_l": null, "note": null } ],
    "lease_items": [ { "name": "", "spec": null, "unit_price": null, "note": null } ],
    "days": [ { "index": 1, "date": "2026-11-01", "total_index": 12, "weather": null, "supervisor": null,
                "common": { "start": "08:00", "end": "17:30", "break_min": 90, "gap_min": 0 },
                "labor": [ { "name": "", "start": null, "end": null, "break_min": null, "gap_min": null, "note": null, "daily_rate": 18000, "master_daily_rate": 18000 } ],
                "fuel": [ { "name": "", "distance_km": null, "price_per_l": null, "note": null } ],
                "lease": [ { "name": "", "spec": null, "unit": null, "qty": null, "note": null, "unit_price": 3000, "master_unit_price": 3000 } ],
                "cash": [ { "name": "", "spec": null, "unit": null, "qty": null, "unit_price": null, "vendor": null } ],
                "credit": [ { "name": "", "spec": null, "unit": null, "qty": null, "unit_price": null, "vendor": null } ],
                "work": [ { "trade": null, "description": null, "qty": null, "unit": null, "man_days": null, "unit_price": null } ],
                "cumulative_cost": 0, "output_total": 0,
                "issues_text": null, "issues": [ "件の本文" ], "notes_text": null,
                "created_by": null, "reviewed_by": null, "approved_by": null, "approved_at": null } ] }
  ```

- [ ] **Step 1: 失敗するテストを書く（`python/tests/test_fill_masters.py`）**

```python
class FillMastersTest(unittest.TestCase):
    def test_site_info_and_masters_written(self):
        out = fill_workbook(TEMPLATE, load_fixture("payload_small.json"))
        wb = openpyxl.load_workbook(io.BytesIO(out), keep_vba=True)
        info = wb["現場情報マスター"]
        self.assertEqual(info["D4"].value, "検証現場")
        self.assertEqual(info["D9"].value, 12000000)
        self.assertEqual(info["D10"].value, datetime.date(2026, 10, 1))
        self.assertEqual(info["D25"].value, 7.5)
        m = wb["マスター"]
        self.assertEqual([m["B3"].value, m["C3"].value, m["D3"].value, m["E3"].value, m["F3"].value], ["山田 太郎", "大工", 18000, None, "備考A"])
        self.assertEqual(m["E4"].value, 3000)        # 残業単価あり
        self.assertEqual(m["H3"].value, "○○建材")
        self.assertEqual(m["P3"].value, 9.5)         # 車両 燃費
        self.assertEqual(m["V3"].value, 3000)        # リース単価
        self.assertEqual([m["C36"].value, m["D36"].value], [12.5, 225000])  # 前月繰越
        self.assertEqual([m["C37"].value, m["D37"].value], [0, 0])
    def test_template_untouched_elsewhere(self):
        # 書いたセル以外は原本と同じ：数式・定義名・VBA
        ...  # 原本と出力を openpyxl で開き、1回目!G8/H8/I8/J8/K8 の数式文字列、定義名 4 つ、
             # zip 内 xl/vbaProject.bin のバイト列が一致すること
    def test_more_than_30_workers_fails(self):
        with self.assertRaises(ExportError) as cm: fill_workbook(TEMPLATE, payload_with_workers(31))
        self.assertEqual(cm.exception.code, "too_many_workers")
```

- [ ] **Step 2: 実行して失敗を確認** — `npm run test:py` → `ModuleNotFoundError: genba_export`
- [ ] **Step 3: 実装**
  - `layout.py`：上の対応表を定数にする。`DAY_SHEETS = [f"{i}回目" for i in range(1, 32)]`。
  - `fill.py`：`class ExportError(Exception)` に `code: str`（`too_many_workers` / `too_many_days` / `template_not_found` など）と日本語 `message`。`fill_workbook` は `openpyxl.load_workbook(template_path, keep_vba=True)` → `_write_site_info` → `_write_masters`（作業員 30・取引先 30・車両 20・リース 20 を超えたら `ExportError`）→ `_write_carryover`（作業員の並びと同じ行）→ （Task 2 以降で日報）→ `BytesIO` に保存 → `postprocess.restore_parts(template_path, saved_bytes)`（Task 1 では「原本から `xl/vbaProject.bin` が落ちていないことの確認」だけ。x14/図形の復元は Task 3）。`warnings.filterwarnings("ignore", message="Data Validation extension")`。
  - 日付文字列 `YYYY-MM-DD` → `datetime.date`、時刻 `HH:MM` → `datetime.time`、None はセルを空のまま（`cell.value = None`）。
  - `run_fill.py`：stdin の JSON（`{"template": "<path>", "payload": {...}}`）→ stdout に xlsm バイト列。失敗は stderr に `{"code":..., "message":...}` を書き exit 1。
- [ ] **Step 4: テストが通ることを確認** — `npm run test:py` → OK
- [ ] **Step 5: コミット** — `feat(export): Python で V34 雛形に現場情報・マスター・前月繰越を書き込む`

### Task 2: 日報シート（N回目）の書き込み

**Files:**
- Modify: `python/genba_export/fill.py`, `python/genba_export/layout.py`
- Create: `python/tests/test_fill_days.py`, `python/tests/fixtures/payload_days.json`

**Interfaces:**
- Consumes: Task 1 の payload `days[]`。
- Produces: `fill._write_day(ws, day: dict)`（1 シート分）。日報が無い `N回目` シートは触らない。

- [ ] **Step 1: 失敗するテスト**

```python
def test_day_sheet_values(self):
    wb = self.fill("payload_days.json")
    ws = wb["1回目"]
    self.assertEqual(ws["F2"].value, datetime.date(2026, 11, 1)); self.assertEqual(ws["F3"].value, "晴れ"); self.assertEqual(ws["F4"].value, "検証太郎")
    self.assertEqual([ws["B6"].value, ws["C6"].value, ws["D6"].value, ws["E6"].value], [datetime.time(8, 0), datetime.time(17, 30), 90, 0])
    self.assertEqual([ws["B8"].value, ws["C8"].value, ws["D8"].value, ws["L8"].value], ["山田 太郎", None, None, "大工"])   # 共通時間の行
    self.assertEqual([ws["B9"].value, ws["C9"].value, ws["D9"].value, ws["E9"].value], ["鈴木 一郎", datetime.time(8, 0), datetime.time(12, 0), 0])
    self.assertEqual(ws["J8"].value, "=IFERROR(VLOOKUP(B8,マスター!$B$3:$D$32,3,0),0)")  # 数式のまま
    self.assertEqual([ws["B21"].value, ws["D21"].value, ws["E21"].value], ["ハイエース", 40, 170])
    self.assertEqual([ws["B27"].value, ws["E27"].value], ["発電機", 2])
    self.assertEqual([ws["B36"].value, ws["F36"].value, ws["H36"].value], ["ビス", 500, "ホームセンター"])
    self.assertEqual([ws["B45"].value, ws["H45"].value], ["合板", "○○建材"])
    self.assertEqual([ws["E60"].value, ws["H60"].value], [10600, 50000])
    self.assertEqual([ws["B63"].value, ws["C63"].value, ws["E63"].value, ws["G63"].value, ws["I63"].value], ["解体", "外壁撤去", 10, 1.5, 5000])
    self.assertEqual(ws["A71"].value, "追加工事の指示あり\n・サッシ追加 2 か所")
    self.assertEqual(ws["A76"].value, "【通算12回目】\n雨天のため午後中止")
    self.assertEqual([ws["B80"].value, ws["E80"].value, ws["H80"].value, ws["K80"].value], ["検証太郎", "確認花子", "承認次郎", datetime.date(2026, 11, 2)])
def test_untouched_day_sheets_and_empty_fields(self):
    # days が 2 件なら 3回目 以降の F2 は None のまま。承認なしの日は K80 None、重要事項なしは A71 None
def test_rate_override_when_snapshot_differs(self):
    # labor.daily_rate=19000, master_daily_rate=18000 の行は J に 19000 の値、同じ行は数式のまま。リースの F も同じ規則
def test_partial_time_uses_common_start_end(self):
    # start/end が無く break_min=30 だけの行は C・D に共通の開始・終了、E に 30
def test_too_many_days(self):
    # days が 32 件 → ExportError(code="too_many_days")
def test_too_many_rows_without_insert(self):
    # 作業員 11 人の日 → ExportError(code="rows_overflow")（Task 6 で行挿入に置き換える）
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**（`_write_day`：表ごとに `DAY_TABLES` の列と行を使い、行数超過は `ExportError("rows_overflow", "{date} の{表名}が{n}行で雛形の{max}行を超えています")`。重要事項は `issues_text` と `issues` を `"\n"` で連結し件には `・` を付ける。連絡事項は `【通算M回目】` を 1 行目に）→ **Step 4: 通過確認** → **Step 5: コミット** `feat(export): 日報シート（N回目）に日報を書き込む`

### Task 3: 保存後の復元（プルダウン・行追加ボタン）と原本差分テスト

**Files:**
- Modify: `python/genba_export/postprocess.py`
- Create: `python/tests/test_postprocess.py`
- Reference: `scripts/make_v34.py` の x14 データ検証復元と drawing 復元のコード（流用してよい。`-I` 用の sys.path 細工は不要）

**Interfaces:**
- Produces: `postprocess.restore_parts(template_path: str, saved: bytes) -> bytes`。openpyxl が保存した zip に対し、原本 zip から (1) 各シート XML の `<extLst>` 内 x14 `dataValidations`、(2) 日報シートの drawing パーツ（`xl/drawings/drawingN.xml`・`_rels`・`[Content_Types].xml` の登録・シート XML の `<drawing r:id>`）、(3) `xl/vbaProject.bin` を戻す。出力ファイル名の拡張子は `.xlsm`。

- [ ] **Step 1: 失敗するテスト**

```python
def test_validations_and_buttons_restored(self):
    out = fill_workbook(TEMPLATE, payload)
    with zipfile.ZipFile(io.BytesIO(out)) as z, zipfile.ZipFile(TEMPLATE) as t:
        s_out = z.read("xl/worksheets/sheet3.xml").decode()   # 1回目（シート番号は原本の workbook.xml から引く）
        self.assertIn("x14:dataValidations", s_out)
        self.assertEqual(sorted(n for n in z.namelist() if n.startswith("xl/drawings/")), sorted(n for n in t.namelist() if n.startswith("xl/drawings/")))
        self.assertEqual(z.read("xl/vbaProject.bin"), t.read("xl/vbaProject.bin"))
def test_excel_opens(self):  # openpyxl で再読込できる（壊れていない）
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: 通過確認** → **Step 5: コミット** `feat(export): 保存後にプルダウンと行追加ボタンを原本から復元`

### Task 4: 月次データの収集と payload の組み立て（TypeScript）

**Files:**
- Create: `src/lib/export/payload.ts`（純関数）, `src/lib/export/types.ts`, `src/lib/db/export.ts`（server-only の読み取り）, `tests/export/payload.test.ts`
- Modify: `src/lib/db/reports.ts`（必要なら月の日報＋明細＋件をまとめて読む関数を追加）

**Interfaces:**
- Consumes: `Site`（`src/lib/db/sites.ts`）、`Settings`（`src/lib/db/settings.ts`）、`Worker/Supplier/Vehicle/LeaseItem`（`src/lib/db/masters.ts`）、`ReportDetail`／`Issue`（`src/lib/db/reports.ts`）、`Carryover`、`workerCumulative`（`src/lib/calc/aggregate.ts`）、`rateAt`。
- Produces: `buildExportPayload(input: ExportInput): ExportPayload`（Task 1 の JSON と同じ形。型は `types.ts`）、`exportFileName(siteName: string, month: string): string`、`loadExportInput(siteId: string, month: 'YYYY-MM'): Promise<ExportInput>`（DB 読み取り：現場、設定、現場で使うマスター、その月の日報全件（明細・件・作成者/確認者/承認者の氏名）、月より前の全労務行（繰越計算用）、繰越初期値）。

規則（テストで固定する）：
- 日報は日付順。`index` は 1 から、`total_index` は現場の全日報での通算（`visitNumbers` と同じ）。
- 作業員の並び：現場で選択した順（`gn_site_workers.sort_order`）→ 未選択だがその月の日報で使った作業員を名前順で末尾に。取引先・車両・リース品も同じ。雛形の上限（30/30/20/20）を超えたら `{ ok: false, error }` にする材料として `warnings` を返す。
- マスターの日当は**その月の最初の日報日付時点**の `rateAt`。各労務行の `daily_rate` は保存値（スナップショット）、`master_daily_rate` はその作業員のマスター値。リース単価も同じ。
- 前月繰越：`workerCumulative` と同じ規則（`gn_carryovers` の `before_date` より前の日報は初期値に含まれているとみなして除外）で、出力月の 1 日より前の人工・労務費。
- `cumulative_cost`：その現場の、この日までの `cost_total` の累計（出力月より前も含む。繰越初期値は含まない）。
- 時間が無く休憩・中抜だけある労務行：`start/end` に共通の開始・終了を入れる（Python 側は受け取った値を書くだけ）。
- 重要事項の件は `gn_report_issues` の本文（対応中・完了どちらも）。

- [ ] **Step 1: 失敗するテスト（`tests/export/payload.test.ts`）** — 上の規則それぞれに 1 件（日付順と index、作業員の並びと上限警告、月途中の日当変更（master と line が違う）、繰越の計算、cumulative_cost、休憩だけの行、ファイル名の禁止文字置換、日報 0 件の月は `days: []`）。
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: 通過確認** → **Step 5: コミット** `feat(export): 月次データから Excel 出力用 payload を組み立てる`

### Task 5: Vercel の Python 関数、Node からの呼び出し、Route Handler、画面、Storage 保存

**Files:**
- Create: `api/export/fill.py`（Vercel Python Function。`BaseHTTPRequestHandler` で POST を受け、`X-Export-Secret` を `GN_EXPORT_SECRET` と比較、本文 JSON → `fill_workbook` → `application/vnd.ms-excel.sheet.macroEnabled.12` で返す。失敗は 400/500 の JSON）, `vercel.json`（`functions: { "api/export/fill.py": { "maxDuration": 60, "includeFiles": "{templates/現場管理台帳_V34_原本.xlsm,python/**}" } }`）, `src/lib/export/fill-client.ts`（`fillWorkbook(payload): Promise<Buffer>`：本番は fetch、ローカルは `child_process.spawn('python3', ['python/run_fill.py'])`）, `src/app/api/export/route.ts`（GET `?site=<uuid>&month=YYYY-MM`）, `src/app/(app)/sites/[siteId]/export/page.tsx`, `src/components/export/ExportPanel.tsx`, `src/lib/db/export-files.ts`（Storage の一覧と署名 URL）, `src/content/guide/excel.md`（章を本文で置き換え）, `.env.example`（`GN_EXPORT_SECRET`）
- Modify: `src/app/(app)/sites/[siteId]/page.tsx`（「Excel 出力」リンク）, `README.md`（Vercel の環境変数 `GN_EXPORT_SECRET`、Python 関数の説明、ローカルは `python3` と `pip install -r requirements.txt`）, `src/lib/guide.ts`（章名「Excel出力」に変更）, `tests/guide.test.ts`

**Interfaces:**
- Route: `GET /api/export?site=&month=` → 認証（`requireProfile` 相当。協力会社は 403 JSON）→ `loadExportInput` → `buildExportPayload` → 32 件以上・上限超過は 400 JSON → `fillWorkbook` → Storage `gn-exports/<site_id>/<month>/<file_name>` に `upsert: true` で保存（失敗してもダウンロードは返し、`console.error`）→ `Content-Disposition: attachment; filename*=UTF-8''<encoded>` で返す。
- 画面 `/sites/[siteId]/export`：月の選択（日報のある月を新しい順に、既定は最新）、その月の件数と「行が雛形を超える日」の一覧（Task 6 まではその日の表名と件数を警告として表示し、出力ボタンを無効にする）、「Excel をダウンロード」（`<a href="/api/export?…" download>`）、過去に出力したファイルの一覧（署名 URL、有効 1 時間）。協力会社には「現場の担当者（社員）に依頼してください」。

- [ ] **Step 1: テスト** — `tests/export/route-guards.test.ts`：クエリ検証（uuid・月の形式）の純関数、`contentDispositionFileName('現場A_2026年11月.xlsm')` の RFC 5987 エンコード。`fill-client` はローカル経路を `python3` が無い環境でもテストできるよう、spawn を注入可能にして「stderr の JSON を日本語エラーに変換する」ことを検査。
- [ ] **Step 2: 実装** → **Step 3: ローカルで動作確認**（`npm run dev` でログインし、村山邸の 2026-11 を出力してファイルが開けること。Excel が無い環境では openpyxl で再読込）→ **Step 4: `npm test`・`npm run test:py`・tsc・lint・build** → **Step 5: コミット** `feat(export): Excel 出力の API・画面・Storage 保存と Vercel の Python 関数`

### Task 6: 行が足りない日の行挿入（§8.4）

**Files:**
- Create: `python/genba_export/insert_rows.py`, `python/tests/test_insert_rows.py`
- Modify: `python/genba_export/fill.py`（`rows_overflow` の代わりに挿入を呼ぶ）, `python/genba_export/layout.py`（表ごとの `total_row`・参照元の定義）, `src/components/export/ExportPanel.tsx`（警告を「行を追加して出力します」の案内に変更し、ボタンを有効化）

**Interfaces:**
- Produces: `insert_rows.expand_table(wb, sheet_name, table_key, extra: int)`。規則：
  1. 表の最終明細行の直下に `extra` 行を挿入（`ws.insert_rows`）。
  2. 挿入行に、直上の明細行の数式（相対参照の行番号を置換）・書式・結合（C:D など）・行の高さ・項番（A 列の連番）を複製。
  3. 合計行の `SUM(G27:G32)` などを広げる。
  4. 同じシート内で挿入位置より下を参照する数式（`G24`, `=I18`, `=G24`, `=G33`… の本日原価集計、`B70`, `K60`, `H69/J69`, `A71`…）の行番号を `extra` だけずらす。結合セル（A71:L74 など）と印刷範囲も同じ。
  5. 他シートの参照：月次集計（`'N回目'!F2, F3, B8:B17, I18, G24, G33, G42, G51, G58, J69, K60, B70`）、現場原価集計（`'31回目'!K60`）、出面一覧（`'N回目'!$F$2`）、集計データ（`'N回目'!B8..L17, B21..G23, B27..G32, B36.., B45..`）をずらす。作業員が 11 人以上のときは集計データにその回目の「労務」行を追加し、出面一覧と マスター!E36.. の `SUMIFS` 範囲（`$2:$1272`）を広げる。
  6. ずらしの実装は「シート名＋セル参照の正規表現置換」ではなく、`openpyxl.formula.translate.Translator` と自前の行番号写像（`old_row -> new_row`）で参照ごとに書き換える（`$F$2` のような絶対参照も対象、範囲 `B8:B17` は両端を写像）。

- [ ] **Step 1: テスト** — 作業員 12 人・車両 5 台の 1回目 で：(a) B8〜B19 に名前、I18 相当（合計行）が `=SUM(I8:I19)` になり行番号が 20、(b) 本日原価集計の `=I18` が `=I20`、(c) 月次集計 A4 の `'1回目'!I18` が `I20`、`C4` が `COUNTA('1回目'!B8:B19)`、(d) 集計データに 1回目 の労務行が 12 行、(e) 出面一覧の SUMIFS 範囲が広がっている、(f) 2回目 以降の参照は変わらない、(g) 結合 A71:L74 が A73:L76 になり印刷範囲が `A1:L82`。openpyxl の再読込で数式文字列を検査する（LibreOffice は無いので再計算はしない）。
- [ ] **Step 2: 失敗確認** → **Step 3: 実装** → **Step 4: 通過確認** → **Step 5: コミット** `feat(export): 行が足りない日は行を挿入して参照をずらす`

### Task 7: 利用者による Excel での確認と記録

**Files:**
- Modify: `docs/superpowers/plans/2026-10-30-phase1-record.md`（第2計画の記録）, `README.md`

- [ ] **Step 1:** 本番で 2026-11 を出力し、Excel で開く：マクロ有効で開けること、月次集計の労務費・本日原価がアプリの集計と一致すること、プルダウン（天候・作業員・車両・リース品）が動くこと、「＋ 行追加」ボタンが残っていること、作業員 11 人の日（テスト用に作る）で月次集計が正しいこと。
- [ ] **Step 2:** 不一致があれば記録して修正タスクに戻す。合格なら記録に「第2計画 完了」。

---

## 自己点検（計画作成時）
- §8.1：単位・ファイル名・再ダウンロード（Task 4・5）、31 件超の停止（Task 2・5）。§8.2：手順 1〜5（Task 1・2・3・6）。§8.3：対応表（上の表＝ V34 で L 列・D25〜D28 を追加。原本の E60/H60/B80〜K80 はそのまま）。§8.4：Task 6。§8.5：Task 1・4。§14：原本差分テスト（Task 1・3）、行挿入テスト（Task 6）。LibreOffice での再計算は環境に無いため、数式文字列の検査（Task 6）と利用者の Excel 確認（Task 7）で代える。
- §14 の「非同期ジョブ」：1 か月分は数秒で終わるため同期の Route Handler にする（60 秒上限）。遅い場合は後で非同期化する。
- 既知の制限（ガイドに書く）：マスターの日当は月初の日報時点の値（月途中で変わった行は J 列に値を書くので労務費は一致）。雛形の集計データが参照する備考は L 列（職種）なので、備考に職種を入れる運用は変わらない。
