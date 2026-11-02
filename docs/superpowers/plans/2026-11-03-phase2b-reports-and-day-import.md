# 第2計画（改）：帳票出力（原価集計表・日報の PDF／Excel／CSV）と 1 日分雛形の取り込み 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場の「出力」画面から、(1) 現場全体（着工〜竣工、または月）の工事原価集計表を PDF・Excel・CSV で、(2) 日報を 1 日分または 1 か月分の PDF と CSV で出せる。(3) 原本 V34 を埋めた月次 Excel（第2計画 Task 1〜4 の成果）も同じ画面からダウンロードできる。(4) PC で入力した「1 日分の追加用雛形」をアプリに取り込める。(5) 日報でマスターに無い作業員・取引先を手入力できる。(6) 追加・変更・減を作業内容の行に区分と根拠（指示者・方法・日付・件）付きで記録し、実績原価の積み上げから提案金額を出す「変更増減 精算資料（案）」を PDF・Excel で出せる。契約金額が未確定の現場（概算）も扱え、日報 PDF に客先確認欄を持つ。

**Architecture:** 帳票のデータは純関数 `src/lib/reports/*.ts` が既存の集計（`src/lib/calc/aggregate.ts`）から組み立てる（`ReportModel`）。PDF は `@react-pdf/renderer`（Node、フォントは Noto Sans JP を同梱）、Excel は `exceljs`（数式なしの xlsx。書式あり）、CSV は UTF-8（BOM 付き）。配信は Route Handler `/api/reports/*`。原本 Excel は既存の `python/genba_export` を Vercel の Python 関数で呼ぶ（第2計画 Task 5 の最小版。行挿入は行わず、超過時は案内）。取り込みはマスター取り込みと同じ「端末で読む → 確認画面 → 保存」で、保存は既存の `saveReport`（`gn_save_report`）を使う。

**Tech Stack:** Next.js 16 Route Handler、`@react-pdf/renderer@4.9`、`exceljs@4.4`、`xlsx`（SheetJS 0.20.3、既存）、Python 3.12（Vercel）/ openpyxl（既存）、Vitest、unittest。

**Spec:** `docs/superpowers/specs/2026-10-30-genba-nippou-design.md` §7（集計）、§8（Excel）、§10（PDF）、§11、§13（取り込み）、§14。帳票の見た目は利用者が了承したデザイン案（claude.ai の「工事原価集計表 デザイン案」。本計画の「原価集計表の構成」に転記）。第2計画 `2026-11-03-phase2-excel-export.md` の Task 1〜4 は完了済み（Python 側と payload）。同計画の Task 5〜7 は本計画の Task 1・Task 8 に置き換える（行挿入 Task 6 は中止）。

## Global Constraints
- 出力できるのは社員と管理者（協力会社は不可）。削除済みの現場は不可。完了現場は可。
- 帳票の金額は保存値（`cost_total`・`output_total`・明細の `amount`・`man_days`・`overtime_hours`）だけから計算する。画面で再計算しない（アプリ内の集計画面と同じ数字になる）。
- ファイル名：原価集計表 `現場名_工事原価集計表_YYYYMMDD.pdf|xlsx|csv`（期間が月のときは `現場名_工事原価集計表_YYYY年MM月.…`）、日報 `現場名_日報_YYYY-MM-DD.pdf|csv`、月まとめ `現場名_日報_YYYY年MM月.pdf|csv`、原本 Excel `現場名_YYYY年MM月.xlsm`。禁止文字は `_` に置換（既存 `exportFileName` と同じ規則）。
- CSV は UTF-8 BOM 付き、改行 CRLF、値は必要なときだけ `"` で囲む（Excel でそのまま開ける）。文字コードの選択肢は付けない。
- PDF は A4 縦、余白 15mm、本文 9〜10pt、Noto Sans JP（Regular/Bold を `public/fonts/` に同梱。ライセンス表記 `public/fonts/OFL.txt`）。表はページをまたいでよいが、行の途中で切れない。
- Route Handler は `GET /api/reports/cost?site=&period=all|YYYY-MM&format=pdf|xlsx|csv`、`GET /api/reports/daily?site=&date=YYYY-MM-DD&format=pdf|csv`、`GET /api/reports/daily?site=&month=YYYY-MM&format=pdf|csv`、`GET /api/export?site=&month=YYYY-MM`（原本 Excel）。失敗は JSON `{ ok:false, error }`（400/403/404/500）。`Content-Disposition` は RFC 5987。
- 取り込みの保存は既存の権限と規則のまま（`saveReport` → RLS・トリガー）。承認済み・完了現場は取り込めない（既存のエラー文言を使う）。
- UI は日本語、375px、44px。Server Action は `{ ok, … } | { ok:false, error }`。
- 原本 Excel の Python 関数：`api/export/fill.py`、秘密は `GN_EXPORT_SECRET`、呼び先は `GN_EXPORT_FILL_URL`（未設定なら `https://${VERCEL_PROJECT_PRODUCTION_URL}/api/export/fill`）、ローカルは `python3 python/run_fill.py`。

## Review Focus
- 日報 0 件の現場・月で各出力が空の帳票（エラーでなく「日報がありません」の 1 行）を返すこと（Task 2・4・5）。
- 繰越初期値（`gn_carryovers`）が作業員別累計に入り、`beforeDate` 以前の日報が二重に数えられないこと（既存 `workerCumulative` と同じ。Task 2 のテスト）。
- 月指定の原価集計表で「累計原価・進捗率」はその月末までの累計、「原価合計・出来高」はその月だけ、になること（Task 2）。
- 取り込みで、同じ日付の日報がすでにあるときに黙って上書きしないこと（確認画面で「上書き」を選ばせる。承認済みなら不可）（Task 7）。
- 手入力の作業員の行が、集計・CSV・原本 Excel（J 列に値）で正しく扱われること（Task 6・Task 2・既存 payload）。

---

## 原価集計表の構成（PDF・Excel・CSV 共通の `CostReportModel`）

1. 見出し：現場名、客先名、工事番号、請負の種類、工事概要、工期（着工予定〜竣工予定、経過日数＝着工〜出力日または完了日）、現場状態、日報件数と承認件数、集計期間、出力日時。
2. ① 原価合計：労務費／車両費（燃料）／リース費／現金購入費／買掛費／原価合計、構成比。
3. ② 採算：工事総請負金額、総原価、粗利益、粗利率、累計出来高、進捗率（出来高÷請負）、総人工、1 人工あたり原価、1 日あたり原価。
4. ③ 月別推移：年月、日報件数、5 費目、原価合計、出来高、累計原価、進捗率、合計行。期間が月のときは週ごと（月曜始まり）に置き換える。
5. ④ 作業員別累計：作業員名、職種、出勤日数、人工、残業 H、労務費、合計行。繰越初期値を含む。手入力の作業員は名前に「（手入力）」。
6. ⑤ 取引先別累計：取引先名、現金購入、買掛、合計。手入力の仕入先・購入先は名前で集計。
7. ⑥ 車両・リース：車両ごとの走行距離・燃料費、リース品ごとの数量合計・リース費。
8. ⑦ 工種別出来高：工種、主な施工内容（最頻の施工内容）、施工数量（単位が 1 種類なら合計、混在なら「—」）、投入人工、歩掛、出来高、構成比、合計行。
9. 署名欄（作成者＝出力した人、確認者・承認者は空欄）、脚注「現場日報アプリ ― 日報 N 件（承認済み M 件）から自動集計 出力日時 ページ番号」。

CSV は「1 ファイルに全部」ではなく、セクションごとに空行で区切った 1 ファイル（1 行目にセクション名）。Excel は 1 シートにセクションを縦に並べ、見出し太字・金額は `#,##0`・比率は `0.0%`・列幅固定。

## 日報の構成（PDF・CSV 共通の `DailyReportModel`）

雛形の日報シートと同じ順：見出し（現場名・工事番号・日付・当月 N 回目／通算 M 回目・天候・作業責任者・共通時間）、作業員（名前・開始・終了・休憩・中抜・実働・人工・残業 H・日当・労務費・備考）、車両、リース、現金購入、買掛、本日原価集計（5 費目と合計）、本日出来高と進捗率、作業内容（工種・施工内容・数量・単位・投入人工・歩掛・単価・金額）、重要事項（本文＋件の一覧と状態）、連絡事項、作成者・確認者・承認者・承認日。CSV は「明細 1 行 1 レコード」：列 `日付, 回目(当月), 通算, 種別, 名前, 規格, 単位, 数量, 単価, 金額, 開始, 終了, 休憩分, 中抜分, 実働H, 人工, 残業H, 取引先, 工種, 施工内容, 備考`。月まとめ CSV は同じ列で全日分。

---

### Task 1: 出力画面と原本 Excel のダウンロード（第2計画 Task 5 の最小版）

**Files:**
- Create: `api/export/fill.py`, `vercel.json`, `src/lib/export/fill-client.ts`, `src/app/api/export/route.ts`, `src/app/(app)/sites/[siteId]/export/page.tsx`, `src/components/export/ExportPanel.tsx`, `src/lib/export/query.ts`（純関数：クエリ検証・Content-Disposition）, `tests/export/query.test.ts`, `tests/export/fill-client.test.ts`
- Modify: `src/app/(app)/sites/[siteId]/page.tsx`（「出力」リンク）, `.env.example`（`GN_EXPORT_SECRET`）, `README.md`（Vercel の環境変数と Python 関数、ローカルの python3）

**Interfaces:**
- Consumes: `loadExportInput` / `buildExportPayload` / `exportFileName`（`src/lib/export/*`、完了済み）、`python/run_fill.py`。
- Produces: `fillWorkbook(payload): Promise<Buffer>`（本番 fetch／ローカル spawn。`FillError { code, message }`）、`parseExportQuery(url): { siteId, month } | { error }`、`contentDisposition(fileName): string`、画面 `/sites/[siteId]/export`：月の選択（日報のある月、新しい順）、「原本 Excel（.xlsm）をダウンロード」、超過警告の表示（`warnings` に `rows_overflow` / `too_many_*` があればボタンを無効にして「この月は原本 Excel では出せません（{日付} の {表} が {n} 行）。PDF／CSV をご利用ください」）、Task 2 以降のボタンの置き場（この時点では「準備中」）。
- `api/export/fill.py`：POST、`X-Export-Secret` 一致確認、本文 JSON → `fill_workbook`（テンプレート `templates/現場管理台帳_V34_原本.xlsm`）→ `application/vnd.ms-excel.sheet.macroEnabled.12`。失敗は 400/500 JSON `{code, message}`。`vercel.json`：`{"functions": {"api/export/fill.py": {"maxDuration": 60, "includeFiles": "{templates/現場管理台帳_V34_原本.xlsm,python/**}"}}}`。
- Route `/api/export`：`requireProfile` 相当 → 協力会社 403 → `loadExportInput` → `buildExportPayload` → 超過なら 400 → `fillWorkbook` → Storage `gn-exports/<site_id>/<month>/<file>`（upsert、失敗は console.error で続行）→ 添付で返す。

- [ ] **Step 1: テスト**（`parseExportQuery` の uuid／月形式、`contentDisposition('現場A_2026年11月.xlsm')` が `attachment; filename="export.xlsm"; filename*=UTF-8''%E7%8F%BE...` 形式、`fillWorkbook` の spawn を注入して stderr JSON → `FillError` 変換）
- [ ] **Step 2: 実装 → Step 3: `npm test`・tsc・lint・build → Step 4: ローカルで `npm run dev` から実際に xlsm をダウンロードできる（ログインが要るので実装者はルートの単体確認まで。画面確認は利用者）→ Step 5: コミット** `feat(export): 出力画面と原本 Excel のダウンロード（Vercel Python 関数）`

### Task 2: 原価集計表のデータ組み立て（純関数）

**Files:**
- Create: `src/lib/reports/cost-model.ts`, `src/lib/reports/types.ts`, `src/lib/db/reports-data.ts`（server-only：現場・設定・全日報の見出し＋明細・繰越・マスター名を読む。`loadSummaryData` と `loadMonthReports` を再利用）, `tests/reports/cost-model.test.ts`

**Interfaces:**
- Produces: `buildCostReport(input: CostReportInput, period: { kind: 'all' } | { kind: 'month'; month: string }, now: { date: string; by: string }): CostReportModel`（上の「構成」の 1〜9 を数値で持つ。文字列の整形はしない）。`CostReportInput { site, settings?, reports: ReportWithLines[], carryovers, workers, suppliers, vehicles, leaseItems }`。
- 規則：月別推移は `monthlyRows`／`sumRows`、作業員別は `workerCumulative`（繰越込み）、取引先別は現金・買掛行の `vendor`（取引先参照があればマスター名）で集計、工種別は作業内容行を `trade` で集計（歩掛＝数量合計÷人工合計、単位が混在なら数量は null）。経過日数は `start_date`（無ければ最初の日報日）〜 完了なら最後の日報日、進行中なら出力日。

- [ ] **Step 1: テスト**（日報 0 件、繰越込みの作業員累計と `beforeDate` の除外、月指定の「その月だけ／月末までの累計」、工種別の単位混在、手入力の作業員・仕入先、構成比の合計が 100%）
- [ ] **Step 2: 実装 → Step 3: `npm test` → Step 4: コミット** `feat(reports): 工事原価集計表のデータ組み立て`

### Task 3: 原価集計表の PDF・Excel・CSV と Route

**Files:**
- Create: `src/lib/pdf/fonts.ts`（`Font.register` を 1 回だけ。`public/fonts/NotoSansJP-Regular.ttf`, `NotoSansJP-Bold.ttf`, `OFL.txt`）, `src/lib/pdf/cost-report.tsx`（`@react-pdf/renderer` の Document。見た目はデザイン案：濃紺 `#1f3a5f` の見出し、罫線 `#c9d1dc`、見出し帯 `#eef2f7`、数字は右寄せ）, `src/lib/reports/cost-xlsx.ts`（exceljs）, `src/lib/reports/cost-csv.ts`（純関数）, `src/lib/reports/csv.ts`（`toCsv(rows: (string|number|null)[][]): string` BOM・CRLF・引用）, `src/app/api/reports/cost/route.ts`, `tests/reports/csv.test.ts`, `tests/reports/cost-csv.test.ts`, `tests/reports/cost-pdf.test.ts`（`renderToBuffer` が `%PDF` で始まるバッファを返す。フォント登録が効いていること）
- Modify: `next.config.ts`（`outputFileTracingIncludes` に `/api/reports/*` → `./public/fonts/**`）, `package.json`（`@react-pdf/renderer`, `exceljs`）, `src/components/export/ExportPanel.tsx`（「工事原価集計表」：期間＝工期全体／月、3 つのボタン）

**Interfaces:**
- Produces: `renderCostPdf(model): Promise<Buffer>`、`buildCostXlsx(model): Promise<Buffer>`、`buildCostCsv(model): string`。Route は Task 1 の `parse…`／`contentDisposition` と同じ流儀。

- [ ] **Step 1: テスト（csv の引用規則、cost-csv のセクション、pdf のバッファ） → Step 2: 実装 → Step 3: `npm test`・build（react-pdf は Node ランタイム。Route に `export const runtime = 'nodejs'`） → Step 4: コミット** `feat(reports): 工事原価集計表の PDF・Excel・CSV`

### Task 4: 日報のデータ組み立てと CSV

**Files:**
- Create: `src/lib/reports/daily-model.ts`, `src/lib/reports/daily-csv.ts`, `tests/reports/daily-model.test.ts`, `tests/reports/daily-csv.test.ts`

**Interfaces:**
- Produces: `buildDailyReport(input: { site, report: ReportDetail, heads: ReportHead[], issues: Issue[], names: ProfileNames, settings }): DailyReportModel`（当月 N 回目／通算 M 回目は `visitNumbers`）、`buildDailyCsv(models: DailyReportModel[]): string`（上の列）。

- [ ] **Step 1: テスト → Step 2: 実装 → Step 3: `npm test` → Step 4: コミット** `feat(reports): 日報のデータ組み立てと CSV`

### Task 5: 日報の PDF（1 日・月まとめ）と Route、画面

**Files:**
- Create: `src/lib/pdf/daily-report.tsx`（1 日 1〜2 ページ。雛形の日報の並び。月まとめは日ごとに改ページ）, `src/app/api/reports/daily/route.ts`, `tests/reports/daily-pdf.test.ts`
- Modify: `src/components/export/ExportPanel.tsx`（「日報」：日付または月を選んで PDF／CSV）, `src/app/(app)/sites/[siteId]/reports/[date]/page.tsx`（日報画面の上部に「PDF」「CSV」の小さなリンク。閲覧専用でも使える）

- [ ] **Step 1: テスト → Step 2: 実装 → Step 3: `npm test`・build → Step 4: コミット** `feat(reports): 日報の PDF と CSV の出力`

### Task 6: 飛び込みの作業員・取引先の手入力

**Files:**
- Modify: `src/components/report/tables/LaborTable.tsx`（作業員の選択肢末尾に「（手入力）」。選ぶと氏名欄と日当欄（円）が同じ行に出る。`workerId: null, workerName, dailyRate, overtimeRate: null`）, `src/components/report/tables/PurchaseTable.tsx`（買掛の仕入先：選択肢末尾「（手入力）」で `supplierId: null, vendor` の自由入力。現金は現状のまま）, `src/lib/report/snapshots.ts`（参照の無い行は触らない：既存どおり）, `src/content/guide/input.md`（「マスターに無い人・取引先を入れるとき」）, `tests/report/*.test.ts`（手入力行の正規化・保存行）

- [ ] **Step 1: テスト → Step 2: 実装 → Step 3: `npm test`・tsc・lint → Step 4: コミット** `feat(report): マスターに無い作業員・仕入先を手入力できるようにする`

### Task 7: 1 日分雛形の取り込み

**Files:**
- Create: `src/lib/import/day-sheet.ts`（純関数：`parseDaySheet(grid: unknown[][], layout): DaySheetParse`。雛形 `templates/現場管理日報_1日追加用_雛形.xlsm` の「1回目」の位置は Python の `layout.py` と同じ値を TypeScript の定数 `DAY_LAYOUT` に写す。入力セルだけ読む：F2〜F4、B6〜E6、作業員 B8〜F17・L8〜L17、車両 B21〜E23・H、リース B27〜E32・H、現金 B36〜F41・H、買掛 B45〜F50・H、E60・H60、作業内容 B63〜I68、A71、A76。J 列（日当）の**計算済みの値**（SheetJS の `raw` 値）は、作業員名がマスターに無い行の日当に使う）, `src/lib/import/day-sheet-to-input.ts`（`toSaveInput(parse, siteId, date, masters): { input: SaveInput; notes: string[] }`：名前→`workerId`（前後空白除去の完全一致、同名複数は手入力扱い＋注記）、車両・リース・取引先も同様）, `src/components/report/ImportDaySheet.tsx`（日報画面の「Excel から取り込む」ボタン → ファイル選択 → 確認画面（読み取った行の一覧と注記、既存の日報があれば「上書き」の確認、承認済み／完了現場なら不可）→ 既存の保存処理（フォームの状態に流し込んで「保存」を押させる方式：保存前に見直せる））, `tests/import/day-sheet.test.ts`（実ファイルを `xlsx` で読んで入力セルが空であること、手で作った grid で各表が読めること、名前の突合、日付の扱い（F2 が無ければ画面の日付））
- Modify: `src/content/guide/input.md`（取り込みの章）

**Interfaces:**
- Consumes: 既存の `ReportForm` の状態更新（`fromInput` 相当。フォームの `initial` を差し替える props か、`setState` を公開する最小の口を 1 つ足す）、`SaveInput`／`reportInputSchema`。

- [ ] **Step 1: テスト → Step 2: 実装 → Step 3: `npm test`・tsc・lint・build → Step 4: コミット** `feat(import): 1 日分の雛形（Excel）から日報を取り込む`

### Task 8: 記録・ガイド・利用者確認

- [ ] `src/content/guide/excel.md`・`pdf.md` を本文に置き換え（出力画面の使い方、原本 Excel の制限、PDF/CSV）。`src/lib/guide.ts` の章名。
- [ ] `docs/superpowers/plans/2026-10-30-phase1-record.md` に第2計画（改）の記録。README に `GN_EXPORT_SECRET`・`supabase/update_2026-11-03d_profile_names.sql`・フォントのライセンス。
- [ ] 本番で利用者が確認：原価集計表 3 形式、日報 PDF/CSV、原本 Excel（11 月）、雛形の取り込み（1 日分）、手入力の作業員。

### Task 9: 追加・変更・減の記録（DB と型）

利用者の要望（2026-11-03）：契約金額が固まらない現場や下請け現場で、追加・変更・減を日報から判断して客先と交渉できるようにする。

**Files:**
- Create: `supabase/update_2026-11-04_change_tracking.sql`（差分。`schema_genba.sql` にも反映。`npm run check:sql`）
- Modify: `src/lib/types.ts`, `src/lib/report/{schema,rows}.ts`, `src/lib/db/{reports,reports-actions,sites,sites-actions,sites-schemas,settings,settings-schemas,settings-actions}.ts`, `tests/report/*.test.ts`, `tests/db/*.test.ts`

**DB の変更（すべて `add column if not exists`）：**
- `gn_report_lines`（作業内容行 `kind='work'` で使う）：`change_kind text check (change_kind in ('contract','extra','change','minus'))`（既定 `'contract'`。既存の `source='extra'` は `'extra'` に移行）、`instructed_by text`（指示者）、`instruction_method text check (… in ('oral','phone','email','document','other'))`、`instructed_on date`、`issue_id uuid references public.gn_report_issues(id) on delete set null`（根拠の件）。
- `gn_report_issues`：`kind text check (kind in ('extra','change','minus','client_delay','rework','other'))`（既定 `'other'`）、`instructed_by text`、`instruction_method text`（同じ選択肢）、`amount_estimate numeric`（金額見込み）。
- `gn_sites`：`contract_status text check (… in ('fixed','tentative'))` 既定 `'fixed'`、`estimated_amount numeric`（概算・見積提示額。未確定のとき使う）。
- `gn_settings`：`overhead_rate numeric not null default 0.15`（追加分の提案金額に掛ける経費率）、`profit_rate numeric not null default 0.10`（利益率）。
- `gn_daily_reports`：`client_confirmed_by text`（客先確認者名）、`client_confirmed_at timestamptz`、`client_confirmed_note text`。確認の記録は現場メンバーなら誰でも入れられる（ガードは既存どおり）。
- `gn_save_report` の明細 insert に新列を追加。`gn_report_lines_compute` は変更なし。

**型・保存：** `WorkLine` に `changeKind`, `instructedBy`, `instructionMethod`, `instructedOn`, `issueId`；`Issue` に `kind`, `instructedBy`, `instructionMethod`, `amountEstimate`；`Site` に `contractStatus`, `estimatedAmount`；`Settings.rule` と並べて `rates: { overheadRate, profitRate }`；日報の見出しに `clientConfirmedBy/At/Note`。ラベル：区分＝契約内／追加／変更／減、指示方法＝口頭／電話／メール／書面／その他、件の種別＝追加指示／仕様変更／減／客先都合（手待ち・待機）／やり直し／その他。

- [ ] **Step 1: テスト（Zod：区分と指示方法の値、金額 ≥ 0、既存の下書きに項目が無くても通る）→ Step 2: SQL と型・保存 → Step 3: `npm run check:sql`・`npm test`・tsc → Step 4: コミット** `feat(db): 追加・変更・減の記録（区分・指示者・根拠）と契約状態・経費率・客先確認の列`

### Task 10: 入力画面（作業内容の区分と根拠、件の種別、契約状態、経費率）

**Files:**
- Modify: `src/components/report/tables/WorkTable.tsx`（各行に「区分」セレクト。追加／変更／減のときだけ 指示者・指示方法・指示日・根拠の件（その現場の対応中＋この日報の件から選ぶ）が同じ行の下に開く）, `src/components/report/IssueBanner.tsx` と件の追加フォーム（種別・指示者・指示方法・金額見込み）, `src/components/sites/SiteForm.tsx`（契約状態：確定／未確定、未確定のとき概算金額）, `src/components/masters/SettingsPanel.tsx`（経費率・利益率）, `src/components/report/ReportSummary.tsx`（本日の追加・変更・減の金額を 1 行表示）, `src/content/guide/input.md`

- [ ] **Step 1: テスト（行の正規化・保存行に新列が入る）→ Step 2: 実装 → Step 3: `npm test`・tsc・lint・build → Step 4: コミット** `feat(report): 作業内容の区分と指示の根拠、件の種別、契約状態、経費率を入力できるようにする`

### Task 11: 変更増減のデータ組み立て（純関数）と採算の扱い

**Files:**
- Create: `src/lib/reports/change-model.ts`, `tests/reports/change-model.test.ts`
- Modify: `src/lib/reports/cost-model.ts`（契約未確定の現場：進捗率＝累計原価 ÷ 概算金額、採算欄は「概算に対する見込み」と注記。② に「追加・変更・減の提案額」を 1 行追加）, `src/lib/calc/aggregate.ts`（必要なら）

**Interfaces:**
- Produces: `buildChangeLedger(input, settings): ChangeLedgerModel`：
  - 一覧：追加・変更・減の作業内容行を日付順に。各行＝日付・回目・工種・施工内容・数量・単位・単価・金額（入力の施工単価×数量）・投入人工・指示者・指示方法・指示日・根拠の件（番号・種別・本文の先頭 40 字）・客先確認（あり／なし）。
  - 実績原価の積み上げ：その行の投入人工 × その日の平均日当（その日の労務費 ÷ その日の人工）＋ その日の材料・リース・燃料のうち、作業内容行の人工比で按分した額（按分の規則は 1 か所に書き、テストで固定）。提案金額＝実績原価 ×（1＋経費率）×（1＋利益率）、円未満切り上げ。入力の施工単価×数量 があればそれも並記（「申告額」）。
  - 集計：追加の件数・申告額合計・実績原価合計・提案額合計、変更、減（減は数量・金額を負で）、精算提案額＝当初見積（概算）＋追加＋変更−減。

- [ ] **Step 1: テスト（区分ごとの集計、按分、丸め、根拠の件の紐づけ、客先確認の有無）→ Step 2: 実装 → Step 3: `npm test` → Step 4: コミット** `feat(reports): 追加・変更・減の一覧と実績原価の積み上げ`

### Task 12: 帳票「変更増減 精算資料（案）」PDF・Excel

**Files:**
- Create: `src/lib/pdf/change-ledger.tsx`, `src/lib/reports/change-xlsx.ts`, `src/app/api/reports/changes/route.ts`（`?site=&period=all|YYYY-MM&format=pdf|xlsx`）, `tests/reports/change-pdf.test.ts`
- Modify: `src/components/export/ExportPanel.tsx`（「変更増減 精算資料」ボタン）

**構成：** 1 ページ目：宛先（客先名 ＋「御中」）、件名「追加・変更工事 精算のご提案（案）」、現場名・工事番号・期間、サマリー表（当初見積／契約内出来高／追加（件数・申告額・提案額）／変更／減／精算提案額）、注記（提案額の計算式＝実績原価×(1＋経費率)×(1＋利益率)）。2 ページ目以降：明細一覧（Task 11 の一覧）。末尾：会社名・担当者・連絡先（設定に `company_name`, `company_contact` を持たせる。無ければ空欄）、客先確認欄。ロゴは `public/logo.png` を左上に。

- [ ] **Step 1: テスト → Step 2: 実装 → Step 3: `npm test`・build → Step 4: コミット** `feat(reports): 変更増減 精算資料（案）の PDF・Excel`

### Task 13: 日報 PDF の客先確認欄とアプリの確認記録

**Files:**
- Modify: `src/lib/pdf/daily-report.tsx`（末尾に「客先確認」欄：確認者名・日付・サイン欄。追加・変更・減の行がある日は、その行を太字にし「本日の追加・変更」小計を出す）, `src/components/report/ReportForm.tsx`（提出後・承認後でも入れられる「客先確認を記録」ダイアログ：確認者名・日時（既定＝今）・メモ。Server Action `recordClientConfirmation(reportId, …)`）, `src/lib/db/reports-actions.ts`, `src/content/guide/approval.md`

- [ ] **Step 1: テスト（Action の検証）→ Step 2: 実装 → Step 3: `npm test`・tsc・lint・build → Step 4: コミット** `feat(report): 日報 PDF の客先確認欄と確認の記録`

---

## 自己点検
- §7・§8.1・§10・§13 の該当範囲を Task 1〜7 で覆う。§8.4（行挿入）は中止し、超過は案内（Task 1）。§14 の PDF テストは「バッファが PDF であること」までで、見た目は利用者確認（Task 8）。
- 型の整合：`CostReportModel`／`DailyReportModel`（Task 2・4）を PDF・Excel・CSV（Task 3・5）が消費。`DAY_LAYOUT`（Task 7）は Python の `layout.py` と同じ値（テストで `python/genba_export/layout.py` から抜いた数字と突き合わせる）。
- Task 9〜13（追加・変更・減）は Task 1〜8 の後に行う。Task 9 の SQL は Task 1 より前に適用しても害はない。
- 既知の制限：原本 Excel は 31 件超・行数超過の月は出せない。PDF の見た目はデザイン案に合わせるが、フォントの行間などは実機で微調整。
