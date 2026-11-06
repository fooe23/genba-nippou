-- 2026-11-08：件の「見積中」、確認者・承認者の承認解除、日報の修正申請。
-- update_2026-11-07b_site_partner_worker.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- アプリは 'estimating' を書き、修正申請の表を使うので、アプリを新しい版にする前に実行する
-- （先にアプリを出すと、見積中の件の保存が check 違反になり、修正申請がエラーになる）。
--
-- 1. gn_report_issues.status に 'estimating'（見積中）を足す：'estimating'（見積中）／'open'（対応中）／'done'（完了）。
--    既存の件は今の値のまま（対応中は対応中）。列の check 制約は create table の中で書いたので名前が自動。
--    名前に頼らず、その列だけに掛かっている check 制約を pg_constraint から探して外し、
--    gn_report_issues_status_check の名前で付け直す。見積中も対応中と同じく完了まで日報の上に出続ける（アプリ側）。
-- 2. gn_report_guard：承認済み（approved）→ 下書き（draft）の変更（承認解除）を、管理者に加えて
--    その現場の確認者・承認者（gn_site_role が reviewer / approver）にも許す。そのとき変えてよい列は
--    status・approved_by・approved_at・reviewed_by・updated_at だけ（ほかの列が変わっていれば approved_report_locked）。
--    ほかの判定（管理者・客先確認の3列の例外・完了現場・合計列・承認系の列）は変えない。
-- 3. 日報の修正申請の表 gn_report_fix_requests（RLS・申請のガード・下書き／差戻しで解決にするトリガー）。

begin;

-- ---------- 1. 件の状態に「見積中」 ----------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attname = 'status'
    where con.conrelid = 'public.gn_report_issues'::regclass
      and con.contype = 'c'
      and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.gn_report_issues drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.gn_report_issues add constraint gn_report_issues_status_check
  check (status in ('estimating','open','done'));

-- ---------- 2. 日報のガード（確認者・承認者の承認解除） ----------
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
  -- 承認済みは管理者だけが変えられる。例外：その現場の確認者・承認者（gn_site_role が reviewer / approver）の
  -- 承認解除（approved → draft）。そのとき変えてよいのは status・approved_by・approved_at・reviewed_by・updated_at だけ
  -- （ほかの列が変わっていれば approved_report_locked）。2026-11-08（update_2026-11-08_issue_estimating_fix_request.sql）。
  if old.status = 'approved' and not public.is_admin() then
    if not (
         v_reviewer
         and new.status = 'draft'
         and (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'reviewed_by' - 'updated_at')
             is not distinct from
             (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'reviewed_by' - 'updated_at')
       ) then
      raise exception using message = 'approved_report_locked';
    end if;
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

drop trigger if exists gn_report_guard on public.gn_daily_reports;
create trigger gn_report_guard before insert or update on public.gn_daily_reports
  for each row execute function public.gn_report_guard();

-- ---------- 3. 日報の修正申請 ----------
-- 日報の添付は提出までに付ける決まり。提出後（承認待ち・承認済み）に足したくなったら、担当者が理由を付けて
-- 「修正を申請」する。確認者・承認者・管理者が差戻しか承認解除で下書きに戻すと、その日報の未解決の申請は解決になる。
--   * 出せる人：現場メンバー。協力会社のアカウントは自分が作った日報（created_by = auth.uid()）だけ。
--     日報が提出済み（submitted）か承認済み（approved）のときだけ。完了・削除済みの現場には出せない。
--   * site_id・申請者（requested_by と、その時点の名前 requested_by_name）・申請日時は DB が決める（クライアントの値は使わない）。
--     名前を写すのは、管理者以外は他人の profiles を読めないため（承認待ち一覧で申請者の名前を出す）。
--   * 変更・削除のポリシーは作らない（解決はトリガー gn_report_fix_requests_resolve だけが入れる）。日報を消せば一緒に消える。
-- 拒否の理由（アプリが文言に変える）：report_not_found（日報が無い・見られない）・site_closed・
--   report_not_submitted（提出済み・承認済みでない）・not_report_owner（協力会社が他人の日報に出した）。
create table if not exists public.gn_report_fix_requests (
  id                uuid primary key default gen_random_uuid(),
  report_id         uuid not null references public.gn_daily_reports(id) on delete cascade,
  site_id           uuid not null references public.gn_sites(id),
  reason            text not null check (char_length(btrim(reason)) between 1 and 500),
  requested_by      uuid references public.profiles(id),
  requested_by_name text not null default '',
  requested_at      timestamptz not null default now(),
  resolved_at       timestamptz
);
create index if not exists gn_report_fix_requests_open_idx on public.gn_report_fix_requests (report_id) where resolved_at is null;
create index if not exists gn_report_fix_requests_site_idx on public.gn_report_fix_requests (site_id, requested_at);

create or replace function public.gn_report_fix_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_site    uuid;
  v_status  text;
  v_creator uuid;
begin
  select r.site_id, r.status, r.created_by into v_site, v_status, v_creator
    from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or (auth.uid() is not null and not public.gn_is_site_member(v_site)) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  if v_status not in ('submitted','approved') then
    raise exception using message = 'report_not_submitted';
  end if;
  -- auth.uid() が無い呼び出し（SQL Editor・service role。RLS の外）は申請者をそのまま使う
  if auth.uid() is not null then
    if not public.gn_is_employee_or_admin() and v_creator is distinct from auth.uid() then
      raise exception using message = 'not_report_owner';
    end if;
    new.requested_by := auth.uid();
  end if;
  new.site_id      := v_site;
  new.reason       := btrim(new.reason);
  new.requested_at := now();
  new.resolved_at  := null;
  new.requested_by_name := coalesce(
    (select nullif(btrim(p.name), '') from public.profiles p where p.id = new.requested_by), '');
  return new;
end;
$$;
drop trigger if exists gn_report_fix_requests_guard on public.gn_report_fix_requests;
create trigger gn_report_fix_requests_guard before insert on public.gn_report_fix_requests
  for each row execute function public.gn_report_fix_requests_guard();

-- 日報が下書き（承認解除）か差戻しに変わったら、その日報の未解決の申請を解決にする。
-- 利用者には申請の更新のポリシーが無いので security definer で書く。
create or replace function public.gn_report_fix_requests_resolve()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('draft','rejected') and new.status is distinct from old.status then
    update public.gn_report_fix_requests
       set resolved_at = now()
     where report_id = new.id and resolved_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists gn_report_fix_requests_resolve on public.gn_daily_reports;
create trigger gn_report_fix_requests_resolve after update of status on public.gn_daily_reports
  for each row execute function public.gn_report_fix_requests_resolve();

alter table public.gn_report_fix_requests enable row level security;
drop policy if exists gn_report_fix_requests_select on public.gn_report_fix_requests;
create policy gn_report_fix_requests_select on public.gn_report_fix_requests for select to authenticated
  using (public.gn_is_site_member(site_id));
drop policy if exists gn_report_fix_requests_insert on public.gn_report_fix_requests;
create policy gn_report_fix_requests_insert on public.gn_report_fix_requests for insert to authenticated
  with check (
    public.gn_is_site_member(site_id)
    and requested_by = auth.uid()
    and exists (
      select 1 from public.gn_daily_reports r
       where r.id = gn_report_fix_requests.report_id
         and r.site_id = gn_report_fix_requests.site_id
         and r.status in ('submitted','approved')
         and (public.gn_is_employee_or_admin() or r.created_by = auth.uid())
    )
  );
-- update / delete のポリシーは作らない（解決はトリガーだけ）

commit;

-- 確認（任意）：
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'gn_report_issues_status_check';
-- select tgname from pg_trigger where tgname in ('gn_report_fix_requests_guard','gn_report_fix_requests_resolve');
