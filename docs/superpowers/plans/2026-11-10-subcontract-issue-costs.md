# 外注（請負）の実績・常用の時間・件の材料精算 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日報の買掛に「区分（仕入／外注）・工種・根拠（件）」、現金・リース・燃料に「根拠（件）」、請負の会社の作業員の行に「うち常用の時間」を足す。外注の買掛を工種の請負の実績に入れ（現場全体には入れない）、請負の会社の人工は出面に残して原価に数えない（常用の分だけ数える）。予算と実績の画面・Excel・PDF に請負の「請負額／支払い／見込み」を出し、件の精算に人工・材料・リース・燃料・外注の内訳を出す。

**Architecture:** 4 段階で作り、段階ごとに利用者が確かめて push できる単位にする。SQL は第 1 段階の差分 1 本（`supabase/update_2026-11-17_subcontract.sql`）にまとめ、第 2〜4 段階は SQL なし。
- 第 1 段階＝DB と日報の入力（買掛の区分・工種・根拠、現金・リース・燃料の根拠、列名の変更、外注の行を協力会社のアカウントから隠す、原価の合計を明細から出す）
- 第 2 段階＝「うち常用の時間」と労務費の決まり（純関数 1 つを、原価を出すすべての所で使う）
- 第 3 段階＝予算と実績（集計・画面・Excel・PDF）の請負の実績と見込み
- 第 4 段階＝件の精算の内訳

労務費の決まり（請負／常用）は、行に**保存した**手の選択「常用／請負」（`labor_contract`、2026-11-07 から）で決める（決めたこと A）。新しく足す協力会社の作業員の行だけ、実行予算から既定を入れる（その現場の実行予算にその会社の請負の行がある → 請負、無い → 常用。利用者は選び直せる）。読むときに実行予算から決め直さないので、過去の日報の数字は実行予算を変えても動かない。DB の `amount`（労務の行）は今までどおり「人工 × 日当 ＋ 残業」（出面の金額）のまま残し、原価に数える分は `src/lib/calc/labor-cost.ts` が出す。

**Tech Stack:** Next.js 16 App Router、React 19、Tailwind 4、Supabase（Postgres RLS・plpgsql）、Zod 4、exceljs、@react-pdf/renderer、Vitest（node 環境）。

**Spec:** `docs/superpowers/specs/2026-11-10-subcontract-issue-costs-design.md`（計画と食い違えば設計書が正）。見本：`.superpowers/brainstorm/24602-1794232833/content/subcontract-1.html`。前の計画：`docs/superpowers/plans/2026-11-09-budget-vs-actual.md`。

## 調べて分かったこと（作り手が前提にすること）

- 日報の行は `gn_report_lines` 1 表。種類（`kind`）は `labor`（作業員）・`fuel`（車両）・`lease`・`cash`（現金）・`credit`（買掛）・`work`（作業内容）。TS の型は `src/lib/types.ts`（`CreditLine` など）、検証は `src/lib/report/schema.ts`、行の相互変換は `src/lib/report/rows.ts`（`toLineRow`・`fromLineRow`）。
- `issue_id`（根拠の件）は列としてどの種類の行にもある。`gn_save_report` は `t.issue_id` を種類に関係なく書くが、TS の `toLineRow` が作業内容の行にしか入れていない。件がその現場のものかの DB の検査は今は無い。
- `site_trade_id`（工種）は作業内容の行だけ。`gn_save_report` が `case when t.kind = 'work'` で、トリガー `gn_report_lines_trade` も作業内容以外を null にしている。
- 労務の行には 2026-11-07 から `labor_contract`（'jouyou'／'ukeoi'、手で選ぶ「常用・請負」）と所属の写し（`affiliation`・`supplier_id`）がある。日報の作業員の欄の下に「常用／請負」の選択がある（`LaborTable.tsx`）。原価には影響していない（`cost-model.ts` の ④-2 所属別だけが使う）。
- 労務の行の `amount`・`man_days`・`hours`・`overtime_hours` は DB のトリガー `gn_report_lines_compute` が計算する。日報の見出しの `cost_total` は `gn_save_report` が「作業内容以外の行の amount の合計」として書く。`cost_total` は承認待ちの一覧（本日原価）・現場の上部のまとめ（累計原価）・月次（`aggregate.ts` の `monthlyRows`）・原価集計表（`cost-model.ts` の累計）・日報の帳票（`daily-model.ts`）・台帳 Excel の出力（`export/payload.ts`）で使っている。
- 買掛の相手先は「取引先の印のある会社」だけで、協力会社だけの会社を買掛にすると保存で止まる（`creditSupplierError`・`MSG_NOT_VENDOR`、`src/lib/calc/supplier-roles.ts`、`reports-actions.ts` の `saveReport`）。外注の支払先は協力会社なので、この検査を外注の行では変える必要がある。
- 協力会社のアカウントは、その現場の日報の行（買掛の金額を含む）を RLS で読める。日報は「現場 × 日付」で 1 件なので、社員が入れた外注の買掛も、そのままでは協力会社に見える。実行予算（`gn_budget_lines`）と現場の協力会社（`gn_site_partners`）は社員・管理者だけ読める。
- 実行予算の項目は `labor`（自社の労務）・`subcontract`（請負）・`jouyou`（常用）・`material`・`lease`・`other`（`src/lib/budget/types.ts`）。請負・常用は `performer = 'partner'` で会社が必須。
- 予算と実績の集計は `src/lib/budget/budget-model.ts` の `buildBudgetModel`。労務費は行の保存値（`stored.amount`）、現場全体の実績は燃料・リース・現金・買掛の合計。
- 件の精算は `src/lib/reports/change-model.ts`（`buildChangeLedger`・`settleIssue`・`allocateDayCost`）。今は作業内容の追加・増・変更・減の行だけを集め、実績原価＝「行の投入人工 × その日の平均日当」＋「その日の燃料・リース・現金・買掛の合計を作業内容の人工比で按分」。
- 最新の SQL の差分は `update_2026-11-16_site_money.sql`。今回は `update_2026-11-17_subcontract.sql`。

## Global Constraints

- 金額のうち、請負額・外注の支払い・見込み・常用の単価（実行予算の）・「原価に数える労務費」は社員と管理者だけ。協力会社のアカウントには画面・API・Excel・DB（RLS）のどこからも出さない。外注の買掛の行は協力会社のアカウントから行ごと読めなくする（Task 1）。
- 日報の入力で増えるのは任意の欄か既定のある欄だけ：買掛の区分（既定は仕入）・工種（外注のときだけ）・根拠（件。任意）・うち常用の時間（任意。空欄は全部が請負）。
- 承認済みの日報は書き換えない。既存の行は「区分なし＝仕入」「うち常用の時間なし」「根拠なし」として読む。SQL で既存の行を update しない。
- 請負か常用かは行に保存した `labor_contract`（手の選択。null は常用）で決める。実行予算は、新しく足す協力会社の作業員の行の既定（請負の行がある会社 → 請負）にだけ使い、読むときには使わない。
- 出面（出面一覧・作業員別累計・日報の人工・Excel の出面）は区分にかかわらず全部の人工を出す。
- 外注の買掛は 1 回だけ原価に数える（予算と実績では工種の請負の実績、現場全体には入れない。原価集計では買掛として 1 回）。
- SQL：差分ファイル 1 本（`begin; … commit;`、何度実行しても安全）＋ `schema_genba.sql` に同じ内容を反映（新規環境の順番）＋ `verify_rls_auto.sql` に検査を足す。検査は `npm run check:sql` だけ。**SQL をデータベースに対して実行しない**（利用者が SQL Editor で実行してからデプロイ）。
- Postgres の列の自動 check 名に注意：`add column … check (…)` と書くと制約名は自動で `gn_report_lines_<列>_check` になる。同じ名前の名前付き制約を別に足すと重なって失敗する（`npm run check:sql` は構文だけ見るので見逃す）。今回の列は **列の定義に check を書かず**、`gn_report_lines_purchase_kind_ck`・`gn_report_lines_jouyou_hours_ck` の名前で `alter table … drop constraint if exists …; alter table … add constraint … check (…)` と足す。
- UI は日本語、幅 375px で使える、押す所は 44px 以上。帳票の金額は保存値（と、それから純関数で出した値）だけ。

## 作り手への決まり

- `templates/` の中は触らない（台帳 Excel の雛形 V34 も含む）。
- push しない（段階の区切りで利用者が指示する）。
- `git add` はファイルを 1 つずつ名前で指定する（`git add -A`・`git add .` は使わない。`templates/` に未追跡のファイルがある）。
- コミットの末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- `npx tsc --noEmit` の前に `.next` の中の「` 2.`」の付いた重複（例：`find .next -name '* 2.*' -delete`）を消す（型の重複でエラーになるため）。
- 各タスクの確認：`npx tsc --noEmit`、`npx eslint <変えたファイル>`、`npx vitest run`（全部）、SQL を変えたタスクは `npm run check:sql`。段階の区切りでは `npm run build` も。

## Review Focus

- 外注の買掛が、予算と実績で工種の請負の実績と現場全体の両方に入らないこと（Task 8 のテスト）。原価集計・月次では買掛として 1 回だけ入ること（Task 4 のテスト）。
- 請負の会社の人工が原価に入らず、出面には全部残ること。うち常用の時間の分だけが常用の単価で原価に入ること（Task 5・7 のテスト）。
- 協力会社のアカウントで、外注の買掛の行を読めない・書けない・消せないこと。協力会社が日報を保存し直しても、外注の行が消えず、`cost_total` が変わらないこと（Task 1 の verify）。
- 村山様邸の数字（タイル：請負 ¥270,000、支払い ¥100,000、自社 予算 2.0 人工 ¥40,000／実際 1.5 人工 ¥30,000、常用 0.5 人工 @¥22,000、進み具合 40% → 見込み ¥372,500、見込みの粗利 ¥410,500、予算超え）がそのまま出ること（Task 8）。
- 件の精算「門柱のタイル追加」で 人工 ¥11,000（0.5 人工）＋ 材料 ¥18,000 ＋ リース ¥15,000 ＝ ¥44,000 になること（Task 10）。

---

## 第 1 段階：日報の買掛の区分・工種・根拠、現金・リース・燃料の根拠（SQL あり）

### Task 1: SQL（列・保存・工種と件の検査・外注の行を隠す・請負の会社の一覧）

**Files:**
- Create: `supabase/update_2026-11-17_subcontract.sql`
- Modify: `supabase/schema_genba.sql`（同じ内容を、列は `gn_report_lines` の追加列の所に、関数は元の定義の所に反映）、`supabase/verify_rls_auto.sql`、`README.md`（SQL の実行順に 1 行）

**中身（意味を守れば書き方は任せる）：**
1. 列（どちらも null 可・既定なし。既存の行は触らない）：
   - `gn_report_lines.purchase_kind text` — 買掛の区分。null と 'material' は仕入、'subcontract' は外注。買掛以外の行は null。制約 `gn_report_lines_purchase_kind_ck`：`purchase_kind is null or purchase_kind in ('material','subcontract')`。
   - `gn_report_lines.jouyou_hours numeric` — 作業員の行の「うち常用の時間」（時間）。作業員以外は null。制約 `gn_report_lines_jouyou_hours_ck`：`jouyou_hours is null or (jouyou_hours >= 0 and jouyou_hours <= 24)`。
   - どちらも `add column if not exists` に check を書かない（上の「自動 check 名」の注意）。
2. `gn_save_report`（`create or replace`。引数・戻り値・楽観ロックは変えない）：
   - insert の列に `purchase_kind`・`jouyou_hours` を足す。`purchase_kind` は `case when t.kind = 'credit' then t.purchase_kind end`、`jouyou_hours` は `case when t.kind = 'labor' then t.jouyou_hours end`。
   - `site_trade_id` は「作業内容の行」か「買掛で外注の行」だけ：`case when t.kind = 'work' or (t.kind = 'credit' and t.purchase_kind = 'subcontract') then t.site_trade_id end`。
   - `issue_id` は作業員の行だけ null（`case when t.kind <> 'labor' then t.issue_id end`）。
   - `cost_total` は「作業内容以外の行のうち、外注の買掛を除いた amount の合計」にする（協力会社が読める列から外注の支払いが分からないように。外注を足した原価はアプリが明細から出す：Task 4）。`gn_save_report` は security invoker なので、協力会社が保存しても見えない外注の行は消えず、合計の定義も変わらない。
3. `gn_report_lines_trade`：作業内容の行と「外注の買掛の行」の工種は日報の現場のもの（`trade_not_in_site`）。それ以外の行（仕入の買掛を含む）は null にする。
4. 新しいトリガー `gn_report_lines_issue`（before insert or update）：`issue_id` があれば、その件の現場（`gn_report_issues.site_id`）と日報の現場が同じでなければ `issue_not_in_site`。security definer（件を RLS に関係なく見る）。作業員の行は null にする。
5. RLS（`gn_report_lines` の select・insert・update・delete のポリシーを付け直す）：今の条件に「`public.gn_is_employee_or_admin() or not (kind = 'credit' and purchase_kind = 'subcontract')`」を足す。協力会社のアカウントは外注の買掛の行を読めない・足せない・変えられない・消せない。
6. 関数 `gn_site_ukeoi_suppliers(p_site uuid) returns table (supplier_id uuid)`（security definer・stable）：呼んだ人がその現場のメンバー（`gn_is_site_member`）なら、`gn_budget_lines` で `item = 'subcontract'` の行の会社（重複なし）を返す。金額は返さない。協力会社のアカウントも呼べる（日報で新しく足す協力会社の作業員の行の「常用／請負」の既定を決めるため。決めたこと A）。`revoke all … from public, anon; grant execute … to authenticated`。
7. 先頭のコメントに：何を足すか、既存の行は書き換えないこと、実行の順（この SQL を実行してからアプリを出す。古い版のアプリはこの SQL の後でも動く）。

**verify（`verify_rls_auto.sql` に足す）：**
- 協力会社のアカウントで、外注の買掛の行を select できない・insert できない（RLS の拒否）・delete しても 0 行。
- 協力会社のアカウントが `gn_save_report` で同じ日報を保存し直しても、社員が入れた外注の行が残り、`cost_total` が保存し直す前と同じ。
- 外注の買掛の行に別の現場の工種 → `trade_not_in_site`。仕入の買掛の行の `site_trade_id` は null になる。
- 別の現場の件を根拠にした行 → `issue_not_in_site`。
- `gn_site_ukeoi_suppliers` は、メンバーでない人には 0 行、協力会社のアカウントには会社の id だけ（金額の列は無い）。
- 承認済みの日報の行は今までどおり変えられない（`approved_report_locked`）。

- [ ] **Step 1:** SQL を書く → `npm run check:sql`
- [ ] **Step 2:** `schema_genba.sql`・`verify_rls_auto.sql`・`README.md` に反映 → `npm run check:sql`
- [ ] **Step 3: コミット** `feat(db): 買掛の区分・工種、行の根拠、うち常用の時間、外注の行を協力会社から隠す`

### Task 2: 型・検証・行の変換

**Files:**
- Modify: `src/lib/types.ts`（`CreditLine` に `purchaseKind: PurchaseKind; siteTradeId: string | null; issueId: string | null`、`CashLine`・`LeaseLine`・`FuelLine` に `issueId: string | null`、`LaborLine` に `jouyouHours?: number | null`。`PurchaseKind = 'material' | 'subcontract'`）、`src/lib/report/schema.ts`（各スキーマに `.default(null)`／`.default('material')` で足す。古い下書きでも通る。買掛の単価・支払先の文言を「単価」「支払先」に。外注で工種が無い行は警告（`reportWarnings`、保存は止めない）。うち常用の時間が実働を超える行も警告）、`src/lib/report/rows.ts`（`LineRow` に `purchase_kind`・`jouyou_hours`、`toLineRow`・`fromLineRow` の往復。読み取りで列が無い・null の行は仕入・null）、`src/lib/reports/types.ts`（`StoredLineValues` に `hours: number`）、`src/lib/db/reports-data.ts`（`storedValues` で `hours` を読む）、`src/components/report/form-state.ts`（`newLine` の既定）、`src/lib/report/snapshots.ts`（`jouyouHours` は協力会社の行だけ残し、それ以外は null）、`src/lib/calc/supplier-roles.ts`（下の 2 つ）、`src/lib/report/rows.ts` の `saveErrorMessage`（`issue_not_in_site` →「選んだ件がこの現場にありません。画面を再読み込みして選び直してください」）
- Test: `tests/report/rows.test.ts`、`tests/report/schema.test.ts`、`tests/report/draft.test.ts`、`tests/calc/supplier-roles.test.ts`、`tests/report/snapshots.test.ts`

**Interfaces:**
- `creditSupplierError(lines, roles, storedIds)`：外注の行は対象外にする（仕入の行だけ今までどおり）。
- 新しく `subcontractSupplierError(lines: { purchaseKind; supplierId }[], roles: SupplierRoles): string | null`：外注の行の支払先が協力会社の印のある会社でなければ「外注の支払先は協力会社から選んでください」、支払先が空（手入力）でも同じ文言。

- [ ] **Step 1: テスト**：
  - 買掛：`purchaseKind`・`siteTradeId`・`issueId` が往復で残る。仕入の行の `site_trade_id` は `toLineRow` で null。列の無い古い行（`purchase_kind` undefined）は `purchaseKind 'material'`。
  - 現金・リース・燃料：`issueId` が往復で残る。作業員の行の `issue_id` は null。
  - 作業員：`jouyouHours` 4 が往復で残る、空は null。自社の行の `jouyouHours` は snapshots で null。
  - 古い下書き（新しい項目が無い）が検証を通り、既定（仕入・null）になる。
  - 検証の文言：買掛の単価が負 →「単価は0以上の数値で入力してください」。
  - `subcontractSupplierError`：外注 × 協力会社 → null、外注 × 取引先だけの会社 → 文言、外注 × 手入力 → 文言、仕入の行は見ない。`creditSupplierError` は外注の行の協力会社だけの会社で止めない。
- [ ] **Step 2:** 失敗を確認 → **Step 3:** 実装 → **Step 4:** `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(report): 買掛の区分・工種、行の根拠、うち常用の時間の型と保存`

### Task 3: 日報の画面（買掛・現金・リース・燃料）と列名

**Files:**
- Create: `src/components/report/tables/IssuePicker.tsx`（`WorkTable.tsx` の `issueOptions` と根拠（件）の選択を切り出し、作業内容の行と同じ選択肢・文言で使う。作業内容の行は今の動き（指示の写し）をそのまま）
- Modify: `src/components/report/tables/PurchaseTable.tsx`（買掛：列「区分」（仕入／外注、既定 仕入）、外注のときだけ「工種」（実行予算の工種から。工種が無い現場は出さない）、「根拠（件）」（任意）。外注のときの支払先の選択肢は現場の協力会社（社員だけが受け取る一覧）。列名「仕入単価 → 単価」「仕入先 → 支払先」「仕入金額 → 支払金額」「仕入金額 小計 → 支払金額 小計」、手入力の欄の文言も「支払先名」。現金にも「根拠（件）」。協力会社のアカウントには区分・工種の欄を出さない（常に仕入））、`LeaseTable.tsx`・`FuelTable.tsx`（「根拠（件）」）、`WorkTable.tsx`（`IssuePicker` を使う）、`src/components/report/ReportForm.tsx`（`issues`・`trades`・`isStaff`・外注の支払先の一覧を各表に渡す。本日原価集計の「買掛仕入」→「買掛」）、`src/lib/report/form-props.ts`（社員・管理者だけ現場の協力会社を読み、外注の支払先の一覧にする。協力会社のアカウントには空）、`src/lib/db/reports-actions.ts`（`saveReport`：協力会社のアカウントが外注の行を送ったら「外注の買掛は社員だけが入力できます」で止める。`subcontractSupplierError`。根拠の件の指示の写し（`applyIssueInstructions`）は作業内容の行だけのまま）、`src/lib/reports/daily-sections.ts`・`daily-csv.ts`（帳票の買掛の列名「支払先」「単価」「支払金額」、外注の行は品目の頭に【外注】と工種名）、`src/content/guide/input.md`（区分・工種・根拠・列名）
- Test: `tests/report/manual-rows.test.ts`・`tests/report/normalize.test.ts`（列名・文言の変更に合わせる）、`tests/reports/daily-sections` 相当（あれば。無ければ `tests/reports/` に買掛の列名と【外注】の頭のテストを足す）、`tests/report/for-site.test.ts`（外注の支払先の一覧は協力会社だけ）

- [ ] **Step 1: テスト**（表示用の純関数を切り出してテストする：外注の頭の付け方、外注の支払先の一覧、協力会社のアカウントでは区分の欄を出さない判定）
- [ ] **Step 2〜4:** 失敗を確認 → 実装（375px で 1 行が縦に並ぶ形、押す所 44px）→ `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(report): 買掛の区分・工種・根拠、現金・リース・燃料の根拠、支払先・支払金額の列名`

### Task 4: 原価の合計を明細から出す（`cost_total` を使わない）

Task 1 で `cost_total` から外注の買掛を除くので、原価を見せる所は明細の保存値から合計する（外注を 1 回だけ入れる）。協力会社のアカウントでは RLS で外注の行が読めないので、同じ関数で外注を含まない合計になる。

**Files:**
- Create: `src/lib/calc/day-cost.ts`（純関数 `dayCostOf(lines: { kind; purchaseKind?; stored: { amount } }[]): { labor; fuel; lease; cash; credit; subcontract; total }`。`credit` は仕入の買掛、`subcontract` は外注の買掛、`total` は全部の和。第 2 段階でここの `labor` を差し替えられるよう、労務の金額は引数の関数で受けられる形にしておく：`dayCostOf(lines, laborCostOf = (l) => l.stored.amount)`）
- Modify: `src/lib/calc/aggregate.ts`（`DayTotals` に `subcontract` を足し、`monthlyRows`・`costSummary` の原価を `cost_total` でなく区分の和に）、`src/lib/db/summary.ts`（`purchase_kind` も読み、外注を分ける）、`src/lib/reports/cost-model.ts`（`toDayTotals` と累計原価 `cumulativeCostTo` を区分の和に。⑤ 取引先別の買掛に外注も 1 回だけ入る）、`src/lib/reports/daily-model.ts`（本日原価集計の合計を区分の和に。「うち外注」を出す）、`src/components/site/SiteSummary.tsx` と `src/app/(app)/sites/[siteId]/page.tsx`（累計原価を `loadDayTotals` の和に）、`src/app/(app)/approvals/page.tsx`（本日原価を明細から：一覧の日報の id で明細の金額を 1 回の問い合わせで読む関数を `src/lib/db/reports.ts` に）、`src/lib/db/export.ts`（台帳 Excel の `siteReports.costTotal` を区分の和に）、`src/components/report/ReportSummary.tsx`（買掛を「買掛（仕入）」「外注」に分けて出す。社員だけ外注の行がある）
- Test: `tests/calc/day-cost.test.ts`、`tests/calc/aggregate.test.ts`（外注の行がある日の原価＝仕入＋外注＋…で 1 回だけ）、`tests/reports/cost-model.test.ts`（累計原価）

- [ ] **Step 1: テスト**：外注の買掛 ¥100,000・仕入の買掛 ¥18,000・労務 ¥20,000 の日 → total ¥138,000（外注は 1 回）。外注の行が無い日は今の `cost_total` と同じ値。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `refactor(summary): 原価の合計を明細の保存値から出す（外注を 1 回だけ）`

**第 1 段階の区切り：** 最終レビュー → `npm run build` → 利用者が SQL（`update_2026-11-17_subcontract.sql`）を実行 → 日報で買掛の外注・根拠を入れて確かめる → push。この段階では、外注の買掛は予算と実績で今までどおり「現場全体」に出る（第 3 段階で工種へ）。

---

## 第 2 段階：「うち常用の時間」と労務費の決まり（SQL なし）

### Task 5: 労務費の決まり（純関数）

**Files:**
- Create: `src/lib/calc/labor-cost.ts`、`tests/calc/labor-cost.test.ts`

**Interfaces:**
- `LaborCostContext = { jouyouRates: ReadonlyMap<string, number> }`（`jouyouRates` は会社 → 実行予算の常用の行の単価。協力会社のアカウントには空）。`EMPTY_LABOR_COST_CONTEXT`。
- `laborCostContextFrom(budgetLines: BudgetLine[]): LaborCostContext`（常用の単価＝その会社の `item 'jouyou'` の行のうち並びの先頭の行の単価）。
- `laborContractOf(line): 'own' | 'jouyou' | 'ukeoi'`（自社・所属なしは 'own'、協力会社で保存した `laborContract === 'ukeoi'` なら 'ukeoi'、それ以外の協力会社（null を含む）は 'jouyou'。実行予算は見ない：決めたこと A）。
- `laborCostSplit(line: LaborLine & { stored: StoredLineValues }, ctx, rule: LaborRule): LaborCostSplit`
  - `LaborCostSplit = { contract: 'own' | 'jouyou' | 'ukeoi'; manDays: number /* 出面＝stored.manDays */; jouyouManDays: number; ukeoiManDays: number; jouyouOvertimeHours: number; countedCost: number }`
  - 自社・所属なし：`countedCost = stored.amount`（今までどおり）、`jouyouManDays = stored.manDays`。
  - 常用の行（`laborContract` が 'jouyou'・null）：全部が常用。`countedCost = stored.amount`（保存値のまま。実行予算の常用の単価は使わない：決めたこと D）。うち常用の時間は見ない。
  - 請負の行：割合 `r = jouyouHours が null か stored.hours が 0 → 0、それ以外 → min(jouyouHours ÷ stored.hours, 1)`。`jouyouManDays = round2(stored.manDays × r)`、`ukeoiManDays = stored.manDays − jouyouManDays`、`jouyouOvertimeHours = min(stored.overtimeHours, jouyouHours ?? 0)`。単価 `rate = ctx.jouyouRates.get(supplierId) ?? line.dailyRate ?? 0`、残業単価 `overtimeRate(rate, line.overtimeRate, rule)`（`calc/report.ts` の関数）。`countedCost = 円未満四捨五入(rate × jouyouManDays + jouyouOvertimeHours × 残業単価)`。
- `laborCountedCost(line, ctx, rule): number`（`laborCostSplit(...).countedCost` の短縮）。

- [ ] **Step 1: テスト**（村山様邸の例。`rule` は既定 `DEFAULT_LABOR_RULE`）：
  - A さん（東北建興、保存した区分 請負、実働 8.0 H、人工 1.0、残業 0、日当 ¥22,000、うち常用 4.0 H、実行予算に東北建興の常用の行なし）→ 'ukeoi'、常用 0.5 人工・請負 0.5 人工、原価 ¥11,000。
  - B さん（同じ、うち常用 空欄）→ 常用 0、請負 1.0、原価 ¥0。出面 1.0。
  - C さん（△△工業、保存した区分 常用、人工 1.0、保存値 ¥22,000）→ 'jouyou'、原価 ¥22,000（うち常用の時間を入れても見ない）。区分が null の協力会社の行も同じ。
  - 実行予算で東北建興が請負に入っていても、保存した区分が常用の行は 'jouyou'（実行予算は読むときに見ない）。
  - 大江（自社、人工 1.0、保存値 ¥20,000）→ 'own'、原価 ¥20,000。
  - 実行予算に東北建興の常用の行（単価 ¥25,000）がある → A さんの原価 ¥12,500。
  - 残業：実働 10.0 H・人工 1.0・残業 2.0 H・日当 ¥22,000・うち常用 3.0 H → 割合 0.3、常用 0.3 人工、常用の残業 2.0 H、残業単価 round(22,000 × 1.25 ÷ 8) = ¥3,438 → 原価 6,600 ＋ 6,876 ＝ ¥13,476。
  - 作業員の残業単価 ¥3,000 の上書きがあればそれを使う。
  - うち常用の時間が実働より大きい → 割合 1（全部が常用）。実働 0 → 割合 0。
  - 請負の会社で日当も常用の単価も無い → 原価 ¥0（警告は画面で出す）。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(calc): 請負の会社の人工を原価に数えない決まりと、うち常用の時間`

### Task 6: 日報の作業員の行（区分の表示・うち常用の時間）と読み込み

**Files:**
- Modify: `src/lib/db/budget.ts`（`loadLaborCostContext(siteId, opts: { withRates: boolean }): Promise<LaborCostContext>`：単価は社員・管理者のときだけ `gn_budget_lines` から。`loadUkeoiSupplierIds(siteId): Promise<string[]>`：`gn_site_ukeoi_suppliers`（関数が無い＝SQL 前は空））、`src/lib/report/form-props.ts`（`laborCost` と請負の会社の一覧 `ukeoiSupplierIds` を渡す。協力会社のアカウントは単価なし・会社の一覧はあり）、`src/components/report/tables/LaborTable.tsx`（手で選ぶ「常用／請負」の選択は**残す**（決めたこと A）。新しく足した行・作業員を選び直した行で、所属が協力会社なら既定を入れる：その会社が `ukeoiSupplierIds` にあれば請負、無ければ常用。保存済みの行の区分は変えない。区分が請負の行だけ「うち常用の時間」（時間・小数 1 桁。空欄＝全部が請負）の欄。社員・管理者だけ「原価に数える分：常用 0.5 人工（¥11,000）／請負 0.5 人工は出面だけ」の小さな文字。常用の行には欄を出さず、常用に切り替えたらうち常用の時間を空にする）、`src/components/report/form-state.ts`（作業員を選び直したらうち常用の時間を空にし、区分の既定を入れ直す）、`src/components/report/ReportSummary.tsx`（社員・管理者：労務費を「原価に数える分」にし、「うち請負の人工 1.5 人工（原価に数えない）」を添える。協力会社のアカウントは今までどおり）、`src/lib/report/schema.ts`（`reportWarnings`：うち常用の時間が実働を超える行、請負の行で日当・常用の単価が無いのにうち常用の時間がある行）、`src/content/guide/input.md`
- Test: `tests/report/schema.test.ts`（警告）、表示用の純関数（`laborCostNote(split)` の文言、区分の既定 `defaultLaborContract(supplierId, ukeoiIds)`）のテスト

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装（375px で作業員の欄の下に区分と欄が収まること）→ `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(report): 請負の作業員の行にうち常用の時間、新しい行の区分の既定を実行予算から`

### Task 7: 原価を出すすべての所で労務費の決まりを使う

**Files:**
- Modify:
  - `src/lib/calc/day-cost.ts`（Task 4 の `laborCostOf` に `laborCountedCost` を渡す呼び出しに）
  - `src/lib/db/summary.ts`（労務の行の `affiliation`・`supplier_id`・`hours`・`jouyou_hours`・`unit_price`・`overtime_rate` も読み、日の労務費＝原価に数える分。`LaborEntry` は出面の人工はそのまま、`cost` は原価に数える分。`loadSummaryData(siteId, ctx)`）
  - `src/lib/reports/cost-model.ts`（① ③ の労務費、④ 作業員別累計の労務費は原価に数える分・人工は出面のまま、④-2 所属別：`AffiliationRow` を「常用の人工・常用の労務費・請負の人工（出面）・外注の支払い（その会社の外注の買掛の合計）・差額＝請負金額 − 外注の支払い」に直す。請負・常用は保存した `labor_contract` を `laborCostSplit` 経由で読む）、`src/lib/reports/types.ts`、`src/lib/reports/cost-sections.ts`・`cost-xlsx.ts`・`cost-csv.ts`・`src/lib/pdf/cost-report.tsx`（④-2 の列名）
  - `src/lib/reports/daily-model.ts`・`daily-sections.ts`・`daily-csv.ts`・`src/lib/pdf/daily-report.tsx`（作業員の行に「うち常用 H」、本日原価集計の労務費は原価に数える分、「うち請負の人工（原価に数えない）」の 1 行）
  - `src/lib/reports/change-model.ts`（`dayCostBasis`：労務費＝原価に数える分、労務の人工＝常用の人工（自社・常用の会社は全部））
  - `src/lib/budget/budget-model.ts`（労務の行の金額を原価に数える分に、施工者の実績の人工は常用の人工。この段階では行の分け方（請負／常用）は変えない。第 3 段階で直す）
  - `src/app/(app)/approvals/page.tsx`（本日原価に労務費の決まりを。現場ごとに `loadLaborCostContext`）
  - 読み込み：`src/lib/db/reports-data.ts`（`CostReportInput` に `laborCost: LaborCostContext`）、`src/lib/db/budget.ts`（`loadBudgetModelInput` に同じ）、各 Route（`src/app/api/reports/cost|daily|changes/route.ts`）は今の権限の判定のまま（協力会社は 403）
  - ガイド：`src/content/guide/summary.md`・`pdf.md`
- 対象外（作り手は変えない・利用者に伝える）：台帳 Excel の出力（`src/lib/export/payload.ts`・`python/genba_export`・`templates/`）は雛形の式で労務費を出すので、請負の会社の人工も労務費に入ったまま。
- Test: `tests/reports/cost-model.test.ts`（④-2 の新しい列、区分が請負の行の人工が労務費に入らず出面に残る）、`tests/reports/daily-model` 相当、`tests/reports/change-model.test.ts`（請負の会社の人工が平均日当に入らない）、`tests/calc/aggregate.test.ts`、`tests/budget/budget-model.test.ts`（既存の中野橋の数字が、請負の行の無い現場では変わらない）

- [ ] **Step 1: テスト**：A・B・C・大江の日（Task 5 と同じ）→ 日の労務費 ¥20,000 ＋ ¥11,000 ＋ ¥0 ＋ ¥22,000 ＝ ¥53,000、出面 4.0 人工。区分が請負の行の無い現場（中野橋の例）は今までの数字と同じ。
  - 注意（利用者に伝える）：2026-11-07 から手で「請負」を選んで保存した行は、この段階から原価 ¥0（うち常用の時間は空）になる。決めたこと A により、保存した区分をそのまま読むため。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(summary): 請負の会社の人工を原価に数えない（集計・帳票・精算・予算と実績）`

**第 2 段階の区切り：** 最終レビュー → `npm run build` → push（SQL は第 1 段階に含む）。

---

## 第 3 段階：予算と実績の請負の実績と見込み（SQL なし）

### Task 8: 集計（純関数）

**Files:**
- Modify: `src/lib/budget/budget-model.ts`、`src/lib/db/budget.ts`（集計の入力に `laborCost` と、外注の買掛の `purchaseKind`・`siteTradeId`・`supplierId`・`vendor`）
- Create: `tests/budget/fixture-murayama.ts`
- Test: `tests/budget/budget-model.test.ts`

**Interfaces（変えるところ）：**
- `PerformerRow` に `item: 'labor' | 'jouyou' | 'subcontract'` を足し、同じ会社でも請負と常用を別の行にする（並び：請負 → 自社・労務 → 常用。見本 ③ のとおり）。請負の行は `budgetAmount`＝実行予算の請負の行の金額、`actualAmount`＝支払い（外注の買掛の合計）、`forecast`＝`max(請負額, 支払い)`、`overContract`＝支払い > 請負額。労務・常用の行は `forecast`＝`round(actualAmount ÷ (used / 100))`（used が null・0 なら null）。
- `TradeRow` に `subcontract: { budget; paid; forecast; overContract }`（工種の請負の合計）、`attendance: { supplierId: string | null; name: string; manDays: number; ukeoiManDays: number; jouyouManDays: number }[]`（出面。自社は 1 行）を足す。
- 工種の実績 `actual.amount` ＝ 原価に数える労務費 ＋ 外注の支払い。`actual.manDays` は原価に数える人工（常用の人工）。
- 見込み：`laborForecast` ＝ 労務・常用の実績も予算も 0 なら 0、それ以外は used > 0 のとき `round(労務・常用の実績 ÷ (used / 100))`、used が null・0 なら null。`forecast` ＝ `laborForecast` が null なら null、それ以外は `請負の見込みの合計 ＋ laborForecast`。判定は今までどおり（見込み・実行予算・内訳の金額で比べる）。
- 外注の買掛：工種＝行の `siteTradeId`（現場の工種に無ければ null）。工種があればその工種の、その会社（`supplierId`。無ければ「（手入力）支払先名」）の請負の行の実績。工種が無ければ「予算外」に `subcontractPaid` として出す。どちらも現場全体（`siteWide.actual.credit`）には入れない。`SiteWideRow.actual` の `credit` は仕入の買掛だけ。
- 請負額は実行予算の請負の行だけから（`gn_site_partners.amount` は使わない：決めたこと D）。
- 請負の人工（出面だけの分。保存した区分が請負の行の、うち常用でない分）は、今の振り分けの重み（その会社を入れた工種が 1 つならそこ、など）でそのまま工種に配り、`attendance` にだけ数える。

- [ ] **Step 1: テスト**（`fixture-murayama.ts`：工種 タイル、内訳 タイル ¥783,000、実行予算 タイル＝東北建興・請負 1 式 ¥270,000、自社・労務 2.0 人工 × ¥20,000 ＝ ¥40,000、進み具合の上書き 40%。日報 1 日目：作業内容 タイル 投入 2.0、大江（自社）1.0 人工 ¥20,000、A さん（東北建興、8.0 H、1.0 人工、日当 ¥22,000、うち常用 4.0）、B さん（東北建興、うち常用 空欄）、買掛 外注 タイル工事 東北建興 工種 タイル ¥100,000、買掛 仕入 タイル 200角 〇〇建材 2 箱 × ¥9,000 ＝ ¥18,000。2 日目：作業内容 タイル 投入 0.5、大江 0.5 人工 ¥10,000）：
  - タイル：実行予算 ¥310,000、実績 ¥141,000、見込み ¥372,500、見込みの粗利 ¥410,500、判定 'overBudget'。
  - 施工者の行：東北建興・請負（予算 ¥270,000、支払い ¥100,000、見込み ¥270,000、超えていない）、自社・労務（予算 ¥40,000・2.0 人工、実績 ¥30,000・1.5 人工、見込み ¥75,000）、東北建興・常用（予算 ¥0、実績 ¥11,000・0.5 人工、見込み ¥27,500）。
  - 出面：東北建興 2.0 人工（請負 1.5・常用 0.5）、自社 1.5 人工。
  - 現場全体の買掛の実績は ¥18,000（¥118,000 ではない）。合計の実績 ¥159,000。
  - 外注の買掛をもう 1 行 ¥200,000 足す → 支払い ¥300,000、請負の見込み ¥300,000、`overContract` true、工種の見込み ¥402,500。
  - 工種を選んでいない外注の買掛 → 予算外の `subcontractPaid` に入り、現場全体にも工種にも入らない。
  - 進み具合が無い（上書きを外す・数量も無い）→ 見込み null、判定 'none'。請負だけの工種（労務・常用の予算も実績も 0）→ 見込み＝請負の見込み。
  - 既存の中野橋の例のテストがそのまま通る（請負の行・外注の買掛が無い現場は数字が変わらない）。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(budget): 請負の実績を外注の買掛から、請負の見込みと工種の見込み`

### Task 9: 予算と実績の画面・Excel・PDF

**Files:**
- Modify: `src/lib/budget/budget-view.ts`（施工者の行の見出し「東北建興・請負」「自社・労務」「東北建興・常用（請負外）」、請負の行の「請負額／支払い／見込み」、「請負額を超えています」の札、出面の 1 行の文言）、`src/components/budget/TradeDetail.tsx`・`BudgetTable.tsx`・`BudgetCards.tsx`（見本 ③ の並び。375px のカードでは請負と人工を 2 つのまとまりに）、`src/lib/budget/report-sections.ts`・`src/lib/pdf/budget-report-pdf.tsx`（工種ごとの施工者の明細に請負の列）、`src/lib/budget/report-xlsx.ts`（② 工種 × 施工者の明細に「区分（請負／労務／常用）・請負額・支払い・見込み」、① の予算外の行に「工種なしの外注」）、`src/content/guide/budget.md`（外注の買掛の入れ方、請負の見込み、請負の会社の人工は出面だけ）。あわせて「元請けの内訳」を「受注の内訳」に名前を変える（決めたこと C：画面・ガイド・Excel・PDF の文言だけ。DB・型の名前は変えない。`grep -rn 元請けの内訳 src tests` の全部）
- Test: `tests/budget/budget-view.test.ts`（文言・札）、`tests/budget/report-xlsx.test.ts`（② の列と村山様邸の行の値）、`tests/budget/budget-pdf.test.ts`（行の組み立て）

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- Test（追加）：「元請けの内訳」の文字が `src` に残っていない（文言を直したテストの期待値も「受注の内訳」に）。
- [ ] **Step 5: コミット** `feat(budget): 予算と実績の画面・Excel・PDF に請負の請負額・支払い・見込み、「受注の内訳」に名前を変える`

**第 3 段階の区切り：** 最終レビュー → `npm run build` → 村山様邸で画面と Excel・PDF を確かめる → push。

---

## 第 4 段階：件の精算の内訳（SQL なし）

### Task 10: 件の精算の内訳（純関数）

**Files:**
- Modify: `src/lib/reports/change-model.ts`、`src/lib/reports/types.ts`
- Test: `tests/reports/change-model.test.ts`

**Interfaces:**
- `ChangeIssueSettlement` に `costBreakdown: { labor: number; laborManDays: number; material: number; lease: number; fuel: number; subcontract: number; total: number }` を足す。
  - `labor`・`laborManDays`：その件に紐づく作業内容の行の実績原価の労務分と投入人工の合計（今の `allocateDayCost` の労務分。第 2 段階で原価に数える労務費だけになっている）。
  - `material`：根拠にその件を選んだ現金と、仕入の買掛の amount の合計。`lease`・`fuel`：根拠にその件を選んだリース・燃料。`subcontract`：根拠にその件を選んだ外注の買掛。
- 根拠に件を選んだ現金・買掛・リース・燃料の行は、その件にだけ入れ、その日の按分（`DayCostBasis.otherCost`）からは除く（二重に数えない）。
- 根拠を選んでいない行（燃料・リース・現金・買掛）は件に按分しない（決めたこと B）。今の `AllocatedCost.other`（その日の燃料・リース・現金・買掛を人工比で按分）をやめ、根拠にその件を選んだ行だけを集める。テストで固定する。
- 未定の件の精算額：紐づく行の提案額の合計 ＋ `proposalFromCost(material + lease + fuel + subcontract)`。紐づく作業内容の行が無くても、根拠に選んだ行があれば精算の資料に載せる。
- 一式・見積・常用の件の精算額は今までどおり（内訳は参考として出す）。

- [ ] **Step 1: テスト**（門柱のタイル追加：1 日の日報に、作業内容 タイル（契約内）投入 1.5、作業内容 門柱のタイル追加（追加・根拠＝件 X）投入 0.5、作業員 A さん（東北建興・請負の会社、うち常用 4.0 H → 常用 0.5 人工 ¥11,000）・B さん（全部が請負）、買掛 仕入 タイル 200角 ¥18,000（根拠 X）、リース ¥15,000（根拠 X）。経費率・利益率は 0）：
  - 件 X の内訳：人工 ¥11,000（0.5 人工）、材料 ¥18,000、リース ¥15,000、燃料 ¥0、外注 ¥0、合計 ¥44,000。未定なら精算額 ¥44,000。
  - 根拠に選んだ買掛は、契約内の行・ほかの件の行の按分に入らない。
  - 根拠を選んでいない仕入の買掛 ¥5,000 を足しても、件 X の合計は ¥44,000 のまま（按分をやめる決まり：決めたこと B）。
  - 外注の買掛 ¥30,000（根拠 X）→ 外注 ¥30,000、合計 ¥74,000。
  - 一式の件（確定額 ¥60,000）に根拠の行があっても、精算額は ¥60,000、内訳は出る。
  - 根拠の行だけで作業内容の行の無い件も、精算の資料に載る。
- [ ] **Step 2〜4:** 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(changes): 件の精算に人工・材料・リース・燃料・外注の内訳`

### Task 11: 精算の画面・資料

**Files:**
- Modify: `src/components/changes/IssueSettlementRow.tsx`・`ChangesTable.tsx`・`cells.tsx`（件の行に内訳：人工・材料（買掛・現金）・リース・燃料・外注・合計。見本 ④ の並び。375px では折り返し）、`src/lib/reports/change-sections.ts`・`src/lib/pdf/change-ledger.tsx`・`src/lib/reports/change-xlsx.ts`（社内用の精算の資料に内訳の列）、`src/lib/reports/changes-page.ts`、`src/content/guide/changes.md`
- 変えない：お客様用（`client-change-sections.ts`・`client-change-xlsx.ts`・`client-change-ledger.tsx`）には内訳を出さない（原価なので）。
- Test: `tests/reports/change-sections` 相当（内訳の列と値）、お客様用の出力に内訳の文字・金額が無いこと

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装 → `npx tsc --noEmit`・`npx eslint <files>`・`npx vitest run`
- [ ] **Step 5: コミット** `feat(changes): 精算の画面と資料に件の内訳`

**第 4 段階の区切り：** 最終レビュー → `npm run build` → push。記録文書（`docs/superpowers/plans/2026-10-30-phase1-record.md`）に 4 段階の要点を足す。

---

## 決めたこと（2026-11-10 利用者）

作り手の「おすすめ」を全部そのまま採った。

- **A. 作業員の行の「常用／請負」**：2026-11-07 からの手の選択（`labor_contract`）を**残し**、保存も続ける。新しく足す協力会社の作業員の行だけ、実行予算から既定を入れる（その現場の実行予算にその会社の請負の行がある → 請負、無い → 常用）。「うち常用の時間」は区分が請負の行だけに出す。労務費の決まりは**保存した** `labor_contract` を読む（読むときに実行予算から決め直さない）ので、過去の日報の数字は実行予算を変えても動かない。（第 2 段階の Task 5〜7 をこれに合わせて直した。「過去の行が請負として読まれる」心配は無くなった。）
- **B. 件の精算**：根拠にその件を選んだ行だけを数える。根拠の無い燃料・リース・現金・買掛を人工比で按分するのはやめる（Task 10）。
- **C. 名前**：「元請けの内訳」を「受注の内訳」に変える（画面・ガイド・Excel・PDF の文言。第 3 段階の Task 9）。
- **D. 金額の元**：
  - 請負額は実行予算の請負の行だけ（`gn_site_partners.amount` は使わない）。
  - 常用の単価（請負の行のうち常用の分）＝ 実行予算のその会社の常用の行（並びの先頭）の単価 → 無ければ設定日当（日報の写し）。区分が常用の行は今までどおり保存値（日当）で数える。
  - 残業の割増は常用の分にだけ：常用の残業時間 ＝ min(その行の残業時間, うち常用の時間)。
  - 既存の「外注」と書いた仕入の買掛は区分を読み替えない（読み替えの画面は作らない）。
  - 台帳 Excel（V34 の雛形）の出力はこのまま（列名は「仕入」、請負の行の人工も雛形の式で労務費に入る）。
- **E. 協力会社のアカウントに見える金額**：仕入の買掛・リース・労務（日当を設定した分）・本日原価は今までどおり見えてよい。受注（元請け）の金額は見せない（済み）。外注の買掛の行（自社が外注に出す値段）は協力会社のアカウントから隠す（Task 1 の RLS）。
