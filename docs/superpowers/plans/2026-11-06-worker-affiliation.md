# 作業員の所属（自社／協力会社）と常用・請負の区分 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作業員に所属（自社／協力会社、2 次は上位の 1 次）を持たせ、労務の行に常用／請負とその日の所属を記録し、社内用の集計・資料に所属別の人工・労務費と請負金額の比較を出す。お客様用には出さない。未使用の作業員は削除できる。

**Architecture:** 作業員マスターと労務の行に列を足し、行には保存時に所属を写す（既存の写しの仕組み `snapshots.ts`）。協力会社アカウントと取引先の結び付け、現場の請負金額は新テーブル。集計は既存の `cost-model`・`change-model` に所属別の集計を足し、帳票は section 層で描く。

**Tech Stack:** Next.js 16、Supabase（RLS・plpgsql）、Zod 4、react-pdf、exceljs、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-06-worker-affiliation-design.md`（「設計レビューの問いへの答え」を含む。計画と食い違えば設計書が正）。

## Global Constraints
- 外注の作業員は買掛にしない（ガイドに明記）。協力会社の作業員も設定日当で労務費に入る。常用／請負は精算の区分で、原価の計算は変えない。
- お客様用（精算のご提案・お客様用日報）に所属・会社名・社員何名などの内訳を一切出さない（テストで固定）。
- 所属の値：`affiliation` は `'own' | 'partner'`。partner は `supplier_id` 必須（アプリで検証）、`parent_supplier_id` は任意（2 次）。労務の行は `labor_contract` `'jouyou' | 'ukeoi'`（null は常用）と、保存時の `affiliation`・`supplier_id`・`parent_supplier_id` の写し。
- 社内の表示名：自社＝「自社」、協力会社＝取引先名（2 次は「取引先名（上位：1 次名）」）、手入力＝「所属なし」。
- 協力会社の職長の作業員の選択肢＝その会社と、その会社を上位に持つ 2 次の会社の有効な作業員（現場の選択とは無関係）＋手入力。会社が未設定のアカウントは従来どおり。絞り込みは画面側。
- 作業員の削除は、日報の行（ref_id）と繰越初期値に一度も使われていないときだけ。現場の選択から一緒に外す。
- SQL：差分 `supabase/update_2026-11-07_worker_affiliation.sql`、schema_genba.sql に反映、何度実行しても安全、`npm run check:sql`。verify_rls_auto.sql に新テーブルの検査。
- UI は日本語、375px、44px。帳票の金額は保存値だけ。

## Review Focus
- 所属を変えた後も、過去の日報の集計が変わらないこと（Task 1・3 のテスト）。
- 2 次の作業員が 1 次の下にまとまり、1 次の職長の選択肢に出ること（Task 2・3）。
- 請負の日も労務費に入り、所属別の表で常用と請負に分かれること（Task 3）。
- お客様用 2 種に所属の文字が出ないこと（Task 4）。
- 使用中の作業員は削除できないこと（Task 1・2）。

---

### Task 1: DB・型・保存（所属・常用請負・その日の所属の写し・協力会社アカウントの会社・請負金額・削除）

**Files:** SQL（差分＋schema_genba.sql＋verify_rls_auto.sql）、`src/lib/types.ts`（`LaborLine.laborContract`, `LaborLine.affiliation?` 写し）、`src/lib/db/masters.ts`・`masters-schemas.ts`・`masters-actions.ts`（Worker の 3 項目、`deleteWorker(id)`：使用中なら `{ok:false,error:'日報や繰越で使っているため削除できません。無効にしてください'}`）、`src/lib/report/{schema,rows,snapshots}.ts`（労務の行の新列、保存時の写し）、`src/lib/db/accounts-actions.ts`（協力会社アカウントの会社 `gn_partner_accounts` の作成・更新）、`src/lib/db/sites.ts` 系（`gn_site_partner_contracts` の読み書き Action）, tests。
- [ ] テスト（Zod：partner で supplier 無し → エラー、labor_contract の値；rows：新列の往復；snapshots：保存時にマスターの所属が写る、手入力は所属なし；deleteWorker の使用判定は純関数に切り出してテスト）→ 実装 → `check:sql`・`npm test`・tsc・lint → コミット `feat(db): 作業員の所属と常用・請負、協力会社アカウントの会社、請負金額`

### Task 2: 画面（マスター・アカウント・日報の作業員の表・現場の請負金額）

**Files:** `src/components/masters/WorkersPanel.tsx`（所属・協力会社・上位の協力会社、一覧の所属表示と絞り込み、未使用の削除ボタン）, `src/components/accounts/AccountsPanel.tsx`（協力会社アカウントの会社）, `src/components/report/tables/LaborTable.tsx`（所属の小さな表示、協力会社の作業員に常用／請負セレクト）, `src/lib/report/form-props.ts`（協力会社の職長の選択肢の絞り込み：純関数 `workersForPartner(workers, supplierId)` をテスト）, 現場の編集（管理者）に請負金額の欄, tests。
- [ ] テスト（`workersForPartner`：1 次と配下の 2 次、無効は除く、未設定は全員）→ 実装 → tsc・lint・build → コミット `feat(masters): 作業員の所属と削除、協力会社の選択肢、請負金額の入力`

### Task 3: 集計（原価集計表 ④ 所属列・④-2 所属別・請負比較、変更増減 社内確認用と追加・変更の一覧の所属別人工）

**Files:** `src/lib/reports/types.ts`・`cost-model.ts`（`WorkerRow.affiliationLabel`、`AffiliationSection`：自社／協力会社（1 次ごと、内訳に 2 次）／所属なし、各 常用人工・請負人工・労務費、請負金額と請負の日の人工×設定日当）、`cost-sections.ts`（④ に所属列、④-2 表；PDF・xlsx・CSV は section から）、`change-model.ts`（件ごと・件なしの人工を所属別に按分：その日の労務の行の所属別人工比で作業内容の人工を按分する純関数）、`change-sections.ts`（社内確認用の件ごとの精算・明細に所属別人工の内訳列）、`changes-page.ts`・`src/components/changes/*`（一覧に内訳）、`src/lib/db/reports-data.ts`（請負金額・取引先名の読み込み）, tests。
- [ ] テスト（所属を後から変えても行の写しで集計；2 次が 1 次の下；請負の日も労務費；請負比較；按分の合計が元の人工と一致）→ 実装 → `npm test`・tsc・build、見本 PDF → コミット `feat(reports): 所属別の人工・労務費と請負金額の比較（社内用）`

### Task 4: お客様用の確認・ガイド・記録

**Files:** tests（お客様用 2 種の出力に所属・会社名・「自社」「協力会社」「所属」の文字が無いこと）, `src/content/guide/input.md`（外注の作業員は買掛にしない、常用／請負の使い分け）, `setup.md`（作業員の所属、協力会社アカウントの会社、請負金額）, `summary.md` か `pdf.md`（④-2 の見方）, README（SQL）, 記録文書。
- [ ] テスト → 文書 → `npm test`・lint → コミット `docs(guide): 作業員の所属・常用と請負・外注の作業員の記録の仕方`

---

## 自己点検
- 設計書のゴール 1〜7 → Task 1（1・3・4・7 のデータ）、Task 2（1・2・3・4・7 の画面）、Task 3（5・6）、Task 4（6 のお客様用・ガイド）。レビューの答え 7 項目は Global Constraints に反映。
- 型の整合：Worker の 3 項目と行の写し（Task 1）→ Task 2・3 が消費。`workersForPartner` は Task 2 で定義。
