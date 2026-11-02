-- 保存済みの日報の労務行を、現在の人工・残業ルール（gn_settings）で一括計算し直す。
-- 任意。旧ルール（人工 = 実働 ÷ 7.5）で保存した日報を新ルールにそろえたいときに 1 回実行する。
-- 承認済みの日報も対象にする（ガードを一時的に外す）。合計 3 列も計算し直す。
-- 対象の件数を先に確認したいときは、最後の select だけを単独で実行する。
begin;
  alter table public.gn_report_lines disable trigger gn_report_lines_guard;
  -- 労務行を「同じ値で更新」すると BEFORE UPDATE の gn_report_lines_compute が走り、人工・残業・労務費が計算し直される
  update public.gn_report_lines set unit_price = unit_price where kind = 'labor';
  alter table public.gn_report_lines enable trigger gn_report_lines_guard;

  -- 合計（gn_report_guard は gn.in_save = '1' のときだけ合計の更新を許す）
  select set_config('gn.in_save', '1', true);
  update public.gn_daily_reports r set
    cost_total     = coalesce((select sum(l.amount)   from public.gn_report_lines l where l.report_id = r.id and l.kind <> 'work'), 0),
    man_days_total = coalesce((select sum(l.man_days) from public.gn_report_lines l where l.report_id = r.id and l.kind = 'labor'), 0)
  where exists (select 1 from public.gn_report_lines l where l.report_id = r.id and l.kind = 'labor');
  select set_config('gn.in_save', '', true);
commit;

-- 確認：労務行の件数と、人工が 1.0 を超える行（旧ルールの名残）が 0 件であること
select count(*) as labor_lines, count(*) filter (where man_days > 1) as over_one from public.gn_report_lines where kind = 'labor';
