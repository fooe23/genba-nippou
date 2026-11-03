# 追加・変更の件ごとの精算（見込み額と確定額）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重要事項の件に精算の方法（未定／一式／常用）・確定額・常用単価・確定日を持たせ、現場ごとの「追加・変更の一覧」画面で入力でき、精算資料（PDF・Excel）と原価集計表 ② が確定額を優先した「精算額」で出る。客先向けの精算資料から実績原価を外し、PDF にプレビューを付ける。

**Architecture:** DB は `gn_report_issues` に 4 列、`gn_sites` に 1 列を足すだけ（RLS・ガード不変、社員・管理者の制限は Server Action）。精算額の計算は `src/lib/reports/change-model.ts` の純関数に集約し、`ChangeLedgerModel` に件ごとの精算（`issues`）と区分ごとの精算額（`summary[kind].settled`）を足す。帳票は `change-sections.ts` の共有テーブル定義を変える（PDF・Excel は追従）。一覧画面は Server Component ＋ 行ごとの Client フォーム。プレビューは Route のクエリ `disposition=inline` で `Content-Disposition` を切り替える。

**Tech Stack:** Next.js 16 Route Handler / Server Action、Zod 4、Supabase（plpgsql）、@react-pdf/renderer 4.9、exceljs 4.4、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-04-issue-settlement-design.md`（決めたこと・私の判断・利用者の回答はすべてここ。計画と食い違えば設計書が正）。

## Global Constraints
- 精算の方法：`'undecided' | 'lump_sum' | 'daily_rate'`（既定 undecided）。確定額・常用単価は `>= 0`。一式は確定額必須、常用は単価必須。確定日は date（任意）。
- 件の種別 → 精算の区分：extra→extra、increase→increase、change→change、minus→minus、client_delay→extra、other→extra、rework→数えない（参考表示）。
- 精算額：未定＝紐づく行の提案額の合計、一式＝確定額、常用＝ceil(紐づく行の人工合計 × 単価)。減の区分は負。一式・常用の件に紐づく行の提案額は数えない。
- 精算資料に載せる件：方法が一式・常用、または期間末までに追加・増・変更・減の行が紐づく件。未定で行の無い件は載せない。
- 月指定：一式の件は件の日報日 ≤ 月末なら数える。常用・未定は月末までの行で計算。サマリーの精算額列は「精算額（累計）」。件数・申告額・提案額はその月だけ（既存どおり）。
- 客先向け精算資料（PDF・Excel）に実績原価を出さない（明細一覧の列・件ごとの表とも）。社内の一覧画面には出す。
- PDF の Route は `disposition=inline` のときだけ `Content-Disposition: inline`、それ以外は attachment（既存）。ファイル名の規則は既存のまま。
- 一覧画面 `/sites/[siteId]/changes`：社員・管理者のみ（協力会社は 404）、削除済みは 404、完了現場は閲覧のみ。UI は日本語、375px、44px。Server Action は `{ ok } | { ok:false, error }`。
- 帳票の金額は保存値だけ（確定額・単価・人工は DB の値）。SQL は `npm run check:sql`、`schema_genba.sql` にも反映、何度実行しても安全。

## Review Focus
- 減の件に一式で確定額を正で入れたとき、精算額が負で合計から引かれること（Task 2 のテスト）。
- 一式の件に紐づく行が 追加 と 減 の混在でも、行の提案額は数えず確定額だけになること（Task 2）。
- 月指定で、9 月に登録した件を 12 月に一式で確定したとき、9 月の資料に確定額が出ること（Task 2）。
- 常用の件の人工が 0 のとき精算額 0、単価が無い常用の件は保存で拒否されること（Task 1・2）。
- 完了現場・協力会社では一覧画面の保存が拒否され、画面もボタンを出さないこと（Task 3）。

---

### Task 1: DB・型・検証・Server Action（件の精算の項目、現場の常用単価の既定）

**Files:**
- Create: `supabase/update_2026-11-05_issue_settlement.sql`, `tests/db/issue-settlement-schemas.test.ts`
- Modify: `supabase/schema_genba.sql`（gn_report_issues・gn_sites の add column）, `src/lib/types.ts`（`SettlementMethod`）, `src/lib/report/change-labels.ts`（`SETTLEMENT_METHODS`, `SETTLEMENT_METHOD_LABELS = { undecided:'未定', lump_sum:'一式', daily_rate:'常用' }`, `settlementCategory(kind: IssueKind): ChangeLedgerKind | null`）, `src/lib/db/reports.ts`（`Issue` に `settlementMethod, fixedAmount, dailyRate, fixedOn`；`ISSUE_COLUMNS`・`toIssue`）, `src/lib/db/issue-schemas.ts`（`issueSettlementSchema`）, `src/lib/db/reports-actions.ts`（`updateIssueSettlement`）, `src/lib/db/sites.ts`・`sites-schemas.ts`・`sites-actions.ts`（`Site.defaultDailyRate`, `default_daily_rate`）, `src/components/sites/SiteForm.tsx`（「常用単価の既定（客先請求・円／人工）」）, `src/lib/reports/types.ts`（`DailyReportInput`等で `Issue` を使う箇所の型追従のみ）, `tests/db/sites-schemas.test.ts`, `tests/reports/*fixture*.ts`（`Issue` リテラルに新フィールドの既定を足す）, `README.md`（SQL の一覧と順序）

**Interfaces:**
- Produces: `type SettlementMethod = 'undecided' | 'lump_sum' | 'daily_rate'`；`Issue.settlementMethod: SettlementMethod; fixedAmount: number | null; dailyRate: number | null; fixedOn: string | null`；`Site.defaultDailyRate: number | null`；`settlementCategory(kind)`（上の対応表、rework は null）；`issueSettlementSchema = z.object({ settlementMethod, fixedAmount, dailyRate, fixedOn })` with refinements（lump_sum→fixedAmount 必須「一式のときは確定額を入力してください」、daily_rate→dailyRate 必須「常用のときは常用単価を入力してください」、金額 ≥ 0、日付 YYYY-MM-DD）；`updateIssueSettlement(issueId: string, input: IssueSettlementInput): Promise<{ ok: true } | { ok: false; error: string }>`（requireProfile → partner は「協力会社は精算の項目を変更できません」→ Zod → update 4 列 → `stateErrorMessage`（site_closed は既存文言）→ `revalidatePath`）。
- SQL：`alter table public.gn_report_issues add column if not exists settlement_method text not null default 'undecided' check (settlement_method in ('undecided','lump_sum','daily_rate'))`, `fixed_amount numeric check (fixed_amount >= 0)`, `daily_rate numeric check (daily_rate >= 0)`, `fixed_on date`；`alter table public.gn_sites add column if not exists default_daily_rate numeric check (default_daily_rate >= 0)`。

- [ ] **Step 1: テスト**（`issueSettlementSchema`：未定で金額なし OK、一式で確定額なし NG（文言）、常用で単価なし NG、負の額 NG、'2026-02-30' NG；`settlementCategory` の 7 種別；`siteInputSchema.defaultDailyRate` ≥ 0 nullable optional）
- [ ] **Step 2: 実行して失敗を確認** `npx vitest run tests/db/issue-settlement-schemas.test.ts`
- [ ] **Step 3: SQL（両ファイル）・型・ラベル・スキーマ・Action・Site・SiteForm を実装**
- [ ] **Step 4: `npm run check:sql`・`npm test`・`npx tsc --noEmit`・`npm run lint`・`npm run build`**
- [ ] **Step 5: コミット** `feat(db): 件の精算の方法・確定額・常用単価・確定日と現場の常用単価の既定`

### Task 2: 精算額のモデル（件ごとの精算、区分ごとの精算額、② の精算額）

**Files:**
- Modify: `src/lib/reports/types.ts`（`ChangeIssueSettlement`, `ChangeLedgerModel.issues`, `.unlinked`, `ChangeKindSummary.settled`, `settlement` のコメント）, `src/lib/reports/change-model.ts`（`settleIssues`, `summarize` に settled, `isEmpty`）, `src/lib/reports/cost-model.ts`（② `changeProposal` を精算額に）, `src/lib/reports/cost-sections.ts`（② 行ラベル「追加・増・変更・減の精算額（円）」）
- Test: `tests/reports/change-model.test.ts`, `tests/reports/cost-model.test.ts`, `tests/reports/cost-fixture.ts`（件に精算の項目を持つ fixture）

**Interfaces:**
- Produces: `interface ChangeIssueSettlement { id; reportDate; kind: IssueKind; bodyHead: string; instructedBy: string | null; amountEstimate: number | null; settlementMethod; fixedAmount; dailyRate; fixedOn; category: ChangeLedgerKind | null; lineCount: number; manDays: number; actualCost: number; proposal: number; settled: number; settledBasis: 'fixed' | 'daily_rate' | 'proposal'; countsToward: boolean }`；`ChangeLedgerModel.issues: ChangeIssueSettlement[]`（日付順）；`ChangeLedgerModel.unlinked: { lineCount; manDays; actualCost; proposal }`（件に紐づかない追加等の行、期間末までの累計）；`ChangeKindSummary.settled: number`；`settlement.extra/increase/change/minus/proposed` は settled で計算；`export function settleIssue(issue: Issue, linkedRows: ChangeLedgerRow[]): Pick<ChangeIssueSettlement, 'settled' | 'settledBasis' | 'countsToward' | 'category'>`（純関数、ここだけに規則を書く）。
- 規則：linkedRows は期間末までの行。lump_sum → settled = fixedAmount（category が minus なら −）、basis 'fixed'；daily_rate → ceil(Σ manDays × dailyRate)（minus なら −）、basis 'daily_rate'；undecided → Σ rows.proposal、basis 'proposal'。countsToward = category !== null。載せる件 = method ≠ undecided または linkedRows.length > 0；一式の件は issue.reportDate ≤ 期間末のときだけ。`summary[kind].settled` = Σ settled（countsToward かつ category=kind）＋ Σ unlinked rows（kind）の proposal。`isEmpty` = 期間の行 0 かつ issues 0。
- `cost-model.ts`：`profit.changeProposal` = ledger.settlement.extra+increase+change+minus（null は既存どおり rows も issues も無いとき）。

- [ ] **Step 1: テスト**（未定／一式／常用の精算額、減の一式が負、混在行の一式は確定額だけ、やり直しは countsToward false で合計に入らない、客先都合は追加に入る、月指定：9 月の件を 12 月に一式確定 → 9 月の資料に出る／10 月登録の一式は 9 月に出ない、常用は月末までの人工、行の無い一式の件は lineCount 0、未定で行なしは載らない、unlinked、② が settlement と一致）
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: `npm test`・tsc** → **Step 5: コミット** `feat(reports): 件ごとの精算額（未定・一式・常用）と区分ごとの精算額`

### Task 3: 「追加・変更の一覧」画面と入口

**Files:**
- Create: `src/app/(app)/sites/[siteId]/changes/page.tsx`, `src/components/changes/ChangesTable.tsx`（一覧。行ごとに `IssueSettlementRow`）, `src/components/changes/IssueSettlementRow.tsx`（client：精算方法 select、確定額／常用単価（方法に応じて片方）、確定日、保存ボタン、結果表示）, `src/lib/db/changes-data.ts`（server-only：`loadChangesPage(site)` → `loadCostReportInput` + `getSettings` + `buildChangeLedger(all)` から件ごとの行と、未定で行の無い件も含めた全件リスト）
- Modify: `src/app/(app)/sites/[siteId]/page.tsx`（「追加・変更」リンクを「出力」の隣に。協力会社には出さない）, `src/components/export/ExportPanel.tsx`（精算資料の欄に「追加・変更の一覧で確定額を入れる」リンク）

**Interfaces:**
- Consumes: Task 1 の `updateIssueSettlement`・`Site.defaultDailyRate`、Task 2 の `ChangeLedgerModel.issues`。
- 画面の列：日付（日報へのリンク）・種別・本文・指示者/方法・見込み額・精算方法・確定額 or 常用単価（初期値＝件の値、無ければ現場の既定）・確定日・紐づく行数・人工・実績原価（社内のみ）・提案額・精算額（やり直しは「（参考）」）。合計行（精算額）。完了現場は入力を disabled に。375px では行を縦積み。

- [ ] **Step 1: テスト**（`changes-data` の純粋部分があれば；無ければ Zod/Action のテストは Task 1 で済み。ページは DOM テスト不可）→ **Step 2: 実装** → **Step 3: tsc・lint・build** → **Step 4: コミット** `feat(changes): 現場ごとの「追加・変更の一覧」画面で件の精算を入力できるようにする`

### Task 4: 精算資料（PDF・Excel）：件ごとの精算表、精算額、実績原価の非表示

**Files:**
- Modify: `src/lib/reports/change-sections.ts`（`changeSummary` に「精算額」列（月なら「精算額（累計）」）と注記、新 `changeIssues(model): SectionTable`（件・種別・見込み額・精算方法・確定額 or 「常用 N 人工 × 単価」・確定日・行数・人工・提案額・精算額、やり直しは「（参考）」、最後に「件なし」の行、合計行）、`changeDetail` から実績原価の列を外す）, `src/lib/pdf/change-ledger.tsx`（サマリーの下に「件ごとの精算」）, `src/lib/reports/change-xlsx.ts`（同じ表）, `src/content/guide/pdf.md`（精算資料の見方を更新）
- Test: `tests/reports/change-sections.test.ts`（精算額列、件表の行、実績原価が無い、減が負、やり直しの参考表示）, `tests/reports/change-pdf.test.ts`・`change-xlsx.test.ts`（件表が出る、実績原価の見出しが無い）

- [ ] **Step 1: テスト** → **Step 2: 実装** → **Step 3: `npm test`・build、見本 PDF をスクラッチに出力** → **Step 4: コミット** `feat(reports): 精算資料に件ごとの精算表と精算額を出し、実績原価を客先向けから外す`

### Task 5: PDF のプレビュー（inline）

**Files:**
- Modify: `src/lib/export/query.ts`（`contentDisposition(fileName, opts?: { inline?: boolean })`）, `src/lib/reports/query.ts`（`parseCostQuery`／`parseDailyQuery`／`parseChangesQuery` が `disposition: 'inline' | 'attachment'` を返す。`disposition=inline` 以外は attachment）, `src/app/api/reports/{cost,daily,changes}/route.ts`（PDF のときだけ inline を許す。xlsx/csv は常に attachment）, `src/components/export/ExportPanel.tsx`（PDF を「プレビュー」「ダウンロード」の 2 ボタンに。プレビューは `target="_blank"`）, `src/components/report/ReportForm.tsx`・`src/app/(app)/sites/[siteId]/reports/[date]/page.tsx`（日報の「PDF」をプレビュー、「PDF 保存」をダウンロードに）, `src/content/guide/excel.md`
- Test: `tests/reports/query.test.ts`（disposition の解釈）, `tests/export/query.test.ts`（inline の Content-Disposition）

- [ ] **Step 1: テスト** → **Step 2: 実装** → **Step 3: tsc・lint・build** → **Step 4: コミット** `feat(reports): PDF のプレビュー（ブラウザ表示）とダウンロードを分ける`

### Task 6: ガイドと記録

**Files:**
- Create: `src/content/guide/changes.md`「追加・変更の精算」（指示を受けた日にすること／見積が出たらすること（一覧画面）／3 つの精算方法と計算／種別ごとの数え方（客先都合・その他は追加、やり直しは参考）／精算資料の読み方（見込み→確定、件なし、月指定の累計、実績原価は出ない）／PDF のプレビュー／よくある迷い（追加と増、常用の単価は件ごと、減の入れ方））
- Modify: `src/lib/guide.ts`（`{ slug: 'changes', title: '追加・変更の精算' }` を pdf の次に）, `src/content/guide/input.md`（「金額の確定はあとで一覧画面で」）, `setup.md`（現場の常用単価の既定）, `index.md`（章一覧）, `README.md`（画面・Route・SQL の順序：05 を 04d の後に）, `docs/superpowers/plans/2026-10-30-phase1-record.md`（本計画の記録）
- Test: `tests/guide.test.ts`（新章の存在）

- [ ] **Step 1: 実装** → **Step 2: `npm test`・lint** → **Step 3: コミット** `docs(guide): 追加・変更の精算の章と関連の更新`

---

## 自己点検
- 設計書の各項目 → Task：精算の方法・データ（1）、入力の場所（3）、精算資料と ②（2・4）、月指定・載せる件（2）、実績原価の非表示（4）、プレビュー（5）、ガイド（6）、現場の常用単価の既定（1・3）。
- 型の整合：`SettlementMethod`・`Issue` の 4 項目（1）→ `settleIssue`・`ChangeIssueSettlement`（2）→ 一覧（3）・帳票（4）。`settlementCategory` は 1 で定義し 2 が使う。
- Review Focus の 5 件はそれぞれ Task 1・2・3 のテストに載せた。
