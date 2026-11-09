# 積算連携（元請けの内訳・実行予算・実績・進み具合）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場ごとに元請けの内訳と実行予算（工種 × 施工者）を持ち、日報の作業内容の行の工種から実績を集め、工種ごとに内訳の金額・実行予算・実績・進み具合・見込みを画面と Excel で見られるようにする。

**Architecture:** 3 段階で作り、段階ごとに SQL 差分 1 本・push できる単位にする。第 1 段階＝データと入れ方（画面・Excel 雛形の取り込みと書き出し）、第 2 段階＝日報の工種の選択・読み替え表・集計の純関数・予算と実績の画面・進み具合の上書き、第 3 段階＝文字 PDF の内訳の読み取りと集計 Excel（7 シート）。集計は既存の原価集計（`cost-model.ts`）と所属別の割り振り（`affiliation-breakdown.ts`）の流儀に沿った純関数にする。

**Tech Stack:** Next.js 16 App Router、React 19、Tailwind 4、Supabase（Postgres RLS・plpgsql）、Zod 4、exceljs（書き出し）、既存の Excel 読み取り（`src/lib/import/parse-sheet.ts` の流儀）、pdfjs-dist 5.4.624（PDF のテキスト抽出。既に入っている）、Vitest（node 環境）。

**Spec:** `docs/superpowers/specs/2026-11-09-budget-vs-actual-design.md`（末尾の「設計の確認で出た問いへの答え」と「協力会社の人工の工種への振り分け」を含む。計画と食い違えば設計書が正）。見本：`.superpowers/brainstorm/24602-1794232833/content/budget-1.html`（画面）・`excel-1.html`（雛形と書き出し）。

## Global Constraints

- 金額（内訳・予算・実績・見込み）を見られるのは社員と管理者だけ。協力会社のアカウントは画面・API・Excel・DB（RLS）のどこからも金額を読めない。工種の名前だけは読める（日報で選ぶため）。
- 進み具合の % を上書きできるのは、管理者と、その現場の確認・承認の人（`gn_site_role in ('reviewer','approver')`）。職長は日報に数量を入れるだけ。
- 日報の入力で増えるのは「工種を実行予算の工種から選ぶ」ことだけ。自由入力の工種の欄は残し、選ぶと名前が入る。
- 材料・リース・燃料・その他は現場全体でまとめる（工種に分けない）。
- 協力会社の人工の振り分け：その会社を施工者に入れた工種が 1 つならそこへ全部、2 つ以上ならその日の作業内容の行の投入人工の比（それらの工種の中で）、どこにも入れていない会社はその日の作業内容の行の投入人工の比。自社と所属なしはその日の作業内容の行の投入人工の比。その日に工種の付いた行が無ければ「予算外」。
- 工種の決め方（行ごと）：行の工種の参照 → 無ければ現場の読み替え表（工種の文字 → 工種）→ 無ければ予算外。日報の行は書き換えない。
- 取り込み直し：工種は名前で突き合わせ。実行予算の行は全部入れ替え。日報・読み替え表で使われている工種は Excel に無くても残し、知らせる。元請けの内訳は「全部入れ替える」か「変更の行として足す」を選ぶ。
- 元請けの内訳の「経費」「減分」は工種に入れず、内訳の金額の合計にだけ数える。
- 数量からの進み具合＝日報のその工種の施工数量の合計 ÷ その工種の内訳の行（当初＋変更）のうち単位が同じ行の数量の合計。単位が合わなければ「数量から」は出さない。見込み＝実績 ÷ 進み具合（上書きがあればそれ、無ければ数量から）。見込みの粗利＝内訳の金額 − 見込み。
- 文字 PDF だけ（画像の PDF は対象外）。読み取りはブラウザで、取り込み前に確認・修正の画面を通す。
- SQL：段階ごとに差分ファイル（`begin/commit`、何度実行しても安全）＋ `schema_genba.sql` に反映（新規環境の順番）＋ `verify_rls_auto.sql` に検査。Postgres の列の自動 check 名（`<表>_<列>_check`）と名前付き制約を重ねない（`npm run check:sql` は見逃す）。SQL をデータベースに対して実行しない。利用者が SQL Editor で実行してからデプロイ。
- UI は日本語、375px、44px。帳票の金額は保存値だけ。コミットの末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の指示で。

## Review Focus

- 同じ日に自社と協力会社が別の工種をしたとき、協力会社の労務費が協力会社を入れた工種にだけ入り、合計が日の労務費と一致すること（Task 4 のテスト）。
- 予算を書き出して Excel で直さずに取り込み直すと、中身がまったく同じになること（Task 2 のテスト）。
- 日報で使っている工種を Excel から消して取り込んでも、その工種と過去の実績が消えないこと（Task 2 のテスト）。
- 協力会社のアカウントで、内訳・予算の表を直接読めない・予算と実績の画面と Excel の API に入れないこと（Task 1 の verify と Task 5 のテスト）。
- 単位が「式」だけの工種、内訳の数量が 0 の工種、進み具合 0 % の工種で、見込みの計算が 0 除算にならず「—」になること（Task 4 のテスト）。

---

## 第 1 段階：データと入れ方

### Task 1: DB・型・読み書き（工種・元請けの内訳・実行予算・読み替え表・進み具合の上書き）

**Files:**
- Create: `supabase/update_2026-11-15_budget.sql`、`src/lib/budget/types.ts`、`src/lib/budget/schemas.ts`、`src/lib/db/budget.ts`（読み込み）、`src/lib/db/budget-actions.ts`
- Modify: `supabase/schema_genba.sql`、`supabase/verify_rls_auto.sql`、`gn_save_report` と行の読み書き（`src/lib/report/rows.ts`・`schema.ts`・`src/lib/types.ts` の `WorkLine` に `siteTradeId: string | null`）
- Test: `tests/budget/schemas.test.ts`、`tests/report/rows.test.ts`

**Interfaces:**
- DB（名前は作り手が決めてよいが、以下の意味を守る）：
  - `gn_site_trades(id, site_id, name text［現場内で一意］, sort_order, created_at)` — 工種。読み：現場メンバー（協力会社も）。書き：社員・管理者、完了現場は不可。
  - `gn_contract_items(id, site_id, section 'initial'|'change', name, spec, qty numeric, unit, unit_price numeric, amount numeric, trade_id null, category 'trade'|'expense'|'reduction', sort_order)` — 元請けの内訳。category='trade' のときだけ trade_id を持つ。読み書き：社員・管理者だけ。
  - `gn_budget_lines(id, site_id, trade_id null［null＝現場全体］, performer 'own'|'partner', supplier_id null, item 'labor'|'subcontract'|'jouyou'|'material'|'lease'|'other', note, qty numeric, unit, unit_price numeric, amount numeric, sort_order)` — 実行予算。材料・リース・その他は trade_id null だけ。労務は performer own、請負・常用は partner（supplier_id 必須、協力会社の印のある会社）。読み書き：社員・管理者だけ。
  - `gn_trade_aliases(site_id, trade_text, trade_id, primary key(site_id, trade_text))` — 読み替え表。読み：現場メンバー。書き：社員・管理者。
  - `gn_trade_progress(id, site_id, trade_id, percent numeric［0〜100］, set_by, set_at)` — 進み具合の上書きの履歴（最新が有効）。読み：社員・管理者。書き：管理者か、その現場の確認・承認の人（DB で判定）。
  - `gn_report_lines.site_trade_id uuid null references gn_site_trades(id)`（作業内容の行だけ）。`gn_save_report` に列を足す（他は変えない）。工種の削除は、日報の行・読み替え表・予算から参照されていれば断る（`trade_in_use`）。
- Produces（TS）：`SiteTrade = { id, name, sortOrder }`、`ContractItem`、`BudgetLine`、`TradeAlias`、`TradeProgress`（types.ts）。読み込み `loadBudgetData(siteId): Promise<BudgetData>`（`BudgetData = { trades, contractItems, budgetLines, aliases, progress }`、社員・管理者以外が呼べば空）。Action：`saveTrades(siteId, trades)`、`replaceBudgetLines(siteId, lines)`、`replaceContractItems(siteId, items, mode: 'replace' | 'appendChange')`、`setTradeAlias(siteId, tradeText, tradeId | null)`、`setTradeProgress(siteId, tradeId, percent | null)`。

- [ ] **Step 1: テスト**：スキーマ（工種名 1〜50 文字・現場内で重複不可、予算行の組み合わせ［材料等は現場全体だけ、請負・常用は協力会社必須、労務は自社］、金額＝数量 × 単価の丸めを 1 円単位で四捨五入、percent 0〜100）。行の往復で `siteTradeId` が残る。
- [ ] **Step 2: 失敗を確認** → **Step 3: SQL**（verify：協力会社は内訳・予算・上書きを読めない／工種と読み替え表は読める、担当（staff）は % を上書きできない・確認者はできる、使用中の工種は消せない、完了現場は書けない）→ `npm run check:sql`
- [ ] **Step 4: 実装** → **Step 5:** `npm test`・`npx tsc --noEmit`・`npm run lint`
- [ ] **Step 6: コミット** `feat(db): 積算連携の工種・元請けの内訳・実行予算・読み替え表・進み具合`

### Task 2: 実行予算と元請けの内訳の画面・Excel 雛形の取り込みと書き出し

**Files:**
- Create: `src/app/(app)/sites/[siteId]/budget/setup/page.tsx`（社員・管理者だけ。協力会社は notFound）、`src/components/budget/TradesEditor.tsx`、`BudgetLinesEditor.tsx`（工種ごとのまとまりの下に施工者の行を足す・消す、現場全体の行）、`ContractItemsEditor.tsx`（行の追加・工種の識別の選択）、`src/lib/budget/template-xlsx.ts`（exceljs：シート「実行予算」「元請けの内訳」「選択肢」、プルダウン、見本の行は入れない）、`src/lib/budget/parse-template.ts`（取り込み。既存の `parse-sheet.ts` の流儀）、`src/lib/budget/import-diff.ts`（取り込み前の差分：足す工種・残す工種・入れ替える予算・内訳）、`src/app/api/budget/template/route.ts`（書き出し：いまの予算・内訳入りの雛形、または空の雛形）、`src/components/budget/ImportDialog.tsx`（ファイル選択 → 差分の確認 → 取り込み）
- Modify: 現場の画面に「予算と実績」「実行予算・内訳」への導線（社員・管理者だけ）、ガイド（新しい章 `budget.md`）
- Test: `tests/budget/template-roundtrip.test.ts`、`tests/budget/import-diff.test.ts`

**Interfaces:**
- Consumes: Task 1 の型と Action。
- Produces: `buildBudgetWorkbook(data: BudgetData, site: { name; code; dailyRate }): Promise<Buffer>`、`parseBudgetWorkbook(buf: ArrayBuffer): { trades: string[]; budgetLines: ParsedBudgetLine[]; contractItems: ParsedContractItem[]; errors: { sheet; row; message }[] }`、`diffImport(current: BudgetData, parsed, mode): ImportDiff`（`ImportDiff = { addTrades: string[]; keptMissingTrades: string[]; removeTrades: string[]; budgetLinesCount: number; contractItemsCount: number }`）。

- [ ] **Step 1: テスト**：書き出し → 取り込みで `BudgetData` の工種・予算行・内訳行が同じ（id を除く）。日報で使っている工種が Excel に無い → `keptMissingTrades` に入り消えない。Excel の新しい名前 → `addTrades`。施工者の協力会社名がマスターの協力会社（is_partner）と一致しない行 → errors。項目と施工者の組み合わせの誤り → errors（行番号つき）。
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**（画面は見本 `excel-1.html` の列と同じ並び。直接入れても取り込んでも同じ Action を通す）→ **Step 4:** test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(budget): 実行予算と元請けの内訳の画面、Excel 雛形の取り込みと書き出し`

**第 1 段階の区切り：** 最終レビュー → SQL（`update_2026-11-15_budget.sql`）を利用者が実行 → push。

---

## 第 2 段階：日報の工種・集計・予算と実績の画面

### Task 3: 日報の工種の選択と読み替え表

**Files:**
- Modify: `src/components/report/tables/WorkTable.tsx`（現場に工種があれば、工種の欄を「工種を選ぶ（＋手入力）」に。選ぶと `siteTradeId` と `trade`（名前）を入れる。手入力に戻すと `siteTradeId` を null）、`src/lib/report/form-props.ts`（現場の工種を読む）、`src/lib/import/day-sheet-to-input.ts`（工種の文字を読み替え表と工種名で `siteTradeId` に）
- Create: `src/components/budget/AliasMapper.tsx`（「まだ割り当てていない工種の文字」の一覧と工種の選択。予算と実績の画面に置く）、`src/lib/budget/resolve-trade.ts`
- Test: `tests/budget/resolve-trade.test.ts`

**Interfaces:**
- Produces: `resolveTradeId(line: { siteTradeId: string | null; trade: string }, aliases: Map<string, string>, tradesByName: Map<string, string>): string | null`（順：参照 → 読み替え表［前後の空白を除いた文字で］→ 工種名と完全一致 → null）。`unmappedTradeTexts(lines, aliases, tradesByName): { text: string; lineCount: number; manDays: number }[]`。

- [ ] **Step 1: テスト**：参照がある行は参照、無ければ読み替え、無ければ名前一致、どれも無ければ null。空の工種は null。未割り当ての一覧は人工の多い順。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(report): 日報の工種を実行予算の工種から選ぶ、工種の読み替え表`

### Task 4: 予算と実績の集計（純関数）

**Files:**
- Create: `src/lib/budget/budget-model.ts`、`tests/budget/budget-model.test.ts`、`tests/budget/fixture-nakano.ts`（中野橋の数字に近い小さな例）
- Modify: `src/lib/db/budget.ts`（集計の入力を読む：現場の全日報の行［写し済みの所属・日当・金額］、設定日当）

**Interfaces:**
- Consumes: Task 1 の `BudgetData`、Task 3 の `resolveTradeId`。
- Produces: `buildBudgetModel(input: BudgetModelInput): BudgetModel`。
  - `BudgetModelInput = { data: BudgetData; reports: { date: string; lines: ReportLine[] }[]; dailyRate: number; asOf: string }`
  - `BudgetModel = { trades: TradeRow[]; outside: OutsideRow; siteWide: SiteWideRow; total: TotalRow }`
  - `TradeRow = { tradeId; name; contractAmount; budget: { amount; manDays; byPerformer: PerformerRow[] }; actual: { amount; manDays; byPerformer: PerformerRow[]; qty: number | null; unit: string | null }; progress: { used: number | null; fromQty: number | null; override: number | null }; forecast: number | null; forecastProfit: number | null; status: 'ok' | 'overBudget' | 'loss' | 'none'; days: TradeDay[] }`
  - `PerformerRow = { performer: 'own' | 'partner'; supplierId: string | null; name: string; budgetAmount: number; budgetManDays: number | null; actualAmount: number; actualManDays: number; partnerContract: number | null }`
  - `OutsideRow`＝工種の付かない人工・労務費（予算外の作業）。`SiteWideRow`＝材料・リース・燃料・その他の予算と実績（既存の行の合計）、内訳の経費の金額。
- 判定：見込み ≤ 実行予算 → 'ok'、見込み > 実行予算 かつ ≤ 内訳の金額 → 'overBudget'、見込み > 内訳の金額 → 'loss'、進み具合が無い・0 → 'none'（見込み・粗利は null）。

- [ ] **Step 1: テスト**（中野橋の例）：
  - 自社がブラスト、〇〇塗装（塗装に入れた協力会社）が塗装をした日 → 〇〇塗装の労務費は塗装だけ、自社の労務費は作業内容の行の投入人工の比、工種の合計＋予算外＝その日の労務費。
  - 協力会社が 2 つの工種に入っている → その日の行の投入人工の比で 2 つに分ける。どこにも入っていない協力会社 → その日の行の比。
  - 工種の付いた行の無い日 → 全部予算外。
  - 数量から：単位が同じ内訳の行だけを分母（当初＋変更）、単位の違う日報の行は数えない、分母 0 なら null。上書きがあれば used＝上書き。
  - 見込み＝実績 ÷ (used/100)、used が null か 0 なら見込み null・status 'none'。
  - 内訳の「経費」「減分」は工種に入らず、合計の内訳の金額にだけ入る。
  - 協力会社の請負金額（`gn_site_partners.amount`）が PerformerRow.partnerContract に出る。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → test・tsc
- [ ] **Step 5: コミット** `feat(budget): 予算と実績の集計（工種・施工者・進み具合・見込み）`

### Task 5: 予算と実績の画面・進み具合の上書き

**Files:**
- Create: `src/app/(app)/sites/[siteId]/budget/page.tsx`（社員・管理者だけ）、`src/components/budget/BudgetTable.tsx`（パソコンの表）、`BudgetCards.tsx`（スマホのカード）、`TradeDetail.tsx`（工種を押すと施工者の行と日々の作業）、`ProgressOverride.tsx`（管理者と確認・承認の人だけ。% の入力と履歴）
- Modify: ガイド `budget.md`（見方・判定・読み替え表・% の上書き）、README（SQL・ルート）
- Test: 表示用の純関数（金額・% の書式、判定の札）、協力会社で API・画面が notFound／403 になる判定の関数

**Interfaces:**
- Consumes: Task 4 の `buildBudgetModel`、Task 3 の `AliasMapper`、Task 1 の `setTradeProgress`。

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装（見本 `budget-1.html` のとおり。上に未割り当ての工種の文字があれば知らせ、AliasMapper を開ける）→ test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(budget): 予算と実績の画面と進み具合の上書き`

**第 2 段階の区切り：** 最終レビュー → push（SQL は第 1 段階に含める。追加が要れば `update_2026-11-16_…`）。

---

## 第 3 段階：文字 PDF の内訳の読み取りと集計 Excel

### Task 6: 元請けの内訳の文字 PDF の読み取り

**Files:**
- Create: `src/lib/budget/pdf-table.ts`（純関数：pdf.js のテキスト項目［文字列・x・y・幅］から行と列を推定し、`ParsedContractItem[]` の候補にする。数値の「,」「¥」「△」「-」の扱い、単位の候補）、`src/components/budget/PdfImport.tsx`（ブラウザで pdfjs-dist を動的に読み込みテキストを取り出す → 列の割り当て［名称・規格・数量・単位・単価・金額］→ 行の除外・区分（当初／変更）・工種の識別を表で直す → Task 1 の `replaceContractItems`）
- Test: `tests/budget/pdf-table.test.ts`（テキスト項目の配列の固定データで、行のまとまり・列の割り当て・数値の読み取り・小計や見出しの行を候補から外す）

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装（画像だけの PDF＝文字が取れないときは「文字を読み取れない PDF です。Excel に貼り付けて取り込んでください」）→ test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(budget): 元請けの内訳を文字 PDF から読み取る`

### Task 7: 集計 Excel（7 シート）と記録

**Files:**
- Create: `src/lib/budget/report-xlsx.ts`（exceljs：① 予算と実績 ② 工種 × 施工者の明細 ③ 工種別の日々の実績 ④ 月別の推移 ⑤ 出面［所属つき］ ⑥ 元請けの内訳と数量の進み具合 ⑦ 実行予算［取り込み用と同じ形。Task 2 の `buildBudgetWorkbook` の「実行予算」シートを再利用］）、`src/app/api/budget/report/route.ts`（社員・管理者だけ、協力会社 403）
- Modify: 予算と実績の画面に「Excel に書き出す」、ガイド、README、記録文書 `docs/superpowers/plans/2026-10-30-phase1-record.md`
- Test: `tests/budget/report-xlsx.test.ts`（シート名と順、① の行が画面のモデルと一致、⑦ を取り込むと同じ予算、CSV 式の注入対策［先頭の = + - @ に ' を付ける既存の扱い］）

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装 → test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(budget): 予算と実績の集計 Excel`

**第 3 段階の区切り：** 最終レビュー → push（SQL が要らなければ push だけ）。
