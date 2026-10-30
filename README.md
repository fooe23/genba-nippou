# 現場日報アプリ（genba-nippou）

建設現場の日報を、スマホから入力・提出・承認し、月次・原価・出面を集計するアプリ。
既存の業務日報アプリと同じ Supabase プロジェクト（Auth と `profiles`）を共用し、現場日報用のテーブルは `gn_` 接頭辞で追加する。

## 概要

**第1計画（本リポジトリの現在の範囲）で実装済み**

- ログイン／ホーム／現場詳細（カレンダー・現場サマリー）
- 日報入力（6表・前回コピー・下書き保存・提出）
- 承認（承認・差戻し・承認解除・未承認バッジ）
- 重要事項の件管理
- 集計（月次・原価・出面・作業員別累計）
- 管理（現場・担当者・現場で使うマスター・繰越初期値／マスター6種・単価履歴）
- アプリ内ガイド（`/guide`）

**第2〜4計画は未実装**（Excel出力、積算連携、PDF・写真・マスターExcel取り込み）。計画の全体像は `docs/superpowers/plans/README.md`、設計は `docs/superpowers/specs/2026-10-30-genba-nippou-design.md`。

## 構成

| 層 | 技術 |
|---|---|
| フロント／サーバー | Next.js 16（App Router）、React 19、TypeScript |
| スタイル | Tailwind CSS 4（スマホ優先） |
| 認証・DB・ファイル | Supabase（Auth、PostgreSQL＋RLS、Storage） |
| 公開 | Vercel（GitHub への push で自動デプロイ） |
| Excel出力・積算PDF読み取り | Python 関数（`api/python/`）は第2計画で追加。現時点では存在しない |

## ディレクトリ構成

```
src/app/            画面（(auth)=ログイン、(app)=ホーム・sites・approvals・admin・guide）
src/components/     画面部品（report, site, sites, approval, summary, masters）
src/lib/            calc=計算, db=Supabase 読み書き, report=日報フォーム, supabase=クライアント
src/content/        アプリ内ガイドの本文
src/proxy.ts        ログイン状態の確認（未ログインは /login へ）
supabase/           schema_genba.sql（スキーマ）、add_profile_account_type.sql（profiles の区分列）、fix_profiles_guard.sql（既存 profiles の保護）、verify_rls.md（権限の確認手順）
tests/              Vitest
scripts/            check-sql.mjs（SQL の構文検査）
templates/          Excel 雛形（第2計画で使用）
docs/superpowers/   設計書・実装計画
```

## ローカル開発

前提：Node.js 22（`.nvmrc`。`nvm use` で切り替え可）。

```bash
npm install
cp .env.example .env.local   # 値を入れる（下記）
npm run dev                  # http://localhost:3000
```

`.env.local` に Supabase ダッシュボードの Project Settings → API の値を入れる。

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

`SUPABASE_SERVICE_ROLE_KEY` は第1計画では使わない。`.env*` は git に入らない（`.env.example` のみ追跡）。

| コマンド | 内容 |
|---|---|
| `npm test` | Vitest（単体テスト） |
| `npm run lint` | ESLint |
| `npm run build` | 本番ビルド（型検査を含む） |
| `npm run check:sql` | `supabase/*.sql`（`schema_genba.sql`・`add_profile_account_type.sql`・`fix_profiles_guard.sql`）の構文検査（DB には接続しない） |

## Supabase の準備

既存の業務日報アプリと同じプロジェクトを使う。

1. SQL Editor → New query に `supabase/schema_genba.sql` を全部貼り付けて Run。何度実行しても安全で、既存アプリのテーブルは変更されない。`gn_` テーブル、RLS、Storage バケット（`gn-estimates` `gn-photos` `gn-exports`）が作られる。
2. `supabase/add_profile_account_type.sql` を実行する（`profiles` に区分 `account_type`［社員 `employee`／協力会社 `partner`］と会社名 `company_name` の列を追加する。協力会社の職長は現場日報専用のアカウントで、業務日報アプリ側は別途修正する。何度実行しても安全。`fix_profiles_guard.sql` がこの列を参照するので、必ず先に実行する）。
3. 次章「既存アプリの profiles 保護（必須）」の `supabase/fix_profiles_guard.sql` を実行する。
4. 最初の管理者：SQL Editor で `update public.profiles set is_admin = true where email = '<管理者のメール>';` を実行する（SQL Editor からの変更は手順3の保護の対象外なので通る）。以降の担当者の割り当ては管理画面から行う。
5. `supabase/verify_rls.md` の手順で権限を確認し、結果をチェックボックスに記録する（担当外の現場が見えないこと、承認権限など。管理者アカウントが必要なので手順4の後に行う）。共用プロジェクトに検証用の現場（検証現場X／Y）などのテスト行を作るため、最後の「7. 後片付け」で必ず削除する。
6. 公開後に Authentication → URL Configuration を設定する（「GitHub と Vercel」の手順 4）。

## 既存アプリの profiles 保護（必須）

既存の業務日報アプリの `profiles` の更新ポリシー（`profiles_update using (id = auth.uid() or public.is_admin())`）には `with check` が無い。そのため、ログインできる人なら誰でも、ブラウザから Supabase の API を直接呼んで自分の `is_admin` を `true` に書き換えられる（管理者への自己昇格）。現場日報アプリは `is_admin` で全現場の閲覧・承認・マスター管理を許すので、この穴は現場日報アプリにとっても致命的になる。

`supabase/fix_profiles_guard.sql` は、既存のポリシーには手を付けず、`profiles` にトリガー（`gn_profiles_guard`）を1つ追加して「管理者以外のアプリ利用者が `is_admin` を変える・`is_admin = true` の行を作る」ことだけを `is_admin_locked` で止める。名前などほかの列の更新、SQL Editor・service_role からの変更、既存アプリの security definer 関数からの変更はこれまでどおり通る。

- SQL Editor で1回だけ実行する（何度実行しても安全）。
- `profiles` は既存アプリと共用のテーブルなので、適用するかどうかはプロジェクトの管理者（既存アプリの持ち主）が決める。適用前に既存アプリの動作（プロフィール編集・管理者による権限変更）に影響がないことを確認すること。
- 確認手順は `supabase/verify_rls.md` の「8. 既存 profiles の保護」。

## GitHub と Vercel

1. GitHub でプライベートリポジトリ（例：`genba-nippou`）を作る。README・.gitignore は追加しない（空で作る）。
2. ローカルで接続して push する。マージ前は `phase1` ブランチ、`main` へマージ後は `main`。
   ```bash
   git remote add origin <リポジトリURL>
   git branch --show-current   # phase1 と表示されることを確認
   git push -u origin phase1
   ```
3. Vercel → Add New → Project → GitHub のリポジトリを Import。Framework は Next.js のまま。Environment Variables に次の2つを設定して Deploy する。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`（`sb_publishable_…`）
   - `main` へのマージ前に公開する場合は、Settings → Git の Production Branch を `phase1` にしておく。
4. Supabase の Authentication → URL Configuration で、Site URL に本番URL（`https://<project>.vercel.app`）を設定し、Redirect URLs に `https://<project>.vercel.app/**` を追加する。プレビュー環境も使うなら `https://*-<team>.vercel.app/**` も追加する。

## 本番確認チェックリスト

スマホで公開URLを開いて確認する。

- [ ] ログインできる（既存アプリと同じアカウント）
- [ ] ホームに担当現場が表示される
- [ ] 現場詳細を開き、カレンダーが表示される
- [ ] 日報を1件入力できる（6表）
- [ ] 下書き保存し、開き直して内容が残っている
- [ ] 提出できる（状態が「承認待ち」になる）
- [ ] 承認者のアカウントで承認画面に表示され、承認できる
- [ ] 集計（月次・原価・出面）に反映されている
- [ ] 担当外の現場が見えない（担当外のアカウントで確認）

確認日：____年__月__日　確認者：__________　URL：__________

## 既知の制約

- 未実装：Excel出力、PDF出力、積算書の取り込みと連携、写真の添付（第2〜4計画）。
- マスターのExcel取り込みは未実装（第4計画）。
- 1現場につき1日1枚の日報。
- Storage のオブジェクトパスは先頭を `<site_id>/…` にする。RLS が先頭要素の現場IDで権限を判定するため、この規約を外れるとアクセスできない。
- 作業内容の行は手入力のみ（積算内訳からの選択は第3計画）。
