# 第1計画の追補：協力会社アカウントと日当の自動更新 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 社員情報（共有の `profiles`）に「社員／協力会社」の区分を持たせ、協力会社の職長アカウントを現場日報アプリの管理画面から作成できるようにする。業務日報アプリには協力会社を表示させず、ログインも通さない。あわせて、日報画面を開いたときに未設定の日当を最新の履歴から自動で引き直す。

**Architecture:** `profiles` に列を2つ追加するSQL（冪等）。現場日報は既存の Edge Function `admin-action`（業務日報アプリが使っているアカウント作成処理）を管理者のセッションで呼び、作成後に `profiles` の区分と会社名を更新する。業務日報アプリ（単一HTML）は区分で除外・遮断する2箇所の修正。

**Spec:** `docs/superpowers/specs/2026-10-30-genba-nippou-design.md` §2（権限）に、利用者の決定（2026-10-31）を追補するもの。

## Global Constraints
- `profiles` への変更は列追加のみ（`add column if not exists`）。既存の列・ポリシー・既存アプリの動作を壊さない。
- 区分値：`account_type text not null default 'employee'`、許容値 `'employee' | 'partner'`。会社名：`company_name text`。
- 協力会社（partner）の現場の役割は `staff` のみ（reviewer / approver 不可）。サーバー側でも検査する。
- 管理者以外は `account_type` / `company_name` を変更できない（`gn_profiles_guard` を拡張）。
- Server Action は `{ ok, ... } | { ok: false, error }` を返し、throw しない。UI は日本語、375px、44px。
- 業務日報アプリ側の修正は `日報アプリ_本番.html` と同一内容の `index.html` の両方に同じ変更を入れる（どちらも `/Users/apple/Documents/Claude/Projects/アプリ開発_業務報告(日報）/`。git 管理外）。
- 現場日報アプリのURLはまだ未確定なので、業務日報側は先頭の定数 `GENBA_NIPPOU_URL = ''` を置き、空なら URL を表示しない。

## Review Focus
- 協力会社の職長が自分の `account_type` を `employee` に書き換えて業務日報に入る → ガードで拒否されること（Task A）。
- 協力会社を reviewer/approver に割り当てる → サーバーで拒否、UI では選べないこと（Task B）。
- Edge Function が 403（管理者でない）/400（メール重複）を返した時、画面に日本語で理由が出ること（Task B）。
- 日報画面で日当 null の行が、履歴に有効な日当があれば開いた時に埋まり、履歴が無ければ「未設定」のままであること（Task B）。
- 業務日報で partner がログイン → 画面に入れず案内が出てサインアウトされること（Task C）。

---

### Task A: profiles の区分列とガード拡張（SQL）
**Files:** Create `supabase/add_profile_account_type.sql`; Modify `supabase/fix_profiles_guard.sql`, `supabase/verify_rls.md`, `README.md`（適用手順に追加）
- `alter table public.profiles add column if not exists account_type text not null default 'employee';` `add column if not exists company_name text;` 制約は `do $$ ... if not exists (select 1 from pg_constraint where conname='profiles_account_type_check') then alter table ... add constraint profiles_account_type_check check (account_type in ('employee','partner')); end if; $$;`
- `gn_profiles_guard`：管理者以外が `account_type` / `company_name` を旧値から変えたら `account_type_locked`（insert で partner を指定するのも同様）。既存の `is_admin_locked` と同じ流儀。
- `npm run check:sql` が両ファイルを通ること。`verify_rls.md` に「一般ユーザーが自分の account_type を変えると account_type_locked」を追加。
- Commit: `feat(db): profiles に協力会社区分を追加しガードで保護`

### Task B: 現場日報：アカウント管理画面・担当者の区分表示・日当の自動更新
**Files:** Modify `src/lib/db/profile.ts`（`Profile` に `accountType`, `companyName`）, `src/lib/db/sites.ts`（`listProfiles` に区分・会社名）, `src/lib/db/sites-actions.ts`（`setSiteMember`：partner は `staff` 以外を拒否 `協力会社は担当のみ割り当てできます`）, `src/components/sites/*`（担当者候補に「氏名（協力会社：会社名）」表示、partner 選択時は役割を担当に固定）, Create `src/lib/db/accounts.ts` / `src/lib/db/accounts-actions.ts` / `src/app/(app)/admin/accounts/page.tsx` / `src/components/accounts/*`; Modify `src/app/(app)/admin/masters/page.tsx` と `admin/sites/page.tsx` のサブナビに「アカウント」を追加; Modify `src/components/report/ReportForm.tsx` または `form-state.ts`（初期化時に `refreshFromMasters` 相当で `dailyRate`/`unitPrice`/`kmPerL` が null の行だけ補完）; `src/content/guide/input.md`（適用開始日の注意）, `src/content/guide/approval.md`（協力会社の権限）
- `accounts.ts`：`listAccounts(): { id, name, email, isAdmin, accountType, companyName }[]`（管理者のみ、名前順）。
- `accounts-actions.ts`：`createPartnerAccount({ companyName, name, email, password })` → `requireAdmin()` → Zod（会社名1..100、氏名1..100、メール形式、パスワード8..72）→ `supabase.functions.invoke('admin-action', { body: { action: 'create', email, password, name, emp_code: null, is_admin: false } })` → 返り値の `id` で `update profiles set account_type='partner', company_name` → `{ ok: true, id }`。Edge Function のエラー文は日本語（既存：「管理者権限が必要です」「メールとパスワードは必須です」、Supabase の英語メッセージは `メールアドレスが既に登録されています` 等に変換、不明は原文）。`resetPartnerPassword(userId, password)` → `action: 'reset-password'`。`updateAccountType(userId, accountType, companyName)`（管理者が社員⇄協力会社を直せる）。
- 画面 `/admin/accounts`：一覧（氏名・メール・区分バッジ・会社名・管理者）、「協力会社アカウントを追加」ダイアログ（会社名・氏名・メール・初期パスワード、注意文「業務日報アプリにはログインできません」）、各行に「パスワード再設定」。社員の追加は行わない（業務日報アプリ側で行う旨の注記）。
- 日当の自動更新：日報ページ初期化時、`dailyRate === null` の労務行・`unitPrice === null` のリース行・`kmPerL === null` の車両行にだけ `rateAt(…, date)` 等を当てる（値がある行は保存時のスナップショットを尊重）。テストを `tests/report/` に追加。
- Commit: `feat(admin): 協力会社アカウントの作成・担当者の区分表示・日当の自動補完`

### Task C: 業務日報アプリ側の除外と遮断（HTML 2ファイル）
**Files:** Modify `/Users/apple/Documents/Claude/Projects/アプリ開発_業務報告(日報）/日報アプリ_本番.html` と `index.html`（同一内容。両方に同じ差分）
- 先頭の script に `const GENBA_NIPPOU_URL = '';` を追加。
- `afterLogin()`：`prof.account_type === 'partner'` なら `app` を表示せず、ログイン画面に「このアカウントは現場日報専用です。」（URL があればリンク）を表示して `sb.auth.signOut()`。
- `loadProfilesMap()`：select に `account_type` を加え、`partner` を除外（`.neq('account_type','partner')` は null 行を落とすので、取得後に JS で `p.account_type !== 'partner'` でフィルタ）。
- `select('*')` 済みの箇所はそのまま。
- 動作確認はブラウザで `index.html` をローカルに開くだけでは Supabase 接続できる（anon キー埋め込み）ので、`open index.html` で partner 以外のログインが従来どおり動くことを目視（利用者が行う）。
- Commit 不可（git 管理外）。変更点を `アプリ開発_業務報告(日報）/変更履歴_2026-10-31.md` に記録。Vercel への再デプロイは利用者が行う（既存の配信方法に従う）。
