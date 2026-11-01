-- 現場の削除（戻せる非表示＝アーカイブ）と削除ログ、完了現場の書き込み禁止
-- 2026-11-02。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- 新規環境では schema_genba.sql に同じ内容が含まれているので、このファイルは不要。
--
-- 方針
--   * 削除 = gn_sites.deleted_at をセットする（行は消さない）。復元 = null に戻す。
--   * 削除・復元は管理者だけ。関数 gn_archive_site / gn_restore_site 経由でのみ行い、
--     そのたびに gn_site_audit_log に「誰が・いつ・どの現場を・理由」を残す。
--   * ログは管理者だけが読める。authenticated からの直接の insert/update/delete は不可。
--   * 削除済みの現場は管理者以外には見えない（gn_is_site_member が false を返す）。
--   * 完了（status='done'）または削除済みの現場では、日報の新規作成・内容変更・提出・削除、
--     明細と重要事項の変更ができない。承認・差戻し（状態の変更のみ）は完了現場でも可。
--     管理者が「進行中」に戻せば再び入力できる。

-- 1. 列の追加 ------------------------------------------------------------
alter table public.gn_sites add column if not exists deleted_at timestamptz;
alter table public.gn_sites add column if not exists deleted_by uuid;

-- 2. 削除ログ ------------------------------------------------------------
create table if not exists public.gn_site_audit_log (
  id          bigint generated always as identity primary key,
  site_id     uuid references public.gn_sites(id) on delete set null,
  site_name   text not null,
  action      text not null check (action in ('archive','restore')),
  actor_id    uuid,
  actor_name  text,
  actor_email text,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists gn_site_audit_log_created_idx on public.gn_site_audit_log (created_at desc);

alter table public.gn_site_audit_log enable row level security;
drop policy if exists gn_site_audit_log_admin_select on public.gn_site_audit_log;
create policy gn_site_audit_log_admin_select on public.gn_site_audit_log
  for select to authenticated using (public.is_admin());
-- insert / update / delete のポリシーは作らない（関数経由のみ）
revoke insert, update, delete on public.gn_site_audit_log from authenticated, anon;

-- 3. 見える範囲：削除済みは管理者だけ -------------------------------------
create or replace function public.gn_is_site_member(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_site is not null
         and (
           public.is_admin()
           or (
             exists (select 1 from public.gn_sites s where s.id = p_site and s.deleted_at is null)
             and (
               exists (
                 select 1 from public.gn_site_members
                  where site_id = p_site and user_id = auth.uid()
               )
               or exists (
                 select 1 from public.profiles p
                  where p.id = auth.uid()
                    and p.account_type = 'employee'
               )
             )
           )
         );
$$;

-- 4. 完了・削除済みの判定 --------------------------------------------------
-- 完了（done）または削除済みなら true。存在しない現場も true（書けない）。
create or replace function public.gn_site_closed(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.gn_sites s
     where s.id = p_site and s.status = 'active' and s.deleted_at is null
  );
$$;

-- 5. 削除・復元（管理者のみ、ログ付き） ------------------------------------
create or replace function public.gn_archive_site(p_site uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name  text;
  v_pname text;
  v_email text;
begin
  if not public.is_admin() then
    raise exception using message = 'not_admin';
  end if;
  select name into v_name from public.gn_sites where id = p_site and deleted_at is null for update;
  if not found then
    raise exception using message = 'site_not_found';
  end if;
  select name, email into v_pname, v_email from public.profiles where id = auth.uid();

  update public.gn_sites set deleted_at = now(), deleted_by = auth.uid() where id = p_site;
  insert into public.gn_site_audit_log (site_id, site_name, action, actor_id, actor_name, actor_email, reason)
  values (p_site, v_name, 'archive', auth.uid(), v_pname, v_email, nullif(btrim(p_reason), ''));
end;
$$;

create or replace function public.gn_restore_site(p_site uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name  text;
  v_pname text;
  v_email text;
begin
  if not public.is_admin() then
    raise exception using message = 'not_admin';
  end if;
  select name into v_name from public.gn_sites where id = p_site and deleted_at is not null for update;
  if not found then
    raise exception using message = 'site_not_found';
  end if;
  select name, email into v_pname, v_email from public.profiles where id = auth.uid();

  update public.gn_sites set deleted_at = null, deleted_by = null where id = p_site;
  insert into public.gn_site_audit_log (site_id, site_name, action, actor_id, actor_name, actor_email, reason)
  values (p_site, v_name, 'restore', auth.uid(), v_pname, v_email, null);
end;
$$;

revoke all on function public.gn_archive_site(uuid, text) from public, anon;
revoke all on function public.gn_restore_site(uuid) from public, anon;
grant execute on function public.gn_archive_site(uuid, text) to authenticated;
grant execute on function public.gn_restore_site(uuid) to authenticated;

-- 6. 完了・削除済みの現場では日報を書けない --------------------------------
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

-- 日報の削除も完了・削除済みの現場では不可
create or replace function public.gn_report_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.gn_site_closed(old.site_id) then
    raise exception using message = 'site_closed';
  end if;
  return old;
end;
$$;
drop trigger if exists gn_report_delete_guard on public.gn_daily_reports;
create trigger gn_report_delete_guard before delete on public.gn_daily_reports
  for each row execute function public.gn_report_delete_guard();

create or replace function public.gn_report_lines_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_site   uuid;
begin
  -- 完了・削除済みの現場の明細は誰も変更できない（管理者も同じ）
  select site_id into v_site from public.gn_daily_reports
   where id = case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  if v_site is null or public.gn_site_closed(v_site) then
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
  new.site_id := v_site;
  return new;
end;
$$;
