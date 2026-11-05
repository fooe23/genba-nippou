# 客先に渡す資料（精算のご提案 客先用・社内確認用・お客様用日報）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原価・見込み額・提案額を出さない客先用の「追加・変更工事 精算のご提案（案）」（PDF・Excel）と「現場日報（お客様用）」（PDF）を出せるようにし、いまの精算資料は「変更増減 社内確認用」として残す。

**Architecture:** 新しいモデルは作らず、既存の `ChangeLedgerModel`・`DailyReportModel` から客先用の表を組む。客先用の金額の規則は `change-model.ts` の純関数 `clientSettlement` 1 つに置く。表の定義は `change-sections.ts`／`daily-sections.ts` に client 用の関数を足し、PDF・Excel はそれを描く。Route は既存の `/api/reports/changes`・`/api/reports/daily` に `audience=client` を足す。

**Tech Stack:** Next.js 16 Route Handler、@react-pdf/renderer 4.9、exceljs 4.4、Vitest。SQL の変更なし。

**Spec:** `docs/superpowers/specs/2026-11-06-client-facing-docs-design.md`（§1〜§6。§6 は設計レビューの問いへの答え。計画と食い違えば設計書が正）。

## Global Constraints
- 客先用（精算のご提案・お客様用日報）に出さないもの：実績原価、見込み額、原価からの提案額、経費率・利益率と「実績原価」の式、やり直しの件とその行、件なしの内訳（金額はまとめに含める）、作業員の氏名・時間・日当・労務費、車両・リース・現金・買掛の金額、本日原価集計、出来高・進捗率、連絡事項。
- 客先用の金額：確定した件（一式＝確定額あり、常用＝単価あり）の精算額＋件なしの行の提案額。見積中（未定、確定額の無い一式、単価の無い常用）は金額「—」、合計に入れず、「※ 見積中の件（N 件）は金額に含めていません。確定しだい改めてご提示します。」（N＝そのような件で、期間末までに紐づく行があるか一式・常用のもの。0 なら注記なし）。減は負。
- 客先用のまとめの件数＝その区分の金額に数えた件の数（件なしの行は件数に入れない）。月指定は「金額（累計）」と注記「件数・金額は月末までの累計」。
- 件ごとの内容の「確認」＝その件を登録した日報の客先確認の有無。ご指示の日付＝件を登録した日報の日付。
- 宛先の敬称：客先名が 様／御中 で終わればそのまま、会社名（株式会社・有限会社・合同会社・（株）・(株)・（有）を含む）なら「御中」、それ以外は「様」、客先名が無ければ「お客様 各位」。
- ファイル名：客先用 `現場名_精算のご提案_YYYYMMDD.pdf|xlsx`（月は `_YYYY年MM月`）、社内用 `現場名_変更増減_社内確認用_YYYYMMDD.…`、お客様用日報 `現場名_日報（お客様用）_YYYY-MM-DD.pdf`。禁止文字は `_`（既存の `fileNameStem`）。
- Route：`/api/reports/changes?site=&period=&format=pdf|xlsx&audience=client|internal`（既定 internal）、`/api/reports/daily?site=&date=&format=pdf&audience=client`（date のみ。month や csv と audience=client の組み合わせは 400）。`disposition=inline` は既存どおり。協力会社 403・削除済み 404 は既存のゲート。
- PDF は A4 縦、Noto Sans JP、禁則、行の途中で切れない。UI は日本語、375px、44px。帳票の金額は保存値だけ。

## Review Focus
- 見積中の件に紐づく行の提案額が、客先用のまとめに混ざらないこと（Task 1 のテスト）。
- 減の一式の件が客先用で負で出て、精算提案額から引かれること（Task 1）。
- 確定額の無い一式の件が客先用で「見積中」扱いになり、¥0 と印字されないこと（Task 1・2）。
- お客様用日報にやり直しの件・連絡事項・金額が出ないこと（Task 3）。
- `audience=client` を month や csv と組み合わせたとき 400 になること（Task 3）。

---

### Task 1: 客先用の金額の規則と、モデルの追加項目

**Files:**
- Modify: `src/lib/reports/types.ts`（`ChangeIssueSettlement.reportClientConfirmed: boolean`、`ClientSettlement` 型、`DailyReportModel.issues.items[]` に `number, kind, instructedBy, instructionMethod`）, `src/lib/reports/change-model.ts`（`reportClientConfirmed` を `settleIssues` で埋める；`clientSettlement(model: ChangeLedgerModel): ClientSettlement`）, `src/lib/reports/daily-model.ts`（件の 4 項目）, `src/lib/reports/change-sections.ts`（`addressee` の敬称規則）
- Test: `tests/reports/change-model.test.ts`, `tests/reports/daily-model.test.ts`, `tests/reports/change-sections.test.ts`

**Interfaces:**
- Produces: `interface ClientSettlement { base: number | null; baseBasis: 'contract' | 'estimate'; kinds: Record<ChangeLedgerKind, { count: number; amount: number }>; proposed: number | null; pendingCount: number; issues: ChangeIssueSettlement[]（載せる件：countsToward かつ やり直しでない。見積中も含む。日付順）; pendingIds: Set<string> }`。規則：件が「確定」＝`settlementMethod==='lump_sum' && fixedAmount !== null` または `settlementMethod==='daily_rate' && dailyRate !== null`。確定した件の `settled` を `category` の区分に足し `count` を 1 増やす。件なしの行（`model.unlinked`）の提案額は各区分の金額に足す（`unlinked` は区分別でないので、`model.rows`／through rows から `issue === null` を区分別に集計する関数を足す）。見積中（確定でない、やり直し以外）は `pendingCount` に数え金額に入れない。`proposed = base + Σ kinds.amount`（base が null なら null）。やり直しは `issues` にも入れない。
- `addressee(site)` の規則は Global Constraints のとおり（既存の関数を置き換え、既存テストを更新）。
- 日報モデルの件：`number`（その日報の中での登録順 1 始まり。既存の `issueRefs` と同じ）、`kind`、`instructedBy`、`instructionMethod`。

- [ ] **Step 1: テスト**（`clientSettlement`：一式／常用の確定、確定額の無い一式は pending、未定は pending で金額に入らない、やり直しは出ない、減が負、件なしの行の提案額が区分に入る、base null → proposed null、pendingCount；`reportClientConfirmed`；`addressee` の 5 パターン；日報モデルの件の 4 項目）
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: `npm test`・tsc** → **Step 5: コミット** `feat(reports): 客先用の精算額の規則（見積中を除く）と件の追加項目`

### Task 2: 精算のご提案（客先用）と 社内確認用（PDF・Excel・Route・出力画面）

**Files:**
- Create: `src/lib/reports/client-change-sections.ts`（`clientChangeInfoRows`, `clientChangeSummary`, `clientChangeIssues`, `clientChangeDetail`, `clientNotes`）, `src/lib/pdf/client-change-ledger.tsx`（`renderClientChangePdf(model, meta)`）, `src/lib/reports/client-change-xlsx.ts`（`buildClientChangeXlsx(model, meta)`）, `tests/reports/client-change-sections.test.ts`, `tests/reports/client-change-pdf.test.ts`, `tests/reports/client-change-xlsx.test.ts`
- Modify: `src/lib/reports/change-sections.ts`（社内用：`CHANGE_REPORT_TITLE` → 「変更増減 社内確認用」、件名行 → 「追加・変更の精算 社内確認」、宛先を出さない、まとめに「客先提示額（見積中を除く）」行）, `src/lib/reports/query.ts`（`parseChangesQuery` に `audience: 'client' | 'internal'`、`changeReportFileName(…, audience)`）, `src/app/api/reports/changes/route.ts`（audience で描画関数を切替）, `src/components/export/ExportPanel.tsx`（「変更増減 精算資料」欄 → 「客先用（精算のご提案）」「社内確認用」の 2 組、各 PDF プレビュー／PDF ダウンロード／Excel）, `tests/reports/query.test.ts`, `tests/reports/change-sections.test.ts`

**Interfaces:**
- Consumes: Task 1 の `clientSettlement`、`ChangeIssueSettlement.number/reportClientConfirmed`、`addressee`。
- 客先用の表（設計 §1）：まとめ 項目／件数／金額(円)（月は 金額（累計）(円)）；件ごとの内容 件／ご指示（「指示者／方法 MM/DD」）／精算（「一式（見積 MM/DD）」「一式」「常用 N 人工 × ¥単価」「見積中」）／金額(円)／確認；作業の明細 日付／区分／工種／施工内容／数量／単位／人工／指示者／方法／件（MM/DD-番号）／確認（やり直しの件の行は除く）。注記：見積中、月の累計、当初金額なし。末尾：発行者・お客様確認欄。脚注「現場日報アプリ ― 精算のご提案（案） 出力日時 ページ x / y」。PDF の共有部品（`common.tsx`）と `cost-xlsx` のヘルパーを使う。明細は 11 列を 1 段で（8pt 可）。

- [ ] **Step 1: テスト**（表の見出しに「実績原価」「見込み額」「提案額」「経費率」が無い、やり直しの件と行が無い、見積中は「—」と注記 N、減が負、社内用に「客先提示額」行、query の audience 既定と file name、PDF が `%PDF`、xlsx 読み戻し）
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: `npm test`・tsc・lint・build、見本 PDF をスクラッチに** → **Step 5: コミット** `feat(reports): 精算のご提案（客先用）と変更増減 社内確認用を分ける`

### Task 3: 現場日報（お客様用）PDF と Route・日報画面

**Files:**
- Create: `src/lib/reports/client-daily-sections.ts`（`clientDailyHeaderRows`, `clientDailyTables`：本日の作業（区分・工種・施工内容・数量・単位・人工）、作業員 N 名・合計 M.M 人工、本日の追加・変更のご連絡（番号・種別・ご指示・内容。やり直しを除く。無ければ「本日はありません」）、お客様確認）, `src/lib/pdf/client-daily-report.tsx`（`renderClientDailyPdf(model, outputAt)`）, `tests/reports/client-daily-sections.test.ts`, `tests/reports/client-daily-pdf.test.ts`
- Modify: `src/lib/reports/query.ts`（`parseDailyQuery` に `audience`；client は date＋pdf のみ、それ以外は 400「お客様用は 1 日分の PDF だけです」；`dailyReportFileName(…, audience)`）, `src/app/api/reports/daily/route.ts`, `src/app/(app)/sites/[siteId]/reports/[date]/page.tsx`・`src/components/report/ReportForm.tsx`（`exportLinks` に `clientPdfPreview`, `clientPdf`；リンク「お客様用 PDF」「お客様用 保存」）, `tests/reports/query.test.ts`

- [ ] **Step 1: テスト**（表に金額・氏名・連絡事項が無い、やり直しの件が無い、件が無ければ「本日はありません」、客先確認の記録済み／未記録、query：month＋client → 400、csv＋client → 400、PDF が `%PDF`） → **Step 2: 実装** → **Step 3: `npm test`・tsc・lint・build、見本 PDF** → **Step 4: コミット** `feat(reports): 現場日報（お客様用）PDF`

### Task 4: ガイド・README・記録

**Files:**
- Modify: `src/content/guide/changes.md`（「客先用と社内確認用の違い」「お客様用日報」）, `excel.md`・`pdf.md`（ボタンと資料の説明）, `approval.md`（客先確認の節に「お客様用 PDF を渡してサインをもらい、アプリに記録」）, `README.md`（Route の audience）, `docs/superpowers/plans/2026-10-30-phase1-record.md`（本計画の記録）
- Test: `tests/guide.test.ts`

- [ ] **Step 1: 実装** → **Step 2: `npm test`・lint** → **Step 3: コミット** `docs(guide): 客先用の精算のご提案・社内確認用・お客様用日報の説明`

---

## 自己点検
- 設計書 §1→Task 2、§2→Task 2、§3→Task 3、§4→Task 1〜3、§5→Task 4、§6 の 7 項目→Task 1（1・2・4・5・6・7）と Task 3（3）。
- 型の整合：`ClientSettlement`・`reportClientConfirmed`・日報の件の 4 項目（Task 1）→ Task 2・3 が消費。`audience` は Task 2 の `parseChangesQuery` と Task 3 の `parseDailyQuery` で同じ型名。
- Review Focus の 5 件はそれぞれ Task 1・2・3 のテストに載せた。
