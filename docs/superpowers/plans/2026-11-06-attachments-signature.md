# 日報・件の添付、お客様のサイン、件の「見積中」 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 件に「見積中」の状態を足し、確認者・承認者も承認解除でき、担当者が修正申請を出せるようにする。日報と件に写真・ファイル・リンクを付けて画面で見られるようにし、お客様のサインとサインした時点の PDF、写真付きのお客様用日報 PDF を作る。

**Architecture:** 3 段階で作り、段階ごとに SQL 差分 1 本・push できる単位にする。添付は 1 つの台帳表 `gn_attachments` と既存の非公開 Storage バケット（`gn-photos`・`gn-estimates`、パスは `<site_id>/...`）。写真はブラウザで縮めてから送る。サインは画像として保存し、保存した時点でお客様用日報 PDF をサーバーで作って保存する。

**Tech Stack:** Next.js 16 App Router、React 19、Supabase（Postgres RLS・plpgsql・Storage）、Zod 4、@react-pdf/renderer 4.9、Vitest（node 環境）。

**Spec:** `docs/superpowers/specs/2026-11-06-attachments-signature-design.md`（末尾の「問いへの答え」と「サインした時点の PDF を残す」を含む。計画と食い違えば設計書が正）。

## Global Constraints

- UI は日本語、375px、44px。スマホ（撮影）とパソコン（ドラッグ＆ドロップ）の両方。
- 写真は付けた時点でブラウザで縮める：長い辺 1600px、JPEG 画質 0.8 前後、元画像は保存しない。ファイルは縮めず 1 ファイル 10MB まで（写真も縮めた後で 10MB まで）。
- 協力会社のアカウント：写真・リンクは見る・付ける可。**ファイル（見積書など）は見られない・付けられない、「見積書あり／なし」の印も出さない**。画面とDB・Storage の両方で防ぐ。
- お客様用 PDF に載るのは、その日に付けた写真のうち「お客様用に載せる」をチェックしたもの（日報の写真＋その日に件へ付けた写真。やり直しの件の写真は除く）とサインだけ。ファイル・リンク・チェックなしの写真は出さない。精算のご提案（客先用・社内確認用）には写真も見積書も載せない。
- 件の状態：'estimating'（見積中）／'open'（対応中）／'done'（完了）。既存の件は対応中のまま。札で直接どれにでも変えられる。件の追加時に見積中か対応中を選ぶ（既定は対応中）。画面の金額未確定の表示は「金額未確定」と書き、お客様向け資料の「見積中の件」の文言はそのまま。
- 承認解除と差戻し：その現場の確認者・承認者（gn_site_role が reviewer / approver）と管理者。
- 日報の添付は提出（submitted）後は足す・消すができない（「お客様用に載せる」の切替だけ可：社員・管理者・付けた本人）。件の添付は件が完了するまでいつでも足せる。消せるのは付けた本人と管理者。
- サイン：どの状態の日報でももらえる。保存すると確認者・日時・メモも固定。取り消しは管理者だけ（理由必須、記録を残す）。承認解除・差戻しでは消えない。保存した瞬間のお客様用日報 PDF を保存し、取り消しても PDF は消さない。
- SQL：段階ごとに差分ファイル（何度実行しても安全）＋ schema_genba.sql に反映＋ verify_rls_auto.sql に検査。`npm run check:sql`。利用者が SQL Editor で実行してからデプロイ。SQL をデータベースに対して実行しない。
- コミットの末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の指示で。

## Review Focus

- 協力会社のアカウントで、見積書のファイルを Storage の URL 直打ち・一覧の API・件の印のどこからも開けないこと（Task 3 のテスト、verify）。
- 縦向き・横向き・HEIC（iPhone）・巨大な写真（12MB・4000px 超）でも縮めて保存でき、向きが崩れないこと（Task 4 の純関数テストと手順書）。
- 提出後の日報に添付を足せないが、同じ日報の件には足せること（Task 3 のガードのテスト）。
- サインを保存した後に日報や写真のチェックを変えても、保存した PDF は変わらず、新しく出す PDF だけが変わること（Task 5・6 のテスト）。
- 写真が 0 枚・1 枚・奇数枚・20 枚のときに、お客様用日報 PDF が崩れず、サイン欄がページの途中で切れないこと（Task 6 のテストと見本 PDF）。

---

## 第 1 段階：件の「見積中」・承認解除の権限・修正申請

### Task 1: DB と操作（件の状態・承認解除・修正申請）

**Files:**
- Create: `supabase/update_2026-11-08_issue_estimating_fix_request.sql`
- Modify: `supabase/schema_genba.sql`（gn_report_issues の status check、gn_report_guard、新表）、`supabase/verify_rls_auto.sql`
- Modify: `src/lib/db/reports-actions.ts`（`setIssueDone` → `setIssueStatus`、`addIssue` に状態、`reopenReport` の権限、`requestReportFix`）、`src/lib/db/reports.ts`（`listOpenIssues` が見積中も返す、修正申請の読み込み）、`src/lib/types.ts` か件の型の場所（`IssueStatus = 'estimating' | 'open' | 'done'`）
- Test: `tests/report/issue-status.test.ts`、既存の件・状態のテスト

**Interfaces:**
- Produces: `setIssueStatus(issueId: string, status: IssueStatus, doneAt?: string): Promise<ReportStateResult>`（'done' 以外は done_at を null）。`addIssue(reportId, body, extra?: IssueExtraInput & { status?: 'estimating' | 'open' })`。`requestReportFix(reportId: string, reason: string): Promise<ReportStateResult>`。`listFixRequests(): Promise<FixRequest[]>`（承認待ち一覧用：自分が確認者・承認者の現場と、管理者は全部）。`FixRequest = { id, reportId, siteId, siteName, reportDate, reason, requestedByName, requestedAt }`。
- DB：`gn_report_issues.status` に 'estimating'。新表 `gn_report_fix_requests(id, report_id → gn_daily_reports on delete cascade, site_id, reason text not null, requested_by, requested_at, resolved_at null)`。日報が draft か rejected に変わったら、その日報の未解決の申請に resolved_at を入れる（トリガー）。RLS：現場メンバーが読める、提出済み・承認済みの日報について現場メンバー（協力会社は自分が作った日報だけ）が入れられる、更新・削除は不可（トリガーだけ）。
- gn_report_guard：approved → draft の変更を、管理者に加えて確認者・承認者（`gn_site_role in ('reviewer','approver')`）に許す。そのとき変えてよい列は status・approved_by・approved_at・reviewed_by・updated_at だけ（ほかの列が変わっていたら `approved_report_locked`）。

- [ ] **Step 1: テストを書く**：`setIssueStatus` の入力検証（3 つの状態だけ、'done' で doneAt 必須か既定で今日）、`addIssue` の status の Zod（既定 'open'）、`requestReportFix` の理由（1〜500 文字、「修正の理由を入力してください」）、`reopenReport` が管理者以外でも DB に任せる（アプリ側の `adminOnly` を外す）ことを示す純関数・スキーマのテスト。
- [ ] **Step 2: 失敗を確認**：`npx vitest run tests/report/issue-status.test.ts` → FAIL
- [ ] **Step 3: SQL**：差分ファイル（status の check を pg_constraint で探して付け直す、ガードの差し替え、新表・RLS・解決トリガー）。schema_genba.sql に反映。verify に：確認者が承認解除できる、担当者（staff）はできない、協力会社は自分の日報に申請できる・他人の日報にはできない、下書きに戻すと申請が解決になる、見積中の件を作れる。`npm run check:sql` → OK
- [ ] **Step 4: 実装**：上の Interfaces どおり。`setIssueDone` は呼び出し元を `setIssueStatus` に移して消す。`listOpenIssues` は 'estimating' と 'open'。エラー文言：承認解除の権限なし「この現場の確認者・承認者か管理者だけが承認を解除できます」。
- [ ] **Step 5: 確認**：`npm test`・`npx tsc --noEmit`・`npm run lint` → すべて通る
- [ ] **Step 6: コミット** `feat(db): 件の見積中、確認者・承認者の承認解除、修正申請`

### Task 2: 画面とガイド（件の札・承認解除ボタン・修正申請）

**Files:**
- Modify: `src/components/report/IssueBanner.tsx`（見積中＝紫・対応中＝青の札、件数の見出し「対応中・見積中の重要事項（N 件）」）、`src/components/report/ReportForm.tsx`（件の札を押すと 3 つから選ぶ、件の追加で見積中／対応中）、`src/components/site/SiteSummary.tsx`、承認解除ボタンの場所（日報画面の承認済みの帯）、承認待ち一覧 `src/app/(app)/approvals/page.tsx`（修正申請の一覧）、日報画面に「修正を申請」（提出済み・承認済みのとき、理由入力）
- Modify: 精算の画面（`src/components/changes/*`）で金額未確定を示す文言を「金額未確定」に（お客様向け資料は変えない）
- Modify: `src/content/guide/input.md`（件の 3 つの状態）、`approval.md`（承認解除は確認者・承認者・管理者、修正申請の流れ、日報の添付は提出までに）
- Test: 札の表示名・色・並びの純関数（`issueStatusLabel`、`issueStatusOrder`）

**Interfaces:**
- Consumes: Task 1 の `setIssueStatus`・`addIssue`・`requestReportFix`・`listFixRequests`・`reopenReport`。
- Produces: `issueStatusLabel(s: IssueStatus): '見積中' | '対応中' | '完了'`。

- [ ] **Step 1: テスト**：`issueStatusLabel` の 3 つ、バナーの並び（見積中 → 対応中、同じ状態は件番号順）
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4:** `npm test`・tsc・lint・`npm run build` → 通る
- [ ] **Step 5: コミット** `feat(issues): 件の見積中の札、承認解除と修正申請の画面`

---

## 第 2 段階：添付（写真・ファイル・リンク）

### Task 3: 添付の DB・Storage・操作

**Files:**
- Create: `supabase/update_2026-11-09_attachments.sql`、`src/lib/db/attachments.ts`（読み込み）、`src/lib/db/attachments-actions.ts`、`src/lib/db/attachments-schemas.ts`
- Modify: `supabase/schema_genba.sql`（新表・RLS・ガード、`gn-estimates` のポリシーを社員・管理者だけに）、`supabase/verify_rls_auto.sql`
- Test: `tests/db/attachments-schemas.test.ts`

**Interfaces:**
- DB：`gn_attachments(id, site_id, report_id null, issue_id null［どちらか一方必須］, kind 'photo'|'file'|'link', storage_bucket null, storage_path null, url null, name text, caption text, mime text, size_bytes int, client_visible boolean not null default false, attached_on date not null［その日報の日付］, created_by, created_at, sort_order)`。check：photo・file はパス必須、link は url（http/https）必須。RLS 読み：現場メンバー、ただし kind='file' は `gn_is_employee_or_admin()`。追加：現場メンバー（file は社員・管理者だけ）、日報の添付は日報が draft/rejected のときだけ、件の添付は件が done でないときだけ、完了現場は不可。削除：付けた本人か管理者、同じ状態の条件。更新は client_visible だけ（社員・管理者・付けた本人）。
- Storage：写真 `gn-photos/<site_id>/att/<attachment_uuid>.jpg`、ファイル `gn-estimates/<site_id>/att/<attachment_uuid>.<ext>`。`gn-estimates` の read/insert に `gn_is_employee_or_admin()` を足す。
- Produces: `listAttachmentsForReport(reportId): Promise<Attachment[]>`、`listAttachmentsForIssues(issueIds: string[]): Promise<Map<string, Attachment[]>>`（協力会社には file を返さない＝RLS）、`prepareUpload(input: { siteId, reportId?, issueId?, kind: 'photo'|'file', name, mime, sizeBytes }): Promise<{ ok, attachmentId, bucket, path } | { ok:false, error }>`（パスを決めるだけ）、`commitAttachment(input & { attachmentId, caption? }): Promise<Result>`（ファイルが置かれたか確かめて台帳の行を作る。件の写真は client_visible 既定 true、日報の写真は false、file・link は false 固定）、`addLink({ siteId, reportId?, issueId?, url, name })`、`setAttachmentClientVisible(id, visible)`、`deleteAttachment(id)`（Storage の実体も消す）、`signedUrl(attachment): Promise<string>`（画面表示用、有効期限 1 時間）。`Attachment = { id, kind, name, caption, url?, mime?, sizeBytes?, clientVisible, attachedOn, createdBy, createdByName, issueId?, reportId? }`。

- [ ] **Step 1: テスト**：スキーマ（link は http/https だけ、名前 1〜100 文字、10MB 超を拒否、写真の mime は image/*、ファイルの拡張子・mime の許可リスト：pdf・xlsx・xls・docx・doc・jpg・png）、client_visible の既定値を決める純関数 `defaultClientVisible({ kind, issueId })`。
- [ ] **Step 2: 失敗を確認** → **Step 3: SQL**（verify：協力会社は file の行も Storage の file も読めない、提出済みの日報に足せない・同じ日報の件には足せる、完了した件には足せない、他人の添付は消せない）→ `check:sql`
- [ ] **Step 4: 実装** → **Step 5:** test・tsc・lint → **Step 6: コミット** `feat(db): 日報と件の添付（写真・ファイル・リンク）`

### Task 4: 添付の画面（撮る・選ぶ・ドロップ・リンク・縮める・表示）

**Files:**
- Create: `src/lib/calc/image-resize.ts`（純関数：縮める大きさの計算）、`src/components/attachments/AttachmentPanel.tsx`（ドロップ枠・3 つのボタン・一覧・チェック）、`src/components/attachments/AttachmentThumbs.tsx`、`src/components/attachments/Lightbox.tsx`、`src/components/attachments/compress.ts`（ブラウザで縮める：createImageBitmap の imageOrientation で向きを正す、canvas → toBlob('image/jpeg', 0.8)。HEIC はブラウザが読めればそのまま、読めなければ「この形式の写真は付けられません。スクリーンショットか JPEG で付けてください」）
- Modify: `src/components/report/ReportForm.tsx`（日報の「写真・資料」欄）、`IssueBanner.tsx` と件の一覧（件ごとの「＋ 写真・見積書・リンクを付ける」と印「見積書あり／なし」「写真 N」「リンク N」。協力会社には見積書の印とファイルのボタンを出さない）、日報画面と件の一覧の props の読み込み（`form-props.ts`）
- Modify: `src/content/guide/photos.md`（写真の添付の章を書く）、`input.md`
- Test: `tests/calc/image-resize.test.ts`

**Interfaces:**
- Consumes: Task 3 の操作。
- Produces: `fitWithin(width: number, height: number, maxLong = 1600): { width: number; height: number }`（縮めるだけ、拡大しない、整数）。`<AttachmentPanel target={{ siteId, reportId } | { siteId, issueId }} attachments={Attachment[]} canAddFiles={boolean} locked={boolean} />`。

- [ ] **Step 1: テスト**：`fitWithin(4032, 3024)` → `{1600, 1200}`、`fitWithin(3024, 4032)` → `{1200, 1600}`、`fitWithin(800, 600)` → そのまま、`fitWithin(5000, 10)` → 長い辺 1600・短い辺 1 以上。添付の印の数え方の純関数（file の有無、写真・リンクの数）。
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**（提出後の日報は追加・削除のボタンを出さず「提出後は足せません（忘れたら修正を申請）」、チェックだけ残す）→ **Step 4:** test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(attachments): 写真・ファイル・リンクの添付と表示（写真は自動で軽く）`

---

## 第 3 段階：お客様のサインとお客様用日報 PDF

### Task 5: サイン（保存・固定・取り消し・サインした時点の PDF）

**Files:**
- Create: `supabase/update_2026-11-10_client_signature.sql`、`src/components/report/SignaturePad.tsx`（pointer events で描く、書き直す・サインを保存、高さ 190px 以上、横向き可）、`src/app/api/reports/signed/route.ts`（サインした時点の PDF を開く）
- Modify: `supabase/schema_genba.sql`（gn_daily_reports にサインの列、ガード）、`verify_rls_auto.sql`、`src/lib/db/reports-actions.ts`（`saveClientSignature`・`revokeClientSignature`、既存の `recordClientConfirmation`・`clearClientConfirmation` はサインがあれば拒否）、お客様確認の欄の画面
- Test: `tests/report/signature.test.ts`

**Interfaces:**
- DB 列：`client_signature_path text`、`client_signed_at timestamptz`、`client_signed_by uuid`（サインを保存した操作者）、`client_signed_pdf_path text`、`client_signature_revoked_at`、`client_signature_revoked_by`、`client_signature_revoke_reason text`。ガード：サインの列は「未設定 → 設定」の 1 回だけ（どの状態の日報でも）、設定済みの間は client_confirmed_* も変えられない、取り消し（revoked_* を入れ、path を null に）は管理者だけで理由必須。取り消した PDF は path を `client_revoked_pdfs` などに残す（作り手に任せる。消さない）。
- Produces: `saveClientSignature(reportId: string, input: { confirmedBy: string; note?: string; pngBase64: string }, expectedUpdatedAt?): Promise<ClientConfirmationResult>`（確認者・日時・メモを記録 → サイン画像を `gn-photos/<site_id>/sign/<report_id>.png` → Task 6 の `renderClientDailyPdf` で PDF を作り `gn-exports/<site_id>/signed/<report_id>-<timestamp>.pdf` に保存 → 列を入れる。途中で失敗したら列を入れない）、`revokeClientSignature(reportId, reason)`（管理者）。
- Consumes: Task 6 の `renderClientDailyPdf(reportId: string): Promise<Buffer>`（Task 6 を先に作るか、Task 5 で既存の PDF 生成から切り出して Task 6 で写真を足す。順番は Task 6 → Task 5 でもよい）。

- [ ] **Step 1: テスト**：サインの入力（確認者 1〜100 文字、PNG の base64 で 2MB まで、空の絵［描いていない］を拒否「サインを書いてください」）、取り消しの理由必須、サイン済みなら記録し直し・取り消しを拒否する判定の純関数。
- [ ] **Step 2: 失敗を確認** → **Step 3: SQL**（verify：サインは 1 回だけ入る、担当者は消せない、管理者は理由付きで取り消せる、承認解除でサインの列が残る）→ **Step 4: 実装** → **Step 5:** test・tsc・lint・build
- [ ] **Step 6: コミット** `feat(report): お客様のサインとサインした時点の PDF`

### Task 6: お客様用日報 PDF の写真とサイン欄・見本・記録

**Files:**
- Modify: `src/lib/reports/client-daily-sections.ts`（その日の写真：日報の写真で client_visible、その日（attached_on）に件へ付けた写真で client_visible、やり直しの件は除く。写真の下の文：件があれば「MM/DD-番号 ひと言」）、`src/lib/pdf/client-daily-report.tsx`（写真 1 行 2 枚・4:3・写真の下に文、続きは次ページ、サイン欄 高さ約 3cm・wrap={false}、サインがあれば画像）、`src/app/api/reports/daily/route.ts`（写真を Storage から読んで渡す）、`renderClientDailyPdf` を切り出す場所（`src/lib/reports/client-daily-render.ts`）
- Modify: ガイド `approval.md`（サインのもらい方・取り消し）、`pdf.md`（お客様用日報の写真とサイン）、README（3 段階の SQL の順番）、記録文書 `docs/superpowers/plans/2026-10-30-phase1-record.md`
- Test: `tests/reports/client-daily-sections.test.ts`

**Interfaces:**
- Consumes: Task 3 の `Attachment`、Task 5 のサインの列。
- Produces: `clientDailyPhotos(model, attachments: Attachment[], issues): ClientPhoto[]`（`ClientPhoto = { attachmentId, caption: string }`、並びは件番号順 → 日報の写真）、`renderClientDailyPdf(reportId: string): Promise<Buffer>`。

- [ ] **Step 1: テスト**：チェックなしの写真・ファイル・リンク・やり直しの件の写真・別の日に付けた写真が入らない、件の写真の文に件番号が付く、写真 0 枚なら写真の節を出さない、サインがあれば画像の参照・なければ空欄 3 つ（既存）。所属・会社名・金額の文字が出ないこと（既存のテストを写真ありで再確認）。
- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: 見本 PDF**：写真 0・1・3・8 枚とサインありの PDF を作り、PNG にして崩れを確認し、利用者に見せる印刷イメージとして `docs/superpowers/samples/` に置く（コミットしない場合は場所を報告）。
- [ ] **Step 5:** test・tsc・lint・build → **Step 6: コミット** `feat(pdf): お客様用日報に写真とサイン欄`

---

## 段階ごとの区切り

- 第 1 段階（Task 1・2）が終わったら：レビュー → SQL（`update_2026-11-08_…`）を利用者が実行 → push。
- 第 2 段階（Task 3・4）：同じ（`update_2026-11-09_…`）。
- 第 3 段階（Task 6 → 5 の順でもよい）：同じ（`update_2026-11-10_…`）。印刷イメージの見本を利用者に確認してもらう。
- 全体の最終レビューは各段階の最後に行う（段階ごとに本番へ出すため）。

---

## 第 4 段階：お客様用の確認画面と、件ごとのお客様確認（2026-11-08 追加）

設計書の「追加（利用者 2026-11-07）：お客様用の確認画面と、件ごとのお客様確認」が正。

### 第 4 段階の Global Constraints（上の共通の決まりに加えて）
- お客様用の確認画面に出してよいもの：現場名・日付・天候、本日の施工内容（区分・工種・施工内容・数量・単位）、人工の合計（作業員 N 名・合計 M 人工）、確認してもらう件の一覧（件番号・種別はお客様向けの表示名 `CLIENT_ISSUE_KIND_LABELS`・本文・状態・見積書あり・写真の数）、チェックした写真、確認者・メモ・サインの枠。**出さないもの**：日当・労務費・作業員の氏名と時間・買掛・燃料・リース・原価・提案額・精算の金額・所属・会社名・連絡事項・社内のメモ・社内の操作ボタン。
- 件の状態のお客様向けの表示名：見積中＝「お見積り中」、対応中＝「対応中」、完了＝「完了」。
- 確認してもらう件の候補：その日報の件＋その現場の見積中・対応中の件（やり直しの件は除く）。初めは全部に印（外せる）。「この件の確認をもらう」から開いたときは、その件だけに印。
- 確認画面から社内の画面に戻るのは、保存したとき、または「社内の画面に戻る」を 1.5 秒長押ししたときだけ（お客様が誤って開かない）。
- サインを保存したら、印を付けた件ごとに「お客様確認済み（その日報の日付・確認者・日時）」を記録する（同じ処理の中で。サインが保存できなければ記録もしない）。管理者がサインを取り消したら、そのサインでの件の確認も「取り消し」にする（消さない）。
- 件の印「お客様の確認：未／確認済み 11/06」は、取り消されていない確認のうち最新の日付。社内の画面（黄色い枠・件の一覧）にだけ出す。

### Task 7: 件ごとの確認の記録・保存の処理・PDF の件の一覧（DB・操作・帳票）

**Files:**
- Create: `supabase/update_2026-11-13_issue_client_confirmations.sql`
- Modify: `supabase/schema_genba.sql`、`supabase/verify_rls_auto.sql`、`src/lib/db/reports-actions.ts`（`saveClientSignature` に件の id の一覧）、`src/lib/report/client-signature.ts`（入力の型・検証）、`src/lib/reports/client-daily-sections.ts`（件の一覧の節）、`src/lib/pdf/client-daily-report.tsx`、`src/lib/reports/client-daily-render.ts`（確認してもらう件を受け取る・サイン済みは記録から読む）、`src/lib/db/reports.ts`（件ごとの最新の確認の読み込み）
- Test: `tests/report/issue-confirmations.test.ts`、`tests/reports/client-daily-sections.test.ts`

**Interfaces:**
- DB：新表 `gn_issue_client_confirmations(id, issue_id → gn_report_issues on delete cascade, report_id → gn_daily_reports, site_id, confirmed_on date［日報の日付］, confirmed_by text, signed_at timestamptz, created_by uuid, revoked_at timestamptz null, revoked_by uuid null, unique(issue_id, report_id))`。名前付きの制約は `<table>_<column>_check` と重ならない名前にする。RLS：現場メンバーが読める。書き込みは関数だけ（insert/update/delete のポリシーを作らない）。
- `gn_save_client_signature` に `p_issue_ids uuid[] default '{}'` を足す（古い 7 引数版は drop してから作る）。件はすべてその日報の現場の件で、やり直しでないこと（違えば `invalid_issue`）。サインの列を入れるのと同じ処理で、件ごとに確認の行を入れる。`gn_revoke_client_signature` は、その日報の確認の行に revoked_at・revoked_by を入れる。
- `saveClientSignature(reportId, { confirmedBy, note, signaturePath, issueIds: string[] }, expectedUpdatedAt?)`（issueIds は最大 50）。サインした時点の PDF にも件の一覧を載せる（`renderClientDailyPdf(reportId, { …, issueIds })`）。
- `listIssueConfirmations(issueIds: string[]): Promise<Map<string, { confirmedOn: string; confirmedBy: string }>>`（取り消されていない最新）。
- `clientDailyIssueList(issues, attachmentsByIssue, selectedIds): ClientIssueRow[]`（純関数。`ClientIssueRow = { number: string; kindLabel: string; body: string; statusLabel: 'お見積り中' | '対応中' | '完了'; hasEstimate: boolean; photoCount: number }`、並びは件の日付 → 番号）。PDF の「確認していただく件」の節（表：件・種別・内容・状態・見積書・写真）。サイン済みの日報の通常のお客様用 PDF は、記録された件（取り消しなし）を載せる。サインの無い日報は、その日報の件だけ（いまと同じ範囲）。

- [ ] **Step 1: テスト**：`clientDailyIssueList` の表示名・並び・見積書あり・写真の数、やり直しの件は入らない。社内の言葉（所属・自社・協力会社・金額・提案額・日当）が出ない。入力の検証（issueIds が uuid、50 件まで、重複を除く）。
- [ ] **Step 2: 失敗を確認** → **Step 3: SQL**（verify：件の確認が入る、他の現場の件は `invalid_issue`、直接 insert はできない、取り消しで revoked になる、協力会社も自分の現場なら読める）→ `npm run check:sql`
- [ ] **Step 4: 実装** → **Step 5:** test・tsc・lint・build、見本 PDF（件 3 件・写真 2 枚・サインあり）を作って確かめる
- [ ] **Step 6: コミット** `feat(report): 件ごとのお客様確認の記録と、PDF の確認していただく件`

### Task 8: お客様用の確認画面・件の印とボタン・ガイド

**Files:**
- Create: `src/app/(app)/sites/[siteId]/reports/[date]/client/page.tsx`（お客様用の確認画面。社員・管理者・その現場の協力会社。完了現場でも開ける＝サインはどの状態でも）、`src/components/report/ClientConfirmView.tsx`（施工内容・人工の合計・件の選択・写真・確認者・メモ・サインの枠・保存）、`src/components/report/LongPressButton.tsx`
- Modify: `src/components/report/ClientSignature.tsx`（「サインをもらう」で確認画面へ移る。いまのその場のサインの枠はやめる）、`src/components/report/IssueBanner.tsx` と件の一覧（件の印「お客様の確認：未／確認済み 11/06」と「この件の確認をもらう」）、`src/lib/report/form-props.ts`（件の確認の読み込み）、ガイド `approval.md`・`input.md`・`pdf.md`、README（SQL の順番）、記録文書
- Test: 純関数（候補の件の作り方・初めの印・表示名、長押しの判定）

**Interfaces:**
- Consumes: Task 7 の `saveClientSignature`（issueIds）、`listIssueConfirmations`、`clientDailyIssueList`、既存の `SignaturePad`。
- Produces: URL `/sites/[siteId]/reports/[date]/client?issue=<issueId>`（issue があればその件だけに印）。`clientConfirmCandidates(reportIssues, openIssues): Issue[]`（重複を除く・やり直しを除く・並び）、`initialSelection(candidates, focusIssueId?): Set<string>`。

- [ ] **Step 1: テスト** → **Step 2: 失敗を確認** → **Step 3: 実装**（確認画面は画面全体を使い、下のタブバー・ヘッダーの社内の操作を出さない。保存したら元の日報画面へ。日報が未保存なら「先に下書き保存してください」で開けない。375px・44px。横向き可）→ **Step 4:** test・tsc・lint・build
- [ ] **Step 5: コミット** `feat(report): お客様用の確認画面と件ごとの確認の印`

### 第 4 段階の区切り
- Task 7 → 8 の順。最終レビュー（Fable）→ SQL（`update_2026-11-13_…`）を利用者が実行 → push。
