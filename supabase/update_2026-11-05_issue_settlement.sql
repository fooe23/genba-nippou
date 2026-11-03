-- 2026-11-05：重要事項の件ごとの精算（精算の方法・確定額・常用単価・確定日）と、現場の常用単価の既定。
-- update_2026-11-04d_increase_kind.sql まで適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * gn_report_issues.settlement_method：'undecided'（未定）,'lump_sum'（一式＝確定額で精算）,'daily_rate'（常用＝人工 × 常用単価）
--   * gn_report_issues.fixed_amount：確定額（円。一式のとき）。daily_rate：常用単価（客先請求・円／人工。常用のとき）。fixed_on：確定日
--     一式は確定額、常用は常用単価が必須（アプリ側で検証。使わない方の金額は null で保存する）。
--   * gn_sites.default_daily_rate：常用単価の既定（客先請求・円／人工）。件を常用で精算するときの単価の初期値
-- 既存の件は「未定」、それ以外の新しい列は空（null）になる。
-- 列は既存の表に足すので、RLS のポリシーと件のガード（完了した現場は site_closed で止める）はそのまま効く（変更なし）。
-- アプリはこの列を読むので、アプリを新しい版にする前に実行する（先にアプリを出すと件・現場の読み込みが失敗する）。

-- 1. 重要事項の件の精算 ---------------------------------------------------------
alter table public.gn_report_issues add column if not exists settlement_method text not null default 'undecided'
  check (settlement_method in ('undecided','lump_sum','daily_rate'));
alter table public.gn_report_issues add column if not exists fixed_amount numeric
  check (fixed_amount is null or fixed_amount >= 0);
alter table public.gn_report_issues add column if not exists daily_rate numeric
  check (daily_rate is null or daily_rate >= 0);
alter table public.gn_report_issues add column if not exists fixed_on date;

-- 2. 現場の常用単価の既定 -------------------------------------------------------
alter table public.gn_sites add column if not exists default_daily_rate numeric
  check (default_daily_rate is null or default_daily_rate >= 0);
