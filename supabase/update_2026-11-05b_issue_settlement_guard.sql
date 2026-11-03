-- 2026-11-05b：重要事項の件の精算の項目を、協力会社が直接（PostgREST 経由で）入れたり変えたりできないようにするガード。
-- update_2026-11-05_issue_settlement.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- 05 より前に実行しないこと（精算の列が無いまま関数が差し替わり、件の更新がすべて失敗する）。
--   * gn_report_issues_guard（件の insert・update の前に走るトリガー関数）を差し替える。
--     精算の列（settlement_method・fixed_amount・daily_rate・fixed_on）を次のようにできるのは、社員
--     （profiles.account_type = 'employee'）か管理者（is_admin()）だけ。それ以外（協力会社・profiles の行が無いユーザー）は
--     not_employee で止める（許す側を名指しする書き方。区分が増えても既定で拒否になる）。
--       - 追加（insert）：settlement_method が 'undecided' 以外、または fixed_amount・daily_rate・fixed_on のどれかが空でない
--       - 更新（update）：settlement_method・fixed_amount・daily_rate・fixed_on のどれかが変わる
--     auth.uid() が無い呼び出し（SQL Editor・service role。どちらも RLS の外）は対象外。
--     協力会社も精算の列を入れない普通の件の追加・完了などはできる。
--   * それ以外（親日報の現場への site_id の強制・report_not_found・完了現場の site_closed）は変えない。
--   * アプリの Server Action（updateIssueSettlement）は前から協力会社を拒否している。これは DB 側でも同じことを保証するもの。
--     未適用でもアプリは動く（協力会社の直接の更新が止まらないだけ）。
-- トリガー自体（gn_report_issues_guard on gn_report_issues）は既にあるので、関数の差し替えだけで効く。

create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site uuid;
  v_settles boolean;
begin
  select r.site_id into v_site from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  -- 精算の項目（精算の方法・確定額・常用単価・確定日）を入れる（insert で既定［未定・空］以外の値）・変える（update）のは
  -- 社員（account_type = 'employee'）か管理者だけ。それ以外（協力会社・profiles の行が無いユーザー）は not_employee。
  -- auth.uid() が無い呼び出し（SQL Editor・service role。RLS の外）は対象外。
  -- （insert では old を参照しないよう、insert と update を分けて判定する）
  if tg_op = 'INSERT' then
    v_settles := new.settlement_method <> 'undecided'
      or new.fixed_amount is not null
      or new.daily_rate is not null
      or new.fixed_on is not null;
  else
    v_settles := new.settlement_method is distinct from old.settlement_method
      or new.fixed_amount is distinct from old.fixed_amount
      or new.daily_rate is distinct from old.daily_rate
      or new.fixed_on is distinct from old.fixed_on;
  end if;
  if v_settles and auth.uid() is not null
     and not exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and (p.account_type = 'employee' or public.is_admin())
     ) then
    raise exception using message = 'not_employee';
  end if;
  new.site_id := v_site;
  return new;
end;
$$;
