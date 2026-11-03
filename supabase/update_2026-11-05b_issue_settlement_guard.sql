-- 2026-11-05b：重要事項の件の精算の項目を、協力会社が直接（PostgREST 経由で）変えられないようにするガード。
-- update_2026-11-05_issue_settlement.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- 05 より前に実行しないこと（精算の列が無いまま関数が差し替わり、件の更新がすべて失敗する）。
--   * gn_report_issues_guard（件の insert・update の前に走るトリガー関数）を差し替える。
--     更新で settlement_method・fixed_amount・daily_rate・fixed_on のどれかが変わり、呼び出したユーザーが協力会社
--     （profiles.account_type = 'partner'）なら not_employee で止める。社員・管理者・SQL Editor（auth.uid() なし）は通す。
--   * それ以外（親日報の現場への site_id の強制・report_not_found・完了現場の site_closed）は変えない。
--   * アプリの Server Action（updateIssueSettlement）は前から協力会社を拒否している。これは DB 側でも同じことを保証するもの。
--     未適用でもアプリは動く（協力会社の直接の更新が止まらないだけ）。
-- トリガー自体（gn_report_issues_guard on gn_report_issues）は既にあるので、関数の差し替えだけで効く。

create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site uuid;
begin
  select r.site_id into v_site from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  -- 精算の項目（精算の方法・確定額・常用単価・確定日）は社員（管理者を含む）だけが変えられる。協力会社は not_employee。
  -- （SQL Editor など auth.uid() が無い呼び出しは対象外）
  if tg_op = 'UPDATE' then
    if (new.settlement_method is distinct from old.settlement_method
        or new.fixed_amount is distinct from old.fixed_amount
        or new.daily_rate is distinct from old.daily_rate
        or new.fixed_on is distinct from old.fixed_on)
       and exists (select 1 from public.profiles p where p.id = auth.uid() and p.account_type = 'partner') then
      raise exception using message = 'not_employee';
    end if;
  end if;
  new.site_id := v_site;
  return new;
end;
$$;
