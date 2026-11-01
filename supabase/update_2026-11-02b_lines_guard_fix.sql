-- 2026-11-02 の追加修正：明細のある日報を削除すると site_closed で拒否される不具合を直す。
-- update_2026-11-02_site_archive.sql を適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。

create or replace function public.gn_report_lines_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_site   uuid;
begin
  -- 完了・削除済みの現場の明細は誰も変更できない（管理者も同じ）。
  -- 日報ごと削除されるとき（on delete cascade）は親行がもう無く v_site が null になる。
  -- その場合は日報側の gn_report_delete_guard が既に判定しているので、ここでは止めない。
  select site_id into v_site from public.gn_daily_reports
   where id = case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  if v_site is not null and public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  if public.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' then
    select status into v_status from public.gn_daily_reports where id = old.report_id;
    if v_status = 'approved' then
      raise exception using message = 'approved_report_locked';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select status into v_status from public.gn_daily_reports where id = new.report_id;
    if v_status = 'approved' then
      raise exception using message = 'approved_report_locked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
