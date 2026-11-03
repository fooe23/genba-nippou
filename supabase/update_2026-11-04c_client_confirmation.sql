-- 2026-11-04c：客先確認の記録を、日報の状態や現場の完了に関係なく残せるようにする。
-- update_2026-11-04_change_tracking.sql（client_confirmed_* の列）を適用済みの環境で 1 回実行する
-- （schema_genba.sql には反映済み）。関数の置き換えだけなので何度実行しても安全。
--   * gn_report_guard：update で変わったのが客先確認の3列（client_confirmed_by / client_confirmed_at /
--     client_confirmed_note）と updated_at だけで、3列のどれかが実際に変わったときは、完了・削除済み現場の拒否（site_closed）と
--     承認済みの拒否（approved_report_locked）より前にそのまま通す。
--     それ以外の列が 1 つでも変わる更新は今までどおり（合計3列の totals_locked も変更なし）。
--   * 誰が書けるかは RLS（gn_daily_reports_update：現場メンバー）のまま。アプリでは
--     recordClientConfirmation / clearClientConfirmation（src/lib/db/reports-actions.ts）が使う。

create or replace function public.gn_report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reviewer boolean;
  v_closed   boolean;
begin
  v_reviewer := coalesce(public.gn_site_role(new.site_id), '') in ('reviewer','approver');
  v_closed   := public.gn_site_closed(new.site_id);

  if tg_op = 'INSERT' then
    if v_closed then
      raise exception using message = 'site_closed';
    end if;
    if new.status not in ('draft','submitted') and not v_reviewer then
      raise exception using message = 'not_reviewer';
    end if;
    if not v_reviewer and (
         new.reviewed_by is not null or new.approved_by is not null
         or new.approved_at is not null or new.rejected_reason is not null) then
      raise exception using message = 'not_reviewer';
    end if;
    if not public.is_admin() then
      new.created_by := auth.uid();
    end if;
    -- 合計は明細から計算する値。insert の時点では明細が無いので 0 にする（クライアントの値は使わない）
    new.output_total   := 0;
    new.cost_total     := 0;
    new.man_days_total := 0;
    return new;
  end if;

  -- update
  -- 客先確認の3列だけの変更（updated_at は gn_daily_reports_touch が進める）は、承認済み・完了現場でも通す。
  -- 3列のどれかが実際に変わったときだけ（何も変えない更新はこの例外に入れない）
  if (to_jsonb(new) - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at')
     is not distinct from
     (to_jsonb(old) - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at')
     and (new.client_confirmed_by, new.client_confirmed_at, new.client_confirmed_note)
         is distinct from (old.client_confirmed_by, old.client_confirmed_at, old.client_confirmed_note) then
    return new;
  end if;
  -- 完了・削除済みの現場：承認／差戻し（状態と確認列だけの変更）以外は不可
  if v_closed then
    if new.status not in ('approved','rejected')
       or (to_jsonb(new) - 'status' - 'reviewed_by' - 'approved_by' - 'approved_at' - 'rejected_reason' - 'updated_at')
          is distinct from
          (to_jsonb(old) - 'status' - 'reviewed_by' - 'approved_by' - 'approved_at' - 'rejected_reason' - 'updated_at') then
      raise exception using message = 'site_closed';
    end if;
  end if;
  -- 合計3列は gn_save_report の中（gn.in_save = '1'）でだけ変更できる（管理者も同じ）
  if (new.output_total   is distinct from old.output_total
      or new.cost_total     is distinct from old.cost_total
      or new.man_days_total is distinct from old.man_days_total)
     and current_setting('gn.in_save', true) is distinct from '1' then
    raise exception using message = 'totals_locked';
  end if;
  if old.status = 'approved' and not public.is_admin() then
    raise exception using message = 'approved_report_locked';
  end if;
  if new.status is distinct from old.status and new.status in ('approved','rejected')
     and not v_reviewer then
    raise exception using message = 'not_reviewer';
  end if;
  if not v_reviewer and (
       new.reviewed_by     is distinct from old.reviewed_by
       or new.approved_by     is distinct from old.approved_by
       or new.approved_at     is distinct from old.approved_at
       or new.rejected_reason is distinct from old.rejected_reason) then
    raise exception using message = 'not_reviewer';
  end if;
  return new;
end;
$$;
