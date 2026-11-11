# 現場管理台帳の書き出しの作り直し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場管理台帳を、V34 雛形への Python の書き込みから、アプリの計算から exceljs でいちから作る .xlsx（「現場原価集計」「出面一覧」の 2 シート）に置き換え、Python の書き出しの仕組みを消す。

**Architecture:** 1 段階・SQL なし。数字は工事原価集計表と同じ `loadCostReportInput` → `buildCostReport` → `costSections`。表を台帳の見た目で描く関数（合計は SUM の式＋計算済みの値）と、出面一覧の純関数を新しく作る。ルートは `/api/export` のまま中身を入れ替える。

**Tech Stack:** Next.js 16 App Router、React 19、Tailwind 4、exceljs 4.4、Vitest（node 環境）。

**Spec:** `docs/superpowers/specs/2026-11-11-ledger-export-design.md`（計画と食い違えば設計書が正）。見本：`.superpowers/brainstorm/24602-1794232833/content/ledger-1.html`。

## Global Constraints

- 「現場原価集計」の数字は、同じ期間の工事原価集計表（`buildCostReport`）と同じ。台帳のために別の計算を作らない。
- 出せるのは社員と管理者だけ。協力会社は出力画面が notFound、API は 403（今の `/api/export` と同じ。確認済み）。
- 合計の式は、データの最初の行〜最後の行の範囲の SUM（SUMIF・COUNT）。計算済みの値（exceljs の `{ formula, result }`）も入れる。値はアプリの計算した合計。
- 見た目：紺 `FF1F3864`（見出し・白字・太字）、水色 `FFD9E1F2`（表の題の帯）、土 `FFDBEAFE`・日 `FFFEE2E2`、字体 メイリオ（Meiryo）、罫線は細線。「現場原価集計」A4 横・横 1 ページ、「出面一覧」A3 横・横 1 ページ、どちらも見出しを固定。
- `templates/` は触らない。SQL なし。コミットの末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の指示で。

## Review Focus

- 〇〇様邸の例で、原価 215,000・外注 170,000・出来高 215,000・総人工 2.0（うち請負 1.0）が、両方のシートと工事原価集計表で一致すること（Task 3 のテスト）。
- `sumColumns` を付けた列は、合計の値が行の値（書いた数値）の和と一致すること（Task 1 のテスト。違う列に印を付けると落ちる）。
- 名前なしの行・請負の行が出面一覧から落ちないこと。区分ごとに行が分かれること（Task 2）。
- 協力会社で 403、Python を消した後も `npm test`・`npx tsc --noEmit`・`npm run lint`・`npm run build` が通ること（Task 4・5）。

## 例（〇〇様邸、2026-11-10 の 1 日。テストの固定データ `tests/reports/ledger-fixture.ts`）

- 労務：自社 Ｓさん 1.0 人工・20,000 円。〇〇工務店（協力会社）の名前なし 3 名・計 1.0 人工・請負（労務費は原価に数えない）。
- 燃料：手入力の車両 5,000 円。買掛（仕入）20,000 円。買掛（外注）〇〇工務店 タイル 170,000 円（件なし）。
- 作業内容：とび・土工 清掃 20,000 円、タイル【増】25,000 円（増の件）。
- 期待：原価 215,000（労務 20,000＋燃料 5,000＋買掛 190,000）、外注 170,000、出来高 215,000、総人工 2.0、うち請負 1.0。
  （作り手は数字の内訳を変えてよいが、この 5 つの合計は守る。既存の `tests/reports/cost-fixture.ts` の作り方に合わせる。）

---

### Task 1: 表に「足し算の列」の印を付ける（cost-sections）

**Files:**
- Modify: `src/lib/reports/cost-sections.ts`（`SectionTable` に `sumColumns?: number[]` を足し、①〜⑦の合計の行で、行の値の和になっている列に付ける）
- Test: `tests/reports/cost-sections-sum.test.ts`（新規）

**Interfaces:**
- Produces: `SectionTable.sumColumns?: number[]`（列の添字。合計の行のその列が数値のセルのときだけ意味を持つ。PDF・CSV・既存の Excel は使わない）。
- 目安：① 金額／③ 日報件数・労務費・車両費・リース費・現金購入・買掛・原価合計・出来高（累計原価・進捗率は付けない）／④ 出勤日数・人工・残業H・労務費／④-2 構成比以外の数値の列（請負金額・差額は合計が数値のときだけ）／⑤ 3 列／⑥ 車両の 2 列・リースのリース費／⑦ 投入人工・出来高。構成比は付けない。

- [x] **Step 1: テスト**：`sampleModel()`（工期全体と月）と Task 3 の例のモデルで、すべての表の `sumColumns` の列について「合計の値 ＝ 行の値の和」（`cellNumber` で書く数値で比べる。差 0）。構成比・進捗率・累計原価の列には印が無い。
- [x] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4:** `npm test`・`npx tsc --noEmit`
- [x] **Step 5: コミット** `feat(reports): 工事原価集計表の表に合計が足し算の列の印を付ける`

### Task 2: 出面一覧の純関数

**Files:**
- Create: `src/lib/reports/ledger-attendance.ts`
- Test: `tests/reports/ledger-attendance.test.ts`

**Interfaces:**
- Consumes: `CostReportInput`（`reports[].lines` の労務の行：`workerId`・`workerName`・`affiliation`・`supplierId`・`laborContract`・`headcount`・`stored.manDays`）、`CostReportPeriod`。
- Produces: `buildLedgerAttendance(input: CostReportInput, period: CostReportPeriod): LedgerAttendanceMonth[]`
  - `LedgerAttendanceMonth = { month: 'YYYY-MM'; days: string[]［その月の 1 日〜末日］; rows: LedgerAttendanceRow[]; dayTotals: Record<string, number>; ukeoiDayTotals: Record<string, number>; manDays: number; ukeoiManDays: number }`
  - `LedgerAttendanceRow = { name: string; affiliationLabel: string; kind: '自社' | '常用' | '請負'; unnamed: boolean; byDate: Record<string, { manDays: number; headcount: number }>; manDays: number; workDays: number }`
- 決まり：行は 作業員（id、無ければ名前）× 所属 × 区分。区分は所属が協力会社なら `laborContract`（null は常用）、自社・所属なしは「自社」。名前なしは `laborDisplayName`（「〇〇工務店（名前なし）」）。並びは 自社 → 協力会社（名前順）→ 所属なし、その中は名前順。月は期間の中で日報のある月だけ（工期全体なら全部の月、月なら 1 つ）。繰越初期値は入れない。人工は 2 桁に丸める（`attendance()` と同じ）。所属の名前は `affiliationLabel`（`src/lib/calc/affiliation.ts`）。

- [x] **Step 1: テスト**：例の日で 2 行（Ｓさん 自社 1.0、〇〇工務店（名前なし） 請負 1.0・3 名）、合計 2.0・うち請負 1.0。同じ人が常用の日と請負の日 → 2 行。2 か月の日報 → 月が 2 つ、days はその月の全日。月の期間 → その月だけ。労務の行が無い月は出さない。
- [x] **Step 2〜4:** 失敗を確認 → 実装 → test・tsc
- [x] **Step 5: コミット** `feat(reports): 現場管理台帳の出面一覧（作業員 × 日付、区分つき）`

### Task 3: 台帳の Excel を作る（2 シート）

**Files:**
- Create: `src/lib/reports/ledger-xlsx.ts`、`tests/reports/ledger-fixture.ts`、`tests/reports/ledger-xlsx.test.ts`
- Modify: `src/lib/reports/query.ts`（`ledgerFileName(siteName, period, outputDate)` を足す。既存の `periodFileName` を使い、題は「現場管理台帳」、拡張子 xlsx）

**Interfaces:**
- Consumes: `CostReportModel`（`buildCostReport`）、`costSections`・`headerRows`・`footerText`・`cellNumber`・`NO_REPORTS`（cost-sections）、Task 1 の `sumColumns`、Task 2 の `buildLedgerAttendance`。
- Produces: `LEDGER_SHEET_NAMES = ['現場原価集計', '出面一覧'] as const`、`buildLedgerXlsx(model: CostReportModel, attendance: LedgerAttendanceMonth[]): Promise<Buffer>`、`writeLedgerTable(ws, t: SectionTable): void`（列見出し＝紺・白字、合計の行の `sumColumns` の列は `{ formula: 'SUM(C8:C12)', result }`、ほかは値）。
- 「現場原価集計」：1 行目 題「現場原価集計　{現場名}」、続けて `headerRows` の見出し、各セクションの題を水色の帯（表の幅いっぱいを結合）、表。日報が無ければ「日報がありません」。最後に署名欄（工事原価集計表の Excel と同じ）。脚注は `footerText`・ページ番号。1〜2 行目を固定。
- 「出面一覧」：月ごとに 題の行「出面一覧　{現場名}　2026年11月」→ 列見出し（作業員・所属・区分・日付［「11/10」と曜日の 2 段でも 1 段でもよい］・人工計・出勤日数）→ 行 → 「日ごとの合計」（各日の SUM、人工計の列は SUM）→「うち請負」（`SUMIF(区分の範囲,"請負",その日の範囲)`）→ 空行。人工計＝`SUM(その行の日のセル)`、出勤日数＝`COUNT(…)`。名前なしの行の日のセルは表示の書式 `0.0"（3名）"`（人数はその日の値）。土日の列は見出しとセルに色。A〜C 列と 1 行目を固定。最後に注記「繰越初期値は含みません（現場原価集計の ④ には含みます）」。月が無ければ「出面がありません」。

- [x] **Step 1: テスト**（exceljs で読み直して確かめる）：
  - シート名と順が `['現場原価集計', '出面一覧']`。
  - 例のモデル：「原価合計」の行の金額が `formula` が `SUM(...)` で `result` 215,000、式の範囲がその表の最初〜最後のデータの行。⑦ の「タイル（外注・〇〇工務店）」170,000、⑦ 合計の出来高 `result` 215,000。② の総人工 2.0、累計出来高 215,000。
  - すべての SUM の式について、範囲のセルの値の和 ＝ `result`（式を自前で足して比べる）。
  - 出面一覧：Ｓさん（自社）・〇〇工務店（名前なし）（請負）の 2 行、11/10 の列の日ごとの合計 `result` 2.0、うち請負 `result` 1.0、人工計の列の合計 2.0、名前なしのセルの numFmt に「3名」。土曜・日曜の列のセルに色。
  - 見た目：列見出しの塗り `FF1F3864`・白字、表の題の帯 `FFD9E1F2`、字体 Meiryo、印刷 A4 横（`paperSize 9`・`landscape`・`fitToWidth 1`）／A3 横（`paperSize 8`）、`views` に固定（`state: 'frozen'`）。
  - 日報が無いモデルでも作れる（「日報がありません」「出面がありません」）。
  - 協力会社の名前が `=` で始まっても文字のセルのまま（式にならない）。
- [x] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4:** test・tsc・lint
- [x] **Step 5: コミット** `feat(reports): 現場管理台帳の Excel（現場原価集計・出面一覧）`

### Task 4: ルートと出力画面を入れ替える

**Files:**
- Modify: `src/app/api/export/route.ts`（全部書き直し：`parseCostQuery` と同じ形で `site`・`period` を読む［format は無い。`parseLedgerQuery` を `src/lib/reports/query.ts` に足す］→ ログインなし 401・協力会社 403・現場なし／削除済み 404 → `loadCostReportInput` と `getSettings` → `buildCostReport`（`now` は工事原価集計表と同じ）→ `buildLedgerAttendance` → `buildLedgerXlsx` → .xlsx（`contentDisposition(ledgerFileName(...))`、`Cache-Control: no-store`）。Storage への控えの保存は消す）
- Modify: `src/app/(app)/sites/[siteId]/export/page.tsx`（`loadExportInput`・`buildExportPayload`・`overflowNotice` を使わず、`listReportHeads` から日報のある月と件数だけを作る）、`src/components/export/ExportPanel.tsx`（上の「出力する月」と xlsm の節を、工事原価集計表と同じ「集計期間」の選択＋「Excel をダウンロード」1 つの「現場管理台帳（Excel）」の節に。`ExportMonthOption.notice` を消す）
- Test: `tests/reports/query.test.ts` に `parseLedgerQuery`・`ledgerFileName`。協力会社の判定は今の route のまま（403 の文も同じ）。

- [x] **Step 1〜4:** テスト → 失敗を確認 → 実装 → test・tsc・lint・build
- [x] **Step 5: コミット** `feat(export): 現場管理台帳をアプリで作る Excel に置き換える`

### Task 5: Python の書き出しを消す・ガイドと README

**Files:**
- Delete: `api/export/fill.py`（`api/` ごと）、`vercel.json`、`requirements.txt`、`python/`（`genba_export/`・`run_fill.py`・`tests/`）、`src/lib/export/fill-client.ts`・`payload.ts`・`types.ts`、`tests/export/fill-client.test.ts`・`payload.test.ts`
- Create: `src/lib/export/file-name.ts`（`fileNameStem` を `payload.ts` から移す。使う所：`src/lib/reports/query.ts`、`src/lib/budget/template-format.ts`・`report-xlsx.ts`、`src/app/api/budget/pdf/route.ts`）
- Modify: `src/lib/export/query.ts`（`MONTH_RE`・`contentDisposition` だけ残す）、`tests/export/query.test.ts`（消した関数の分を消す）、`src/lib/db/export.ts`（`loadExportInput`・`loadMonthReports` と `ExportInput` の import を消す。`loadProfileNames`・`fetchReportLineRows` は残す）、`src/lib/db/summary.ts`（`labor: 'stored'` を消す）、`src/lib/import/day-sheet.ts`（コメントの Python の行を消す）、`tests/import/day-sheet.test.ts`（「DAY_LAYOUT は Python の layout.py と同じ位置」を消す）、`package.json`（`test:py`）、`.env.example`（`GN_EXPORT_SECRET`・`GN_EXPORT_FILL_URL`）、README（技術の表・ディレクトリ・「Excel 出力（Vercel の Python 関数）」の章・コマンドの表。代わりに 2 行で新しい台帳を書く。Vercel の環境変数は消してよいこと）
- Modify（ガイド）：`src/content/guide/excel.md`（「現場管理台帳（原本 Excel）」の節を新しい形に：2 シートの中身、集計期間、出せない月が無くなったこと、合計は式、1 日ごとは日報の PDF、ファイル名の表）、`src/content/guide/index.md`（一覧の文）、`src/content/guide/input.md`（手入力・名前なしの「現場管理台帳（Excel 出力）では…」の文を新しい形に）、`src/content/guide/pdf.md`（「台帳 Excel の出力だけは雛形の式で労務費を出す…」を消し、台帳も同じ決まりと書く）、`src/content/guide/setup.md`（マスターの取り込みは以前の台帳ファイルから。新しい台帳にはマスターのシートが無い）
- Modify（記録）：`docs/superpowers/plans/2026-10-30-phase1-record.md`

- [x] **Step 1:** 消す・移す（`grep -rn "lib/export/payload\|fill-client\|export/types\|genba_export\|run_fill\|GN_EXPORT\|xlsm\|原本 Excel" src tests README.md package.json` で残りが無いこと。日報・マスターの取り込みの `.xlsm` は残る）
- [x] **Step 2:** ガイドを直す（`tests/guide.test.ts` が通ること）
- [x] **Step 3:** `npm test`・`npx tsc --noEmit`・`npm run lint`・`npm run build`
- [x] **Step 4: コミット** `refactor(export): Python の台帳の書き出しを消す、ガイドを新しい台帳に`

**区切り：** 最終レビュー → 利用者が出力画面で 1 現場を書き出し、工事原価集計表の PDF と数字を見比べる → push（SQL なし）。デプロイ後、Vercel の `GN_EXPORT_SECRET`・`GN_EXPORT_FILL_URL` は消してよい。
