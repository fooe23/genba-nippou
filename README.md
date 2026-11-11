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

**第2計画（改）で追加**

- 出力画面（現場 → 出力）と現場管理台帳（Excel。2026-11-11 からアプリの計算で作る .xlsx）のダウンロード
- 工事原価集計表（PDF・Excel・CSV）と日報（PDF・CSV）の出力
- 作業員・買掛の仕入先の「（手入力）」、1 日分の雛形（Excel）からの日報の取り込み
- 追加・増・変更・減の記録（作業内容の区分・指示者・根拠の件、件の種別、現場の契約状態［確定・未確定］と概算金額、経費率・利益率）、変更増減 精算資料（客先用「精算のご提案（案）」と社内確認用。PDF・Excel）、お客様用の日報 PDF（金額なし）、日報の客先確認の記録と日報 PDF の客先確認欄
- 追加・変更の件ごとの精算：画面「追加・変更の一覧」（`/sites/[siteId]/changes`。現場 → 「追加・変更」。社員・管理者のみ、完了現場は閲覧のみ）で件の精算方法［未定・一式・常用］・確定額・常用単価・確定日を入れる。精算資料の「精算額」「件ごとの精算」（客先向けに実績原価は出さない）、現場の常用単価の既定、PDF の「プレビュー」と「ダウンロード」

**作業員の所属（2026-11-07）**

- 作業員の所属（自社／協力会社）と、協力会社の作業員の行の「常用／請負」。協力会社は取引先（買掛の相手先）と印で分け（マスターの「協力会社」タブ）、買掛の選択肢に出さない
- 現場の「協力会社と作業員」（`/sites/[siteId]/partners`。現場 → 「協力会社と作業員」。社員・管理者のみ、完了現場は閲覧のみ）：会社の追加・請負金額、会社ごとの作業員の現場登録、その会社の作業員の新規登録（作業員マスター・日当・現場の登録を 1 回で）、ほかの現場からのコピー
- 工事原価集計表の ④ の所属列と ④-2 所属別（常用・請負・請負金額との差額）、変更増減 社内確認用と追加・変更の一覧の所属別の人工（社内用だけ。客先用には出さない）

**積算連携（2026-11-09〜）**

- 現場の「実行予算・受注の内訳」（`/sites/[siteId]/budget/setup`。社員・管理者のみ、完了現場は閲覧と書き出しのみ）：工種・実行予算（工種 × 施工者）・受注の内訳の入力、Excel 雛形の取り込みと書き出し、日報の工種の読み替え表
- 日報の作業内容の行で工種を実行予算の工種から選ぶ（＋手入力）。1 日分の Excel の取り込みも読み替え表で工種を当てる
- 現場の「予算と実績」（`/sites/[siteId]/budget`。社員・管理者のみ、協力会社は 404）：工種ごとの内訳の金額・実行予算・実績・進み具合（数量から／% の上書き）・このままの見込み・見込みの粗利・判定、予算外の作業（繰越初期値を含む）・現場全体・合計、工種ごとの施工者の行と日報の作業。% の上書きは管理者とその現場の確認者・承認者だけ（履歴つき）。SQL は `update_2026-11-15_budget.sql` のまま（追加なし）
- 予算と実績の集計 Excel（`GET /api/budget/report?site=<id>`。社員・管理者のみ、協力会社は 403）：① 予算と実績 ② 工種×施工者 ③ 日々の実績 ④ 月別の推移 ⑤ 出面 ⑥ 受注の内訳と数量 ⑦ 実行予算（取り込み用と同じ形。そのまま取り込み直せる）
- 実行予算・受注の内訳と予算と実績の PDF（`GET /api/budget/pdf?site=<id>&kind=setup|report&disposition=inline|attachment`。社員・管理者のみ、協力会社は 403）：両方の画面の「PDF で見る」（アプリの PDF ビューアー）・「PDF を保存」

**第2〜4計画の残りは未実装**（写真の添付など。積算連携は第 3 段階で予算と実績・実行予算と内訳の PDF と集計 Excel を足す）。計画の全体像は `docs/superpowers/plans/README.md`、設計は `docs/superpowers/specs/2026-10-30-genba-nippou-design.md`。

## 構成

| 層 | 技術 |
|---|---|
| フロント／サーバー | Next.js 16（App Router）、React 19、TypeScript |
| スタイル | Tailwind CSS 4（スマホ優先） |
| 認証・DB・ファイル | Supabase（Auth、PostgreSQL＋RLS、Storage） |
| 公開 | Vercel（GitHub への push で自動デプロイ） |
| Excel出力 | exceljs（Node の Route Handler。現場管理台帳・工事原価集計表など） |
| 積算PDF読み取り | 第3計画で追加。現時点では存在しない |

## ディレクトリ構成

```
src/app/            画面（(auth)=ログイン、(app)=ホーム・sites・approvals・admin・guide、(client)=お客様用の確認画面［ヘッダー・タブバーなし］）
src/components/     画面部品（report, site, sites, approval, summary, masters）
src/lib/            calc=計算, db=Supabase 読み書き, report=日報フォーム, supabase=クライアント
src/content/        アプリ内ガイドの本文
src/proxy.ts        ログイン状態の確認（未ログインは /login へ）
supabase/           schema_genba.sql（スキーマ）、add_profile_account_type.sql（profiles の区分列）、fix_profiles_guard.sql（既存 profiles の保護）、update_2026-10-31_employee_access.sql（社員は全現場に入力可の権限関数）、update_2026-11-02_site_archive.sql（現場の削除・削除ログ・完了現場の書き込み禁止）、update_2026-11-02b_lines_guard_fix.sql（その修正）、update_2026-11-03_labor_rule.sql（人工・残業ルール［V34］・労務の設定・作業員の残業単価・現場の共通時間の既定）、update_2026-11-03c_master_import.sql（マスターの更新者の記録・Excel／CSV 取り込みの RPC・取り込み履歴）、update_2026-11-03d_profile_names.sql（帳票・Excel の作成者・確認者・承認者の氏名を返す関数 gn_profile_names）、update_2026-11-04_change_tracking.sql（追加・変更・減の記録・契約状態・経費率・客先確認の列）、update_2026-11-04b_minus_amount.sql（減の行の金額を負で保存・保存済みの減の再計算）、update_2026-11-04c_client_confirmation.sql（承認済み・完了現場でも客先確認だけは記録できるガードの例外）、update_2026-11-04d_increase_kind.sql（作業内容の区分と件の種別に「増」を足す check 制約の付け直し）、update_2026-11-05_issue_settlement.sql（件ごとの精算の方法・確定額・常用単価・確定日と、現場の常用単価の既定の列）、update_2026-11-05b_issue_settlement_guard.sql（件の精算の項目を協力会社が直接入れたり変えたりできないようにする件のガードの差し替え）、update_2026-11-06_estimate_method.sql（件の精算の方法に「見積」を足す）、update_2026-11-07_worker_affiliation.sql（作業員の所属・常用と請負・現場の協力会社・会社の印［取引先／協力会社］）、update_2026-11-07b_site_partner_worker.sql（現場から協力会社の作業員を新しく登録する関数）、update_2026-11-08_issue_estimating_fix_request.sql（件の状態「見積中」・確認者と承認者の承認解除・修正申請）、update_2026-11-09_attachments.sql（日報・件の添付の台帳 gn_attachments・ガード・RLS、gn-estimates を社員・管理者だけに）、update_2026-11-10_client_signature.sql（お客様のサインの列・保存と取り消しの関数・ガード、サインの画像とサインした時点の PDF を消させない Storage のポリシー）、update_2026-11-11_site_judgment.sql（件の種別に「現場判断（要協議）」、指示方法に「指示なし（現場判断）」を足す check 制約の付け直し・件を提出前と差戻し後に直せる・消せるようにする件のガードの差し替えと削除のガード・削除のポリシー）、update_2026-11-12_issue_report_fixed.sql（件の日報［report_id］を利用者が付け替えられないようにする件のガードの差し替え）、update_2026-11-13_issue_client_confirmations.sql（件ごとのお客様確認の表 gn_issue_client_confirmations・サインの保存に確認していただく件を足す・取り消しで件の確認も取り消し・お客様の確認を受けた件とその件のある日報の削除の禁止・サインの件の一覧の表 gn_report_signature_issue_sets）、update_2026-11-14_estimate_submitted.sql（件の見積提出の記録の列［提出日・記録した人］と、社員・管理者だけが記録できる件のガードの差し替え）、update_2026-11-17_subcontract.sql（外注の買掛の区分と工種・行の根拠の件・うち常用の時間・外注の行を協力会社から隠す RLS・請負の会社の一覧）、update_2026-11-15_budget.sql（積算連携の第 1 段階：現場の工種・受注の内訳・実行予算・読み替え表・進み具合の上書きの表と RLS、日報の作業内容の行の工種の列、まとめて書く関数、全社の設定の「予算の標準日当」）、recalc_2026-11-07_line_affiliation.sql（過去の作業員の行の所属をいまのマスターで写し直す。任意・1 回）、verify_rls.md（権限の確認手順）、verify_rls_auto.sql（手順をまとめた自動検証。実行後は全件取り消される）
tests/              Vitest
scripts/            check-sql.mjs（SQL の構文検査）
templates/          Excel 雛形（1 日分の日報の取り込み・マスターの取り込みのテストで読む）
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
| `npm run check:sql` | `supabase/*.sql`（`schema_genba.sql`・`add_profile_account_type.sql`・`fix_profiles_guard.sql`・`update_2026-10-31_employee_access.sql`・`update_2026-11-02_site_archive.sql`・`update_2026-11-03_labor_rule.sql` など `supabase/` の全 SQL）の構文検査（DB には接続しない） |

## Supabase の準備

既存の業務日報アプリと同じプロジェクトを使う。

1. `supabase/add_profile_account_type.sql` を実行する（`profiles` に区分 `account_type`［社員 `employee`／協力会社 `partner`］と会社名 `company_name` の列を追加する。協力会社の職長は現場日報専用のアカウントで、業務日報アプリ側は別途修正する。何度実行しても安全。`schema_genba.sql` の権限関数と `fix_profiles_guard.sql` がこの列を参照するので、必ず先に実行する）。
2. SQL Editor → New query に `supabase/schema_genba.sql` を全部貼り付けて Run。何度実行しても安全で、既存アプリのテーブルは変更されない。`gn_` テーブル、RLS、Storage バケット（`gn-estimates` `gn-photos` `gn-exports`）が作られる。権限は「社員と管理者は全現場、協力会社は割り当て現場だけ」。既に全体を適用済みなら、権限関数だけを差し替える `supabase/update_2026-10-31_employee_access.sql` を実行すれば足りる（`schema_genba.sql` を再実行しても同じ結果）。
   - **既存環境（2026-11-02 より前に `schema_genba.sql` を適用済み）**：続けて `supabase/update_2026-11-02_site_archive.sql` を実行する（現場の削除［`deleted_at`］・削除ログ［`gn_site_audit_log`］・削除／復元の関数・完了現場の書き込み禁止。何度実行しても安全）。続けて `supabase/update_2026-11-02b_lines_guard_fix.sql` も実行する（明細のある日報の削除が拒否される不具合の修正）。 さらに `supabase/update_2026-11-03_labor_rule.sql`（人工・残業ルールと労務の設定）→ `supabase/update_2026-11-03b_overtime_rate_round.sql`（残業単価の丸めの修正）の順に実行する。 マスター取り込みを使うなら `supabase/update_2026-11-03c_master_import.sql`、出力（原本 Excel・工事原価集計表・日報の PDF／CSV）の作成者・確認者・承認者の氏名を出すために `supabase/update_2026-11-03d_profile_names.sql`（氏名を返す関数 `gn_profile_names`）も実行する。旧ルールで保存した日報を新ルールにそろえたいときは、最後に `supabase/recalc_2026-11-03_labor.sql`（任意・1 回）を実行する。新規環境では `schema_genba.sql` に含まれているので不要。続けて下の「2026-11-04 より前」の 3 本も順に実行する。確認は `supabase/verify_rls.md` の「9. 現場の削除と完了現場」、または `supabase/verify_rls_auto.sql` を SQL Editor で実行して FAIL 0 件を確認する。
   - **既存環境（2026-11-03 より前に `schema_genba.sql` を適用済み）**：`supabase/update_2026-11-03_labor_rule.sql` を実行する（人工・残業ルール［V34］：全社の設定 `gn_settings`、作業員の残業単価、明細の残業列、現場ごとの共通時間の既定、明細の再計算トリガーと `gn_save_report` の差し替え。何度実行しても安全）。**アプリ（2026-11-03 以降の版）をデプロイする前に実行すること**（アプリは新しい列を読むため、未適用だと作業員・現場の一覧が読めない）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql`（3-2 の 4H → 0.53 人工・10,600 円は新しいルールでも同じ値）で FAIL 0 件を確認する。
   - **既存環境（2026-11-03 の取り込み機能より前に `schema_genba.sql` を適用済み）**：`supabase/update_2026-11-03c_master_import.sql` を実行する（作業員・取引先・車両・リース品・単価履歴・労務の設定に更新者 `updated_by` と自動記録のトリガー、取り込みの RPC `gn_import_masters`、取り込み履歴 `gn_import_log`。何度実行しても安全）。未適用でもマスターの一覧・日報は読めるが（更新者は表示されない）、「取り込み」タブの取り込みは失敗する。新規環境では `schema_genba.sql` に含まれているので不要。
   - **既存環境（2026-11-04 より前に `schema_genba.sql` を適用済み）**：`supabase/update_2026-11-04_change_tracking.sql` → `supabase/update_2026-11-04b_minus_amount.sql` → `supabase/update_2026-11-04c_client_confirmation.sql` → `supabase/update_2026-11-04d_increase_kind.sql` の 4 本を実行する。**04 → 04b → 04c → 04d の順に、アプリ（2026-11-04 以降の版）をデプロイする前に実行すること**（04c まで適用済みなら 04d だけ）。どれも何度実行しても安全。新規環境では `schema_genba.sql` に含まれているので不要。
     - **04**（追加・変更・減の区分・指示者・根拠の件、件の種別、現場の契約状態・概算金額、経費率・利益率・会社名、日報の客先確認の列）：SQL より前にアプリをデプロイすると、現場一覧（ホーム）・現場画面・日報・出力がすべて失敗する（アプリが読む列が無い）。
     - **04b**（減の行の金額を負で保存し、保存済みの減の行と日報の出来高を計算し直す）：04 だけ適用して 04b の前に保存した「減」の行は金額が正で保存され、画面の負の表示と食い違う（04b がまとめて計算し直す）。04b の最後の `select` で `positive_left = 0` を確認する。04 より前に実行しない（明細の保存が失敗する）。
     - **04c**（客先確認の3列だけの更新は、承認済み・完了現場でも通すガードの例外）：未適用だと、承認済みの日報や完了現場で客先確認の記録が失敗する（「承認済みのため編集できません」など）。
     - **04d**（作業内容の区分と件の種別に「増」［increase］を足す。check 制約を付け直す）：SQL より前にアプリをデプロイすると、区分「増」の作業内容の行を含む日報の保存と、種別「増（数量増）」の件の追加が check 制約で失敗する（それ以外の保存は通る）。
     - 確認は `supabase/verify_rls_auto.sql`（「10. 客先確認」を含む）で FAIL 0 件。
   - **既存環境（2026-11-05 より前に `schema_genba.sql` を適用済み）**：04d の後に `supabase/update_2026-11-05_issue_settlement.sql` を実行する（重要事項の件に精算の方法［未定・一式・常用］・確定額・常用単価・確定日、現場に常用単価の既定の列を足す。既存の件は「未定」になる。何度実行しても安全）。**アプリ（2026-11-05 以降の版）をデプロイする前に実行すること**：アプリは件と現場を読むときにこの列を名指しで選ぶため、SQL より前にデプロイすると件（日報のバナー・現場画面・集計）と現場（ホーム・現場画面・日報・出力）の読み込みがすべて失敗する。新規環境では `schema_genba.sql` に含まれているので不要。
   - **続けて（05 の後）**：`supabase/update_2026-11-05b_issue_settlement_guard.sql` を実行する（件のガード `gn_report_issues_guard` の差し替え。件の精算の項目［精算の方法・確定額・常用単価・確定日］を入れる［追加で既定以外の値］・変えるのは社員と管理者だけにし、協力会社など［profiles の行が無いユーザーも］が直接しようとすると `not_employee` で止める。何度実行しても安全）。アプリは前から協力会社の精算の変更を拒否しているので、未適用でもアプリは動く（DB 側の保証が無いだけ）。05 より前に実行しない（精算の列が無いまま関数が差し替わり、件の更新がすべて失敗する）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の 6-6c〜6-6f で FAIL 0 件。
   - **既存環境（2026-11-07 より前に `schema_genba.sql` を適用済み）**：`supabase/update_2026-11-06_estimate_method.sql`（未適用なら先に）の後に、`supabase/update_2026-11-07_worker_affiliation.sql` を実行する（作業員の所属［自社・協力会社］、作業員の行の常用・請負とその日の所属の写し、協力会社アカウントの会社、現場の協力会社［`gn_site_partners`。請負金額は任意］、社員による協力会社の作業員の現場登録、使っていない作業員の削除［`gn_delete_worker`］、会社の印［取引先 `is_vendor`・協力会社 `is_partner`］。既存の作業員と、作業員マスターを参照している過去の作業員の行は自社になる。何度実行しても安全）。**アプリ（2026-11-07 以降の版）をデプロイする前に実行すること**：アプリは作業員・取引先・日報の行を読むときに新しい列を名指しで選ぶため、SQL より前にデプロイすると作業員・取引先（マスター・日報の選択肢）と日報の読み込みが失敗する。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「11. 作業員の所属・現場の協力会社・協力会社アカウントの会社」を含めて FAIL 0 件。SQL を実行したら、すぐにアプリをデプロイする（その間に古い版で保存し直した日報は、作業員の行の所属が空［所属なし］になる。そうなったら `recalc_2026-11-07_line_affiliation.sql` で直る）。
   - **続けて（07 の後）**：`supabase/update_2026-11-07b_site_partner_worker.sql` を実行する（現場の「協力会社と作業員」から社員・管理者が協力会社の作業員を新しく登録する関数 `gn_add_site_partner_worker`。作業員マスター・最初の日当・現場の登録を 1 回で作る。何度実行しても安全）。**この機能を含むアプリをデプロイする前に実行すること**（先にデプロイすると「＋ 新しい作業員を登録」がエラーになる。ほかの画面は動く）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「12. 現場からの協力会社の作業員の登録」で FAIL 0 件。
   - **続けて（07b の後）**：`supabase/update_2026-11-08_issue_estimating_fix_request.sql` を実行する（件の状態に「見積中」を足す、その現場の確認者・承認者も承認解除できるようにする日報のガードの差し替え、修正申請の表 `gn_report_fix_requests`。何度実行しても安全）。**この機能を含むアプリをデプロイする前に実行すること**：先にデプロイすると、日報画面・承認画面・承認待ち一覧が修正申請の表を読めずにエラーになる。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「13. 件の見積中・承認解除・修正申請」で FAIL 0 件。
   - **続けて（08 の後）**：`supabase/update_2026-11-09_attachments.sql` を実行する（日報・件の添付［写真・ファイル・リンク］の台帳 `gn_attachments` と、そのガード・RLS。Storage の `gn-estimates`［見積書などのファイル］の読み書きを社員・管理者だけにする。`gn-photos`・`gn-estimates` を 1 つ 10MB まで・置ける種類を絞る。`gn-photos` に置ける場所を写真［`<現場>/att/`］とサイン［`<現場>/sign/`］に絞る。何度実行しても安全）。既知の残り：添付の行を作る前に失敗したときや日報・件を消したときの Storage の実体は消えずに残る（画面には出ない。掃除は今後）。**この機能を含むアプリをデプロイする前に実行すること**：先にデプロイすると、日報画面が添付の表を読めずにエラーになる。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「14. 日報・件の添付」で FAIL 0 件。
   - **続けて（09 の後）**：`supabase/update_2026-11-10_client_signature.sql` を実行する（日報にお客様のサインの列［画像のパス・サインした日時・保存した人・サインした時点の PDF のパス・最後の取り消し・取り消したサインの記録］、サインの保存 `gn_save_client_signature`［現場メンバー・どの状態でも・1 回だけ］と取り消し `gn_revoke_client_signature`［管理者だけ・理由必須］、サインの列を関数以外から変えさせず、サインがある間は客先確認も変えさせない日報のガードの差し替え、サインのある日報の削除の禁止、`gn-photos` の `<現場>/sign/` と `gn-exports` の `<現場>/signed/` を置いた本人・管理者でも上書き・削除できなくする Storage のポリシー、`gn-exports` を読めるのを社員・管理者と［協力会社は自分の現場の `<現場>/signed/` だけ］に絞る［台帳の xlsm などの出力は協力会社に見せない］。何度実行しても安全）。既知の残り：サインの保存が途中で失敗・中断したときの `<現場>/sign/`・`<現場>/signed/` の実体は残り、ポリシーで利用者には消せない（画面には出ない。掃除するときは管理者が Storage の管理画面［service role］で、列にもサインの記録にも無いパスだけを消す）。**この機能を含むアプリをデプロイする前に実行すること**：先にデプロイすると、日報画面・承認画面がサインの列を読めずにエラーになり、お客様用 PDF も作れない（客先確認の記録・取り消しもエラーになる）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「15. お客様のサイン」で FAIL 0 件。
   - **続けて（10 の後）**：`supabase/update_2026-11-11_site_judgment.sql` を実行する（重要事項の件の種別 `gn_report_issues.kind` に `site_judgment`［現場判断（要協議）］、指示方法 `gn_report_issues.instruction_method`・`gn_report_lines.instruction_method` に `site`［指示なし（現場判断）］を足す。各列 1 つだけに掛かる check 制約を探して外し、`<表>_<列>_check` の名前で付け直す。既存の行は変えない。あわせて、件の中身［内容・種別・指示者・指示方法・金額見込み］を変えられるのを件の日報が下書き・差戻しのあいだだけにする件のガード `gn_report_issues_guard` の差し替え［協力会社は自分が作った日報の件だけ］、件の削除のガード `gn_report_issues_delete_guard`［下書き・差戻しだけ・作業内容の行が根拠にしている件と添付のある件は消せない］、件の削除のポリシーを管理者だけから現場メンバーに広げる。何度実行しても安全）。**この機能を含むアプリをデプロイする前に実行すること**：先にデプロイすると、種別「現場判断（要協議）」の件の追加や、指示方法「指示なし（現場判断）」を選んだ件の追加・日報の保存が check 違反で失敗し、件の「直す」は提出後でも通ってしまい（DB が止めない）、件の「消す」は管理者以外「件が見つからないか、権限がありません」になる（それ以外の操作はそのまま動く）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「16. 現場判断の件」「17. 件の直し・削除」で FAIL 0 件。
   - **続けて（11 の後）**：`supabase/update_2026-11-12_issue_report_fixed.sql` を実行する（件のガード `gn_report_issues_guard` の差し替え。アプリの利用者が件の `report_id` を書き換えて、提出済みの日報の件を自分の下書きの日報に付け替え、中身の鍵を外すことを防ぐ［issue_report_fixed］。何度実行しても安全）。アプリは件の日報を変えないので、デプロイとの順番の決まりは無い。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の 17-12 が PASS。
   - **続けて（12 の後）**：`supabase/update_2026-11-13_issue_client_confirmations.sql` を実行する（件ごとのお客様確認の表 `gn_issue_client_confirmations`［現場メンバーが読める。書くのは関数だけ］、サインの保存 `gn_save_client_signature` に確認していただく件 `p_issue_ids` を足す［古い 7 引数の版は消して作り直す］、サインの取り消し `gn_revoke_client_signature` で件の確認も「取り消し」にする［消さない。取り消したサインの記録に件の id も残す］、件の削除のガード `gn_report_issues_delete_guard` の差し替え［お客様の確認を受けた件は消せない。issue_confirmed］、日報の削除のガード `gn_report_delete_guard` の差し替え［お客様の確認を受けた件がある日報は消せない。report_has_confirmed_issue］、いまのサインで確認していただいた件の一覧の表 `gn_report_signature_issue_sets`［日報ごとに 1 行・空でも入る。行の無いサイン＝この SQL より前のサイン］。何度実行しても安全）。**第 4 段階（お客様用の確認画面）のアプリをデプロイする前に実行すること**：先にデプロイすると、サインの保存が「関数が見つからない」（引数の数・型が合わない）エラーで必ず失敗し、日報画面・承認画面が件の確認の表を読めずにエラーになり、お客様用 PDF（通常・サインした時点）も作れない。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「18. 件ごとのお客様確認」で FAIL 0 件。
   - **続けて（13 の後）**：`supabase/update_2026-11-14_estimate_submitted.sql` を実行する（件の見積提出の記録の列 `estimate_submitted_on`［提出日］・`estimate_submitted_by`［記録した人］を足し、件のガード `gn_report_issues_guard` を差し替える［今までの確かめはそのまま。見積提出を入れる・変えるのは社員・管理者だけ＝協力会社は not_employee、日報の状態に関係なくいつでも、完了現場は site_closed。記録した人は記録した本人、提出日を消すと一緒に消える］。何度実行しても安全）。**見積提出の記録のアプリをデプロイする前に実行すること**：アプリは件を読むときに新しい列を読むので、先にデプロイすると件の読み込み（日報・現場・帳票・お客様用の画面）がエラーになる。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「19. 件の見積提出の記録」で FAIL 0 件。
   - **続けて（14 の後）**：`supabase/update_2026-11-15_budget.sql` を実行する（積算連携の第 1 段階。現場の工種 `gn_site_trades`［現場メンバーが読める・社員と管理者が書ける］、受注の内訳 `gn_contract_items`・実行予算 `gn_budget_lines`［読み書きとも社員・管理者だけ。金額は round(数量 × 単価) をトリガーが入れる］、読み替え表 `gn_trade_aliases`、進み具合の上書きの履歴 `gn_trade_progress`［入れられるのは管理者と、その現場の確認者・承認者］、日報の作業内容の行の工種 `gn_report_lines.site_trade_id` と `gn_save_report` の差し替え、使われている工種を消させないガード［trade_in_use］、工種の保存・予算と内訳の入れ替えの関数［同じ現場の同時実行は順番待ち］、全社の設定 `gn_settings.budget_daily_rate`［予算の標準日当・既定 20000］。何度実行しても安全）。**この機能を含むアプリをデプロイする前に実行すること**：先にデプロイすると、管理 → マスター → 労務の設定の保存がすべて失敗し（予算の標準日当の列が無い）、現場の「実行予算・受注の内訳」（`/sites/<現場>/budget/setup`）が 500 になる（日報の入力・保存はそのまま動く）。新規環境では `schema_genba.sql` に含まれているので不要。確認は `supabase/verify_rls_auto.sql` の「20」で FAIL 0 件。
   - **続けて（15・16 の後）**：`supabase/update_2026-11-17_subcontract.sql` を実行する（外注の買掛・行の根拠の件・うち常用の時間。日報の行に買掛の区分 `purchase_kind`［仕入／外注］とうち常用の時間 `jouyou_hours` の列、`gn_save_report` の差し替え［外注の買掛の工種・作業員以外の行の根拠の件を書く・`cost_total` から外注の買掛を除く］、外注の買掛の工種と根拠の件がその現場のものかの検査［trade_not_in_site・issue_not_in_site］、外注の買掛の行を協力会社のアカウントから読めなくする RLS、請負の会社の一覧の関数 `gn_site_ukeoi_suppliers`。既存の行は書き換えない。何度実行しても安全）。この SQL を実行してから新しい版のアプリを出す（新しい版は SQL の前でも動くが、買掛の区分「外注」は SQL の後でないと出ない）。確認は `supabase/verify_rls_auto.sql` の「22」で FAIL 0 件。
   - **段階ごとの SQL（件の見積中・添付・サイン）**：第 1 段階（件の「見積中」・承認解除の権限・修正申請）＝ `update_2026-11-08_issue_estimating_fix_request.sql`、第 2 段階（写真・ファイル・リンクの添付）＝ `update_2026-11-09_attachments.sql`、第 3 段階（お客様のサインとサインした時点の PDF・写真付きのお客様用日報 PDF）＝ `update_2026-11-10_client_signature.sql`、第 4 段階（お客様用の確認画面と件ごとのお客様確認）＝ `update_2026-11-13_issue_client_confirmations.sql`。08 → 09 → 10 → 13 の順に、それぞれの段階のアプリをデプロイする前に実行する（確認は verify の 13・14・15・18）。
     - **任意・1 回だけ**：既存の作業員のうち協力会社の人を、作業員マスターで「協力会社」（と会社）に分け終えた**後に** `supabase/recalc_2026-11-07_line_affiliation.sql` を実行すると、過去の作業員の行の所属をいまのマスターの所属で写し直す（協力会社の行は常用）。**過去の行の所属をいまのマスターで上書きする**ので、分け終えた直後に 1 回だけ使い、運用を始めてからは実行しない。人工・金額は変わらない。
3. 次章「既存アプリの profiles 保護（必須）」の `supabase/fix_profiles_guard.sql` を実行する。
4. 最初の管理者：SQL Editor で `update public.profiles set is_admin = true where email = '<管理者のメール>';` を実行する（SQL Editor からの変更は手順3の保護の対象外なので通る）。以降の担当者の割り当ては管理画面から行う。
5. `supabase/verify_rls.md` の手順で権限を確認し、結果をチェックボックスに記録する（協力会社が担当外の現場を見られないこと、社員は全現場に入力できるが承認はできないこと、承認権限など。管理者アカウントが必要なので手順4の後に行う）。共用プロジェクトに検証用の現場（検証現場X／Y）などのテスト行を作るため、最後の「7. 後片付け」で必ず削除する。
6. 公開後に Authentication → URL Configuration を設定する（「GitHub と Vercel」の手順 4）。

## 既存アプリの profiles 保護（必須）

既存の業務日報アプリの `profiles` の更新ポリシー（`profiles_update using (id = auth.uid() or public.is_admin())`）には `with check` が無い。そのため、ログインできる人なら誰でも、ブラウザから Supabase の API を直接呼んで自分の `is_admin` を `true` に書き換えられる（管理者への自己昇格）。現場日報アプリは `is_admin` で全現場の閲覧・承認・マスター管理を許すので、この穴は現場日報アプリにとっても致命的になる。

`supabase/fix_profiles_guard.sql` は、既存のポリシーには手を付けず、`profiles` にトリガー（`gn_profiles_guard`）を1つ追加して「管理者以外のアプリ利用者が `is_admin` を変える・`is_admin = true` の行を作る」ことだけを `is_admin_locked` で止める。名前などほかの列の更新、SQL Editor・service_role からの変更、既存アプリの security definer 関数からの変更はこれまでどおり通る。

- SQL Editor で1回だけ実行する（何度実行しても安全）。
- `profiles` は既存アプリと共用のテーブルなので、適用するかどうかはプロジェクトの管理者（既存アプリの持ち主）が決める。適用前に既存アプリの動作（プロフィール編集・管理者による権限変更）に影響がないことを確認すること。
- 確認手順は `supabase/verify_rls.md` の「8. 既存 profiles の保護」。

## GitHub と Vercel

1. GitHub でプライベートリポジトリ（例：`genba-nippou`）を作る。README・.gitignore は追加しない（空で作る）。
2. ローカルで接続して push する（`main` ブランチ。リポジトリは `https://github.com/fooe23/genba-nippou`）。
   ```bash
   git remote add origin https://github.com/fooe23/genba-nippou.git
   git branch --show-current   # main と表示されることを確認
   git push -u origin main
   ```
3. Vercel → Add New → Project → GitHub のリポジトリを Import。Framework は Next.js のまま。Environment Variables に次の2つを設定して Deploy する。
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`（`sb_publishable_…`）
   - Settings → Git の Production Branch は `main`（既定のまま）。以後は `main` への push で自動デプロイされる。
   - 本番URL：`https://genba-nippou-ten.vercel.app`（2026-11-01 公開）。
   - 以前の原本 Excel（Python 関数）の環境変数 `GN_EXPORT_SECRET`・`GN_EXPORT_FILL_URL` は 2026-11-11 から使わない。設定してあれば消してよい。
4. Supabase の Authentication → URL Configuration で、Site URL に本番URL（`https://genba-nippou-ten.vercel.app`）を設定し、Redirect URLs に `https://genba-nippou-ten.vercel.app/**` を追加する。プレビュー環境も使うなら `https://*-<team>.vercel.app/**` も追加する。

## 帳票（PDF・CSV）

現場 → 「出力」の「現場管理台帳」「工事原価集計表」「変更増減 精算資料（案）」「日報」が使う。どれも Next の Route Handler（`runtime = 'nodejs'`）で、ログイン中の社員・管理者だけが使える（未ログインはログイン画面へ（307）、協力会社は 403、削除済みの現場は 404。完了現場は出せる）。

| 帳票 | ルート | クエリ |
| --- | --- | --- |
| 現場管理台帳（.xlsx） | `/api/export` | `site=<現場ID>&period=all\|YYYY-MM`（シートは「現場原価集計」［工事原価集計表と同じ数字。合計は SUM の式］と「出面一覧」［作業員 × 日付］。`src/lib/reports/ledger-xlsx.ts`） |
| 工事原価集計表 | `/api/reports/cost` | `site=<現場ID>&period=all\|YYYY-MM&format=pdf\|xlsx\|csv` |
| 変更増減 精算資料 | `/api/reports/changes` | `site=<現場ID>&period=all\|YYYY-MM&format=pdf\|xlsx`（`&audience=client` で客先用「精算のご提案」、省略時は社内確認用） |
| 日報 | `/api/reports/daily` | `site=<現場ID>&date=YYYY-MM-DD`（1 日）または `month=YYYY-MM`（月まとめ）`&format=pdf\|csv`（`&audience=client` でお客様用の日報。`date` と `format=pdf` のみ） |

- **PDF**：`@react-pdf/renderer`（`src/lib/pdf/`）。A4 縦。日報が無いときは「日報がありません」だけの帳票を返す。
- **Excel**：`exceljs`（`src/lib/reports/cost-xlsx.ts`、`change-xlsx.ts`、`ledger-xlsx.ts`）。**CSV**：BOM 付き UTF-8・CRLF（`src/lib/reports/csv.ts`）。文字列が `= + - @` タブ CR で始まるセルには `'` を付けて、Excel の数式として実行されないようにしている。
- **フォント**：Noto Sans JP（Regular／Bold）を `public/fonts/` に同梱し、実行時にサーバーが読む（CDN は使わない）。**ライセンスは SIL Open Font License 1.1**（`public/fonts/OFL.txt`）。入手元・サイズ・ハッシュは `public/fonts/README.md`。フォントを差し替えるときは同じ名前の 2 ファイルを置き換える。
- **`next.config.ts` の `outputFileTracingIncludes`**：`"/api/reports/*": ["./public/fonts/**", "./public/logo.png"]`。Vercel の関数にフォントと会社ロゴ（変更増減 精算資料の見出し）のファイルを含めるための設定で、これが無いと本番でフォントやロゴが見つからず PDF が作れない。ビルド後は `.next/server/app/api/reports/*/route.js.nft.json` にフォント（`changes` はロゴも）が入っていることを確認できる。
- 環境変数は要らない。氏名の表示には `supabase/update_2026-11-03d_profile_names.sql` を使う。変更増減 精算資料と客先確認は `update_2026-11-04*.sql`（上記の順）が前提。

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
- [ ] 協力会社のアカウントでは、担当外の現場が見えない
- [ ] 社員のアカウントでは、ホームの「その他の現場」から担当外の現場にも入力できる（承認はできない）
- [ ] 現場 → 「出力」から、工事原価集計表（PDF・Excel・CSV）、日報（PDF・CSV。1 日・月）、現場管理台帳（Excel。工期全体・月）がダウンロードできる
- [ ] 日報画面で、1 日分の雛形（Excel）の取り込みと、作業員・仕入先の「（手入力）」が使える
- [ ] 作業内容に「追加」「変更」「減」の行を入れて保存でき、「減」は本日出来高から差し引かれる（集計・帳票でも負の金額）
- [ ] 現場 → 「出力」から、変更増減 精算資料（案）の PDF・Excel（工期全体・月）がダウンロードでき、精算提案額が出る（未確定の現場は概算金額が当初）
- [ ] 日報画面で客先確認を記録・取り消しでき、承認済みの日報・完了現場でも記録できる。日報 PDF の客先確認欄に名前と日時が出る
- [ ] 社員で現場の「協力会社と作業員」を開き、会社のカードの「＋ 新しい作業員を登録」で名前・日当を入れて登録すると、その会社の作業員としてチェック済みで出て、日報の選択肢と作業員マスター（更新者＝その社員）に出る。完了現場ではボタンが出ない
- [ ] 作業員マスターで協力会社の作業員を登録し、現場の「協力会社と作業員」で登録すると日報の選択肢に出る。その行で「常用／請負」を選んで保存でき、工事原価集計表の ④-2 に会社ごとに出る。協力会社は買掛の選択肢に出ない

確認日：____年__月__日　確認者：__________　URL：__________

## 既知の制約

- 未実装：写真の添付（第3〜4計画）。積算連携（受注の内訳・実行予算・予算と実績）は入っており、第 3 段階で PDF・集計 Excel を足す。
- 帳票の PDF の ③ 月別推移（11 列）は 7.5pt、日報 PDF の作業員表は 8pt と小さい。印刷での読みやすさは実機で確認する。
- 1現場につき1日1枚の日報。
- Storage のオブジェクトパスは先頭を `<site_id>/…` にする。RLS が先頭要素の現場IDで権限を判定するため、この規約を外れるとアクセスできない。
- 作業内容の行は手入力のみ（積算内訳からの選択は第3計画）。
- `npm audit` に moderate が 9 件ある（exceljs 4.4 経由の archiver・minimatch・uuid）。exceljs はサーバー側で帳票を作るだけで、入力は自社の集計データ（利用者のファイルは読まない）。解消には exceljs 3.x への格下げが要るため据え置き。
- 日報（PDF と画面の集計）の進捗率は、契約が未確定の現場でも「累計出来高 ÷ 請負金額」のまま（請負金額が無ければ「—」。「請負金額（未確定）」と「概算金額」の行を出す）。累計原価 ÷ 概算は次の計画。
