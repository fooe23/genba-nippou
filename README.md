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
supabase/           schema_genba.sql（スキーマ）、verify_rls.md（権限の確認手順）
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
| `npm run check:sql` | `supabase/schema_genba.sql` の構文検査（DB には接続しない） |

## Supabase の準備

既存の業務日報アプリと同じプロジェクトを使う。

1. SQL Editor → New query に `supabase/schema_genba.sql` を全部貼り付けて Run。何度実行しても安全で、既存アプリのテーブルは変更されない。`gn_` テーブル、RLS、Storage バケット（`gn-estimates` `gn-photos` `gn-exports`）が作られる。
2. `supabase/verify_rls.md` の手順で権限を確認し、結果をチェックボックスに記録する（担当外の現場が見えないこと、承認権限など）。
3. 最初の管理者：SQL Editor で `update public.profiles set is_admin = true where email = '<管理者のメール>';` を実行する。以降の担当者の割り当ては管理画面から行う。
4. 公開後に Authentication → URL Configuration を設定する（次章の手順 3）。

## GitHub と Vercel

1. GitHub でプライベートリポジトリ（例：`genba-nippou`）を作る。README・.gitignore は追加しない（空で作る）。
2. ローカルで接続して push する。マージ前は `phase1` ブランチ、`main` へマージ後は `main`。
   ```bash
   git remote add origin <リポジトリURL>
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
- 1現場につき1日1枚の日報。
- Storage のオブジェクトパスは先頭を `<site_id>/…` にする。RLS が先頭要素の現場IDで権限を判定するため、この規約を外れるとアクセスできない。
- 作業内容の行は手入力のみ（積算内訳からの選択は第3計画）。
