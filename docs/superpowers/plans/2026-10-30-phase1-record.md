# 第1計画 実装の記録（裁定・据え置き事項）

作成日：2026-10-31。実装中の判断（Ruling）と、レビューで見つかったが第1計画では据え置いた小さな指摘の一覧。第2計画以降の着手時に参照する。

## 裁定（Ruling）
- Ruling: worktree を作らず同一チェックアウトの phase1 ブランチで実装 — 新規リポジトリで他の作業がなく、利用者が Projects フォルダ内で直接ファイルを見つけられる必要がある — 誤りなら main の汚染リスクはないが、並行作業時に衝突する可能性
- Ruling: Next.js 16 で middleware の規約名が proxy.ts でない場合はフレームワークの規約名を正とする — 計画は名称を推定している — 誤りならファイル名の違いのみ
- Ruling: next.config.ts の cacheComponents/partialPrefetching（create-next-app 16.4 既定）を外す — 認証付きの動的ページ中心で Suspense 境界を計画に積んでいないため — 誤りならキャッシュ最適化の機会損失のみ
- Ruling: Task 4 に SQL 構文チェック（libpg-query を devDependency、scripts/check-sql.mjs、npm run check:sql）を追加 — ローカルに Postgres/Docker が無く、適用前に構文誤りを検出する手段が他にない — 誤りなら devDependency が1つ増えるだけ
- Ruling: Storage ポリシーは認証済み全員ではなく、オブジェクトパス先頭の <site_id>/ を gn_is_site_member で検査して現場メンバーに限定する（update は owner=auth.uid() か管理者） — 自動セキュリティレビューの指摘。他現場の写真・積算書を読めるのは設計書 §2 の権限に反する — 誤りならアップロード時のパス規約が増えるのみ（第3・第4計画のアップロード実装はこの規約に従う）
- Ruling: 計画の "before update" より設計書 §2「担当者は承認できない」を優先し、ガードを before insert or update に拡張、承認系4列（reviewed_by/approved_by/approved_at/rejected_reason）は reviewer/approver 以外の変更を拒否 — 誤りなら管理者の運用が少し厳格になるのみ
- Ruling: Minor#3（gn_report_issues.site_id が親日報の site_id と不一致で他現場へ書き込める）は現場をまたぐ書込みなので Important として修正対象に含める — 誤りならトリガーが1本増えるのみ
- Ruling: Task 5 fix round 1 に Minor#3（profiles 取得エラーの握りつぶし→ログ出力）と Minor#4（ログイン失敗時の loading 固着→try/finally）も含める — 同一ファイル内の小修正で利用者に見えるバグのため — 誤りなら1回の修正量が少し増えるのみ
- Ruling: Task 9 の saveReport は計画の Promise<string> ではなく { ok, id } | { ok:false, error } を返す — Next.js 本番では Server Action の throw メッセージが隠れるため（Task 6 レビューの指摘） — 誤りなら呼び出し側の分岐が少し増えるのみ。Task 10/11 のアクションも同形式
- Ruling: Task 9 fix round 1 に Minor#1（金額のみ入力で金額空のときの誤ったエラー文）と Minor#5（古い形式の下書き復元でクラッシュ→try/catch で破棄）も含める — 同一モジュール内の小修正で利用者に見えるため — 誤りなら修正量が少し増えるのみ
- Ruling: 原価集計タブは「5項目の金額＝表示期間、進捗率・総原価・粗利益・粗利率＝期間末時点の累計」とし見出しに明記 — 設計書 §5/§7 の進捗率は累計定義のため — 誤りなら月単位の粗利が見たい場合に列が1組増えるのみ
- Ruling: Task 13 fix round 1 に文言の Minor（表名のずれ、状態名「提出済」、下書きの編集権、「第2計画」の社内用語、工期累計行の説明）も含める — 同じ md ファイルの文言修正で利用者に直接見えるため — 誤りなら修正量が少し増えるのみ
- Critical#1 既存 profiles_update に with check がなく自己昇格可能（既存アプリの表） → Ruling: 別ファイル supabase/fix_profiles_guard.sql を用意し README から参照。適用は共有テーブルのため利用者の承認後 — 誤りなら未適用のまま運用され権限モデルが崩れる（必ず利用者に伝える）
- Important#1 金額・人工・合計列を DB が検証せず、単価スナップショットがクライアント由来 → Ruling: gn_report_lines の before トリガーで hours/man_days/amount/productivity を再計算、*_total は gn_save_report 内のみ更新可（GUC で判定）、saveReport は労務・リースの単価を日報日付でサーバー解決 — 誤りなら単価訂正時に再保存で値が変わるが仕様（日付時点の単価）に合致
- Important#2 作業員別累計の月表示が「繰越初期値＋当月」で Excel の C/D・E/F・G/H と不一致 → Ruling: 前月繰越＝初期値＋期間開始前の日報、当期間、累計の3組にし、beforeDate より前の日報は繰越に含めない（二重計上防止）。ガイド文言を戻す
- Important#3 最終書き込み勝ちで他端末の更新を黙って上書き → Ruling: updated_at による楽観ロック（stale_report）と下書き復元時の警告を追加
- Important#4 誤った日付の日報を消せない → Ruling: 作成者は draft/rejected の自分の日報を、管理者は全てを削除できる（RLS とアクション、確認ダイアログ）

## 据え置きの指摘（minor / deferred）
- Task 1: minor (deferred): globals.css の Arial 指定と Geist(latin) は日本語UIでは無意味。Task 5 のレイアウト実装時に日本語フォントスタックへ置換し next/font/google 依存を外す
- Task 1: minor (deferred): eslint globalIgnores に coverage/** を追加
- Task 1: minor (deferred): package.json に engines.node >=22 を追加、README は Task 14 で書き直し
- Task 2: minor (deferred): toMinutes は不正な "HH:MM" で NaN を返す → Task 9 の Zod schema で時刻形式を検証すること（Task 9 ディスパッチに引き継ぐ）
- Task 2: minor (deferred): fuelCost の負の燃費・progressRate の負の総額は未ガード → schema で非負を検証
- Task 2: minor (deferred): productivity(qty null) → null は後続タスクでテスト追加を検討
- Task 3: minor (deferred): format.test.ts に yen(1234.5)/yen(-0.4)/jpDate("2026-01-09") のケース追加
- Task 3: minor (deferred): rateAt の同一 effectiveFrom は配列順依存 → Task 4 の unique(worker_id, effective_from) で担保
- Task 4: minor (deferred): 合計3列を会員が直接更新できる（アプリは rpc 経由なので実害小）、created_by の直接 insert による詐称
- Task 4: minor (deferred→Task 9 へ引継ぎ): jsonb_populate_record は数値/uuid列に "" を渡すと生エラー → saveReport は空値を必ず null で送る
- Task 4: minor (deferred→Task 10 へ引継ぎ): 差戻し後の再提出で staff が rejected_reason を消すとガードに弾かれる → submitReport は rejected_reason に触れない。gn_report_issues には承認ロックなし（仕様外、据え置き）
- Task 4: minor (deferred): auth.uid() のない呼び出し（SQL Editor/service role）は非管理者扱い。将来の取り込み処理は管理者として実行する必要あり
- Task 5: minor (deferred): リダイレクト時に Cache-Control ヘッダ未複製、タブの前方一致が緩い、getCurrentProfile を React cache() で重複排除、Database 型なし、manifest/robots が /login へ飛ぶ、LayoutProps<'/'> の流用
- Task 5: minor (deferred): HTTP 400 を一律に資格情報エラー扱い（メール未確認も同じ文言）。signInError.code での判別が精密
- Task 6: minor (deferred): Server Action の throw は本番で message が隠れる → 日報系アクション（Task 9/10）は { ok, error } 形式を採用すること（Task 9 へ引継ぎ）
- Task 6: minor (deferred): 同日付の単価上書き確認プロンプト、タブの ARIA、RateHistoryEditor が form 外、todayJst の固定日付テスト、トグルが stale な name を送る
- Task 6: minor (deferred): createWithRate の補償削除で元エラーを捨てている（{cause} かログ）、ロールバック失敗時の警告が本番で見えない、SQL RPC 化すれば完全に原子化できる
- Task 7: minor (deferred): setSiteMasters は4表を順次更新（非トランザクション）、sort_order の重複、upsertCarryover が選択作業員かを未検証、diffIds の純関数化とテスト、着工≤竣工の検証なし、保存済みメッセージの残留
- Task 8: minor (deferred): 経過日数が着工日に0日表示（包含カウントは製品判断）、listReportHeads に limit なし（PostgREST 既定1000）、カレンダーの visitNumbers を事前計算、提出済でも「今日の日報を書く」の文言
- Task 9: minor (deferred): 復元の楽観ロックなし（savedAt をバナーに表示）、下書きキーに利用者IDなし、個別時間の片方入力の警告、承認済みの古い下書きを消さない、金額のみ行が 1×金額 で再表示
- Task 10: minor (deferred): getSubmittedCount が requireProfile を再実行（React cache() で重複排除）、レイアウトのバッジが他者の操作で古くなる（revalidatePath('/','layout')）、span の aria-label、エラー帯の見出し文言、review モードでも下書きフックが動く
- Task 11: minor (deferred): setIssueDone の冗長な親日報再取得、/approvals の revalidate 漏れ、done 再設定で done_at 上書き、トグルの表示が現在状態のみ、review モードでも openIssues を読む
- Task 12: minor (deferred): 月次集計の備考列（重要事項要約）は Task 11 のデータ連携が要るため第1計画では見送り、costTotal と5項目合計の不一致リスク、総額0の表示の不統一、text-left/text-right の重複クラス、全状態の日報を集計に含める（承認済みのみにするかは利用者判断）
- Task 13: minor (deferred): ガイドのテストが見出しのみの章を検証しない、md 内の表に横スクロールラッパなし、「今日の日報を書く」への言及
- Task 13: minor (deferred): summary.md の工期累計の説明は工期全体表示では「表示期間の最終日」が正確、index.md:17 の空の「 」
- Task 14: minor (deferred): 最初の管理者設定は本人が1度ログインして profiles 行ができてから（README に一言追加）

## 最終レビューで据え置いた項目
- Minor（据え置き）: その他の最終レビュー Minor は第2計画以降で対応。iCloud 同期フォルダ内の重複ファイル問題は利用者へ伝える
- 最終修正波: 3 commits aa71cec..7ff709e, 再レビュー clean（Minor 2件は据え置き：マスターに有効単価がない場合のプレビューと保存値の不一致、保存後の updated_at 再取得失敗時にロックが一時的に外れる）

## 利用者の操作待ち
- supabase/schema_genba.sql と supabase/fix_profiles_guard.sql の適用（SQL Editor）、verify_rls.md の実行
- GitHub リポジトリ作成と push、Vercel 連携、Supabase の URL Configuration、本番スモーク（README 参照）

## 利用者からの検討事項（2026-10-31）
- 人工の基準：雛形は 実働÷7.5。実態は「8時間でも1人工」で、8時間超は残業扱い（1か月単位の変形労働時間制）。
  候補：人工＝実働÷基準時間（設定値、上限1.0）、残業時間＝実働−8.0、労務費＝日当×人工＋残業時間×残業単価。設定は管理画面に持ち、雛形は V34 として設定セル・数式・残業H列を改訂し、第2計画の Excel 出力は V34 を使う。
  未決：通常日（実働7.5h）を1.0人工とするか／残業代の計算方法（日当÷8×割増 or 作業員ごとの残業時給）。利用者が検討中。

## 追補（協力会社アカウント）2026-10-31 — レビュー済み・据え置き事項
- commits 840d2ad（SQL）, a341d54（アプリ）、業務日報 HTML 2ファイル（git 管理外、変更履歴_2026-10-31.md）
- 据え置き: アカウント作成のエラー文の正規表現が広い（password/e-mail）、作成中にダイアログを閉じると部分失敗の警告が消える、補完ヒントの文言が「日当」固定、区分変更後の成功表示なし、「協力会社＝担当のみ」はアプリ側のみの規則（DB 制約なし）
- 適用順: add_profile_account_type.sql → fix_profiles_guard.sql（再実行）→ 現場日報の再起動／デプロイ → 業務日報 HTML の再デプロイ

## 決定（2026-10-31）人工・残業ルール
- 人工 = IF(実働 ≤ 所定7.5, ROUND(実働/7.5,2), 1)。7.5〜8.0H は 1.0（固定残業）。残業時間 = MAX(実働 − 8.0, 0)。
- 労務費 = 日当×人工 ＋ 残業時間×残業単価。残業単価の既定 = 日当÷8×1.25、作業員ごとに上書き可（マスターの 残業単価 列）。4つのパラメータは設定セル／設定テーブルに持つ。
- 共通時間の既定は 8:00〜17:30・休憩90（現場ごとの設定）。
- 雛形は V34（templates/現場管理台帳_V34_案.xlsm）として改訂中。アプリ側（calc/report.ts・DB トリガー・設定画面・作業員マスターの残業単価）は第2計画の前に反映する。

## 追補2（権限：社員は全現場）2026-10-31 — レビュー済み
- commits f2378fd, 10154bc。gn_is_site_member を「管理者 or 割当メンバー or 社員」に変更。承認は従来どおり割当者のみ。
- 適用：supabase/update_2026-10-31_employee_access.sql（関数1つ）。新規環境では add_profile_account_type.sql → schema_genba.sql → fix_profiles_guard.sql の順。
- 据え置き：spec §2 の役割表の「担当者」行の文言、profile.ts の null→employee 変換（列は not null なので到達しない）

## 雛形 V34 を正式採用（2026-10-31、利用者が Excel で確認済み）
- 正式ファイル：templates/現場管理台帳_V34_原本.xlsm（V34_案 と同一）。第2計画の Excel 出力はこのファイルを原本にする。
- 既知の注意：「＋ 行追加」マクロは新行の L 列（備考）をクリアしない（VBA Module1 の ":K" → ":L"）。残業単価 0 は空欄扱い。

## 追補3（現場の削除・完了現場）2026-11-02
- commits d7254ce（SQL）, b4eb52e（データ層・Server Actions・スキーマのテスト）, 0bfbf5c（画面）, ガイド・記録のコミット（この節を追加したもの）
- 適用する SQL：`supabase/update_2026-11-02_site_archive.sql`（既存環境のみ。新規環境は `schema_genba.sql` に含む）。確認は `supabase/verify_rls.md` の「9. 現場の削除と完了現場」
- 内容：下部タブ ホーム・承認・完了現場・ガイド・管理。`/done` で完了現場を一覧（閲覧のみ）。現場詳細に管理者向け「完了にする」「進行中に戻す」。
  管理 → 現場の編集「⑤ 現場の削除」（本人のメール・パスワードを使い捨てクライアントで再認証してから `gn_archive_site`）、
  管理 → 現場「削除済み」から復元（`gn_restore_site`）、削除ログ `/admin/sites/log`。DB の `site_closed` は日本語に変換。
- 裁定：
  - 完了現場では承認・差戻しだけ可（日報の新規・編集・提出・削除、明細・重要事項の変更は不可。管理者も同じ。直すときは管理者が「進行中に戻す」）
  - 削除はすべてソフト削除（`deleted_at`）。削除済みは管理者以外の RLS から消え、管理者にもホーム・完了現場・承認・現場詳細・集計には出さない（管理 → 現場 →「削除済み」でだけ扱う）
  - 重要事項（件）も完了後は変更不可（件の追加・完了／対応中の切替のボタンを出さない）
- 据え置き：
  - パスワードの再認証は Supabase Auth の `signInWithPassword` を使うため、短時間に失敗を重ねると Auth のレート制限に当たる（理由は区別せず「パスワードが違います」と出す）
  - 削除済みの現場の編集ページ（①〜④）は操作を止めていない。① の保存は `upsertSite` が削除済みを更新しないため失敗する（汎用の保存失敗の文言）
  - 前回コピー（`copyPreviousReport`）は読み取りだけなので `site_closed` は起きない（完了現場ではフォームごと無効）
  - 承認待ちタブのバッジ・一覧は削除済み現場を除くが、完了現場の承認待ちは従来どおり出る（承認・差戻しは可能なため）

- レビュー（2026-11-02）：Critical/Important 0、Minor 8。修正済み：再認証は照合ユーザー id ＝ ログイン中の管理者 id を必須化／完了現場の承認済み日報に「承認を解除」を出さない／削除ダイアログを開き直したとき古いエラーを消す。据え置き：Supabase Auth の回数制限中も文言は「パスワードが違います」、削除済み現場の編集ページ①〜④は操作可能（保存は汎用エラー）。

- 権限検証（2026-11-02、supabase/verify_rls_auto.sql を本番で実行・全件ロールバック）：46 項目中 44 PASS。FAIL 2 件のうち 1 件は検証側の誤り（存在しない日報を更新）、1 件は実不具合：明細のある日報の削除が cascade 時に gn_report_lines_guard で site_closed になる → update_2026-11-02b_lines_guard_fix.sql で修正（親行が無いときは判定しない）。
- 修正 SQL 適用後に verify_rls_auto.sql を再実行：46 項目すべて PASS（2026-11-02 01:55）。
- 次の開発の順番（利用者決定 2026-11-02）：人工・残業ルールのアプリ反映 → 第2計画 Excel 出力 → 第3計画 積算連携 → 第4計画 PDF・写真。

## 次回の小修正（利用者依頼 2026-11-02 深夜）
- ログイン画面の「パスワードをお忘れの場合」文言：業務日報アプリの「パスワードを忘れた方」から再設定するよう案内する（協力会社は管理者が現場日報の管理 → アカウントで再設定、の注記も検討）。業務日報側の再設定導線の有無を確認してから文言を決める。
- ログイン画面にロゴ（PNG）を表示する。ファイルは利用者から受け取り `public/logo.png` に置く。
