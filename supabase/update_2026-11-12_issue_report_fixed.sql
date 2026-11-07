-- 2026-11-12：件のガードの穴をふさぐ（何度実行しても安全）。
-- 件の report_id を書き換えると、提出済みの日報の件を自分の下書きの日報に付け替えて、中身（本文・種別など）の鍵
-- （issue_locked）を外せた。アプリの利用者（auth.uid() あり）からは report_id を変えられないようにする（issue_report_fixed）。
-- update_2026-11-11_site_judgment.sql の後に実行する。アプリの版と順番の決まりは無い（アプリは件の日報を変えない）。
begin;

create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site    uuid;
  v_status  text;
  v_creator uuid;
  v_settles boolean;
begin
  -- 件の日報（report_id）は、アプリの利用者からは変えられない（提出済みの日報の件を自分の下書きの日報に付け替えて
  -- 中身の鍵を外すことを防ぐ）。2026-11-12（update_2026-11-12_issue_report_fixed.sql）。SQL Editor・service role は対象外。
  if tg_op = 'UPDATE' and auth.uid() is not null and new.report_id is distinct from old.report_id then
    raise exception using message = 'issue_report_fixed';
  end if;
  select r.site_id, r.status, r.created_by into v_site, v_status, v_creator from public.gn_daily_reports r where r.id = new.report_id;
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
  -- 件の中身（内容・種別・指示者・指示方法・金額見込み）を直せるのは、件の日報が下書きか差戻しのあいだだけ（管理者も同じ）。
  -- それ以外は issue_locked。協力会社は自分が作った日報の件だけ（issue_not_own）。状態・精算の項目は今までどおりいつでも変えられる。
  -- auth.uid() が無い呼び出し（SQL Editor・service role）は対象外。2026-11-11（update_2026-11-11_site_judgment.sql）。
  if tg_op = 'UPDATE' and auth.uid() is not null
     and (new.body, new.kind, new.instructed_by, new.instruction_method, new.amount_estimate)
         is distinct from (old.body, old.kind, old.instructed_by, old.instruction_method, old.amount_estimate) then
    if v_status not in ('draft','rejected') then
      raise exception using message = 'issue_locked';
    end if;
    if not (public.gn_is_employee_or_admin() or v_creator = auth.uid()) then
      raise exception using message = 'issue_not_own';
    end if;
  end if;
  new.site_id := v_site;
  return new;
end;
$$;

commit;
