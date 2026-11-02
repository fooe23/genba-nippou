-- =====================================================================
-- 現場日報アプリ（gn_*）スキーマ
-- 既存の業務報告アプリと同じ Supabase プロジェクトに追加する。
-- 既存の public.profiles / public.is_admin() / public.touch_updated_at() を再利用し、
-- 既存テーブルには一切 DDL を発行しない。何度実行しても安全（冪等）。
-- トランザクション(begin/commit)は使わない：ダッシュボードが1スクリプトとして実行する。
-- =====================================================================

-- ---------- 1. 現場 ----------
create table if not exists public.gn_sites (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  client_name     text,
  project_name    text,
  project_no      text,
  overview        text,
  contract_amount numeric,
  start_date      date,
  end_date        date,
  contract_type   text check (contract_type in ('元請け','下請','常用')),
  status          text not null default 'active' check (status in ('active','done')),
  deleted_at      timestamptz,
  deleted_by      uuid,
  common_start     text,
  common_end       text,
  common_break_min int,
  common_gap_min   int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- 既存環境向け（2026-11-02 追加列）
alter table public.gn_sites add column if not exists deleted_at timestamptz;
alter table public.gn_sites add column if not exists deleted_by uuid;
alter table public.gn_sites add column if not exists common_start     text;
alter table public.gn_sites add column if not exists common_end       text;
alter table public.gn_sites add column if not exists common_break_min int;
alter table public.gn_sites add column if not exists common_gap_min   int;


create table if not exists public.gn_site_members (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.gn_sites(id) on delete cascade,
  user_id    uuid not null references public.profiles(id),
  role       text not null check (role in ('staff','reviewer','approver')),
  created_at timestamptz not null default now(),
  unique (site_id, user_id)
);

-- ---------- 2. マスター ----------
create table if not exists public.gn_workers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  trade      text,
  note       text,
  profile_id uuid references public.profiles(id),
  overtime_rate numeric check (overtime_rate is null or overtime_rate >= 0),
  active     boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gn_workers add column if not exists overtime_rate numeric check (overtime_rate is null or overtime_rate >= 0);

create table if not exists public.gn_worker_rates (
  id             uuid primary key default gen_random_uuid(),
  worker_id      uuid not null references public.gn_workers(id) on delete cascade,
  amount         numeric not null,
  effective_from date not null,
  created_at     timestamptz not null default now(),
  unique (worker_id, effective_from)
);

create table if not exists public.gn_suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,
  contact    text,
  note       text,
  active     boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gn_vehicles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text,
  km_per_l   numeric,
  note       text,
  active     boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gn_lease_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  spec       text,
  note       text,
  active     boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gn_lease_item_rates (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.gn_lease_items(id) on delete cascade,
  amount         numeric not null,
  effective_from date not null,
  created_at     timestamptz not null default now(),
  unique (item_id, effective_from)
);

-- ---------- 3. 現場 × マスター ----------
create table if not exists public.gn_site_workers (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.gn_sites(id),
  worker_id  uuid not null references public.gn_workers(id),
  sort_order int default 0,
  created_at timestamptz not null default now(),
  unique (site_id, worker_id)
);

create table if not exists public.gn_site_suppliers (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.gn_sites(id),
  supplier_id uuid not null references public.gn_suppliers(id),
  sort_order  int default 0,
  created_at  timestamptz not null default now(),
  unique (site_id, supplier_id)
);

create table if not exists public.gn_site_vehicles (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.gn_sites(id),
  vehicle_id uuid not null references public.gn_vehicles(id),
  sort_order int default 0,
  created_at timestamptz not null default now(),
  unique (site_id, vehicle_id)
);

create table if not exists public.gn_site_lease_items (
  id            uuid primary key default gen_random_uuid(),
  site_id       uuid not null references public.gn_sites(id),
  lease_item_id uuid not null references public.gn_lease_items(id),
  sort_order    int default 0,
  created_at    timestamptz not null default now(),
  unique (site_id, lease_item_id)
);

-- ---------- 4. 単位・天候（選択肢） ----------
create table if not exists public.gn_units (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  sort_order int,
  created_at timestamptz not null default now()
);

create table if not exists public.gn_weather_options (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  sort_order int,
  created_at timestamptz not null default now()
);

insert into public.gn_units (name, sort_order) values
  ('㎡',1),('m',2),('m³',3),('式',4),('箇所',5),('本',6),('枚',7),('台',8),
  ('人',9),('日',10),('t',11),('kg',12),('ℓ',13),('回',14),('棟',15)
on conflict (name) do nothing;

insert into public.gn_weather_options (name, sort_order) values
  ('晴れ',1),('曇り',2),('雨',3),('雪',4),('晴れ時々曇り',5),('曇り時々雨',6),('雨時々曇り',7),('台風',8)
on conflict (name) do nothing;

-- ---------- 5. 日報 ----------
create table if not exists public.gn_daily_reports (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.gn_sites(id),
  report_date      date not null,
  weather          text,
  supervisor       text,
  common_start     text,
  common_end       text,
  common_break_min int,
  common_gap_min   int,
  output_total     numeric default 0,
  cost_total       numeric default 0,
  man_days_total   numeric default 0,
  issues_text      text,
  notes_text       text,
  status           text not null default 'draft'
                   check (status in ('draft','submitted','approved','rejected')),
  created_by       uuid references public.profiles(id),
  reviewed_by      uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  rejected_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (site_id, report_date)
);

create table if not exists public.gn_report_lines (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.gn_daily_reports(id) on delete cascade,
  kind          text not null check (kind in ('labor','fuel','lease','cash','credit','work')),
  sort_order    int not null,
  ref_id        uuid,
  name          text,
  spec          text,
  unit          text,
  qty           numeric,
  unit_price    numeric,
  amount        numeric,
  start_time    text,
  end_time      text,
  break_min     int,
  gap_min       int,
  hours         numeric,
  man_days      numeric,
  km_per_l      numeric,
  distance_km   numeric,
  price_per_l   numeric,
  vendor        text,
  trade         text,
  description   text,
  productivity  numeric,
  source        text check (source in ('estimate','extra')),
  note          text,
  overtime_hours numeric,
  overtime_rate  numeric,
  created_at    timestamptz not null default now()
);
alter table public.gn_report_lines add column if not exists overtime_hours numeric;
alter table public.gn_report_lines add column if not exists overtime_rate  numeric;
create index if not exists gn_report_lines_report_idx on public.gn_report_lines (report_id, sort_order);

create table if not exists public.gn_report_issues (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.gn_sites(id),
  report_id        uuid not null references public.gn_daily_reports(id) on delete cascade,
  body             text not null,
  status           text not null default 'open' check (status in ('open','done')),
  done_at          date,
  estimate_item_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists gn_report_issues_report_idx on public.gn_report_issues (report_id);

create table if not exists public.gn_carryovers (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.gn_sites(id),
  worker_id   uuid not null references public.gn_workers(id),
  man_days    numeric not null default 0,
  labor_cost  numeric not null default 0,
  before_date date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (site_id, worker_id)
);

-- ---------- 6. updated_at 自動更新（既存の touch_updated_at を再利用） ----------
drop trigger if exists gn_sites_touch on public.gn_sites;
create trigger gn_sites_touch before update on public.gn_sites
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_workers_touch on public.gn_workers;
create trigger gn_workers_touch before update on public.gn_workers
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_suppliers_touch on public.gn_suppliers;
create trigger gn_suppliers_touch before update on public.gn_suppliers
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_vehicles_touch on public.gn_vehicles;
create trigger gn_vehicles_touch before update on public.gn_vehicles
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_lease_items_touch on public.gn_lease_items;
create trigger gn_lease_items_touch before update on public.gn_lease_items
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_daily_reports_touch on public.gn_daily_reports;
create trigger gn_daily_reports_touch before update on public.gn_daily_reports
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_report_issues_touch on public.gn_report_issues;
create trigger gn_report_issues_touch before update on public.gn_report_issues
  for each row execute function public.touch_updated_at();
drop trigger if exists gn_carryovers_touch on public.gn_carryovers;
create trigger gn_carryovers_touch before update on public.gn_carryovers
  for each row execute function public.touch_updated_at();

-- ---------- 7. 権限ヘルパー関数 ----------
-- 現場を閲覧・入力できるか（日報・マスター・Storage など RLS はすべてこの関数を通る）
--   * 管理者：すべての現場
--   * 社員（profiles.account_type = 'employee'）：すべての現場（割り当て不要）
--   * 協力会社（'partner'）：gn_site_members に割り当てられた現場だけ
-- 承認・差戻しの権限はここでは広げない。gn_site_role（下）の reviewer / approver
-- （管理者を含む）だけが承認できる。社員でも割り当てがなければ not_reviewer になる。
-- 前提：profiles.account_type 列（add_profile_account_type.sql）。先にそちらを実行しておくこと。
-- 同じ内容の単独ファイル：update_2026-10-31_employee_access.sql
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

-- 完了・削除済みの判定
-- 完了（done）または削除済みなら true。存在しない現場も true（書けない）。
create or replace function public.gn_site_closed(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.gn_sites s
     where s.id = p_site and s.status = 'active' and s.deleted_at is null
  );
$$;

-- 自分の現場内の役割。管理者は 'approver'、メンバーでなければ null
create or replace function public.gn_site_role(p_site uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
           when public.is_admin() then 'approver'
           else (select m.role from public.gn_site_members m
                  where m.site_id = p_site and m.user_id = auth.uid())
         end;
$$;

-- ---------- 8. ガードトリガー ----------
-- 日報のガード（insert / update 両方）：
--   * 承認済み日報の変更禁止（管理者は除く）
--   * status を approved / rejected にできるのは reviewer 以上（管理者含む）のみ。
--     insert で最初から approved/rejected を作ることも同様に禁止
--   * reviewed_by / approved_by / approved_at / rejected_reason は reviewer 以上だけが変更可
--     （担当者は insert で入れることも、update で値を変えることもできない）
--   * insert 時、管理者以外は created_by を auth.uid() に強制（なりすまし防止）
--   * 合計3列（output_total / cost_total / man_days_total）は gn_save_report だけが書ける。
--     insert では常に 0（明細はまだ無い）。update で値を変えるには gn_save_report が立てる
--     トランザクション内の印（gn.in_save = '1'）が要り、無ければ totals_locked。管理者も同じ。
--     （PostgREST からは set_config を直接呼べないので、利用者がこの印を立てることはできない）
-- gn_save_report はこの4列に触れず status も変えない（insert は draft、on conflict update は
-- 本文の列のみ）ので、draft / submitted / rejected の日報では担当者でもこのガードを通る。
-- メッセージ文字列はクライアントが判定に使うため変更しないこと
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

drop trigger if exists gn_report_guard on public.gn_daily_reports;
create trigger gn_report_guard before insert or update on public.gn_daily_reports
  for each row execute function public.gn_report_guard();

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

-- 親日報が承認済みなら明細の追加・変更・削除を禁止（管理者は除く）
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

drop trigger if exists gn_report_lines_guard on public.gn_report_lines;
create trigger gn_report_lines_guard before insert or update or delete on public.gn_report_lines
  for each row execute function public.gn_report_lines_guard();

-- 明細の計算列を、保存された入力値から DB 側で計算し直す（クライアントの金額・人工は信用しない）。
-- 計算は src/lib/calc/report.ts（§6.2）と同じ式。TS の単体テスト（tests/calc/report.test.ts）の期待値：
--   * 共通 08:00〜17:00・休憩60・中抜0 → 実働 8H → 人工 round(8/7.5, 2) = 1.07
--   * 個別 09:00〜15:30・休憩null（共通の60を使う）・中抜30 → 5H
--   * 終了が開始より前 → 0H。共通の開始・終了が無ければ（個別も無ければ）0H
--   * 7.5H → 1 人工。労務費 = 日当 × 人工：18000 × 1.07 = 19260、日当 null → 0
--   * 燃料費 = 走行距離 ÷ 燃費 × 燃料単価：40 ÷ 10 × 170 = 680、燃費 0 / null → 0
--   * リース・現金・買掛・作業内容の金額 = 数量 × 単価：5 × 280 = 1400、数量 null → 0
--   * 歩掛 = 施工数量 ÷ 投入人工：35 ÷ 2 = 17.5、人工 0 / null → null
--   * 日報合計の例：労務 19260 + 7950（15000 × 0.53）、燃料 680、リース 3500、現金 1400、
--     買掛 12500 → 原価 45290、出来高 42000、人工 1.07 + 0.53 = 1.6
-- 労務の時間：個別の開始・終了が両方あれば個別の時刻で、休憩・中抜は「個別 → 共通 → 0」の順。
-- 個別の時刻が無ければ共通の時刻と共通の休憩・中抜で計算する（TS の commonHours と同じ）。
-- 人工は小数2桁に丸める。金額は丸めない（numeric のまま）。時刻は 'HH:MM' の文字列。

-- 'HH:MM' を 0時からの分に直す。形式が違う・空なら null。
create or replace function public.gn_hhmm_minutes(p text)
returns int language sql immutable set search_path = public as $$
  select case
           when p ~ '^\d{1,2}:\d{2}$'
           then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int
         end;
$$;

-- =====================================================================
-- 労務の計算設定（2026-11-03）
-- =====================================================================
-- 1. 設定（1 行だけ） ------------------------------------------------------
create table if not exists public.gn_settings (
  id                       int primary key check (id = 1),
  shotei_hours             numeric not null default 7.5 check (shotei_hours > 0),
  fixed_overtime_limit     numeric not null default 8   check (fixed_overtime_limit >= 0),
  overtime_multiplier      numeric not null default 1.25 check (overtime_multiplier >= 0),
  overtime_base_hours      numeric not null default 8   check (overtime_base_hours > 0),
  default_common_start     text default '08:00',
  default_common_end       text default '17:30',
  default_common_break_min int  default 90,
  default_common_gap_min   int  default 0,
  updated_at               timestamptz not null default now()
);
insert into public.gn_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists gn_settings_touch on public.gn_settings;
create trigger gn_settings_touch before update on public.gn_settings
  for each row execute function public.touch_updated_at();

alter table public.gn_settings enable row level security;
drop policy if exists gn_settings_select on public.gn_settings;
create policy gn_settings_select on public.gn_settings for select to authenticated using (true);
drop policy if exists gn_settings_admin_update on public.gn_settings;
create policy gn_settings_admin_update on public.gn_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- insert / delete のポリシーは作らない（行は 1 つだけ）

create or replace function public.gn_report_lines_compute()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r         public.gn_daily_reports%rowtype;
  s         public.gn_settings%rowtype;
  v_start   int;
  v_end     int;
  v_break   int;
  v_gap     int;
  v_minutes int;
  v_hours   numeric;
  v_rate    numeric;
begin
  if new.kind = 'labor' then
    select * into r from public.gn_daily_reports where id = new.report_id;
    select * into s from public.gn_settings where id = 1;
    if public.gn_hhmm_minutes(new.start_time) is not null
       and public.gn_hhmm_minutes(new.end_time) is not null then
      v_start := public.gn_hhmm_minutes(new.start_time);
      v_end   := public.gn_hhmm_minutes(new.end_time);
      v_break := coalesce(new.break_min, r.common_break_min, 0);
      v_gap   := coalesce(new.gap_min, r.common_gap_min, 0);
    else
      v_start := public.gn_hhmm_minutes(r.common_start);
      v_end   := public.gn_hhmm_minutes(r.common_end);
      v_break := coalesce(r.common_break_min, 0);
      v_gap   := coalesce(r.common_gap_min, 0);
    end if;
    if v_start is null or v_end is null then
      v_minutes := 0;
    else
      v_minutes := greatest(v_end - v_start - v_break - v_gap, 0);
    end if;
    v_hours := round(v_minutes / 60.0, 6);
    new.hours := v_hours;
    -- 人工：所定以下は比例（小数2桁）、所定を超えたら 1.0
    if coalesce(s.shotei_hours, 7.5) <= 0 then
      new.man_days := 0;
    elsif v_hours <= coalesce(s.shotei_hours, 7.5) then
      new.man_days := round(v_hours / coalesce(s.shotei_hours, 7.5), 2);
    else
      new.man_days := 1;
    end if;
    -- 残業時間：固定残業の上限を超えた分
    new.overtime_hours := round(greatest(v_hours - coalesce(s.fixed_overtime_limit, 8), 0), 2);
    -- 残業単価：作業員の単価（0 は空欄扱い）、無ければ 日当 ÷ 基準時間 × 割増率（円未満四捨五入）
    v_rate := nullif(new.overtime_rate, 0);
    if v_rate is null then
      -- 先に掛けてから割る（先に割ると numeric の途中桁が打ち切られ、ちょうど .5 円の値が切り捨てになる）
      v_rate := round(coalesce(new.unit_price, 0) * coalesce(s.overtime_multiplier, 1.25) / coalesce(s.overtime_base_hours, 8), 0);
    end if;
    new.amount       := coalesce(new.unit_price, 0) * new.man_days + new.overtime_hours * v_rate;
    new.productivity := null;
  elsif new.kind = 'fuel' then
    new.amount := case
                    when coalesce(new.km_per_l, 0) = 0 then 0
                    else coalesce(new.distance_km, 0) / new.km_per_l * coalesce(new.price_per_l, 0)
                  end;
    new.hours := null; new.man_days := null; new.productivity := null;
    new.overtime_hours := null; new.overtime_rate := null;
  elsif new.kind in ('lease', 'cash', 'credit') then
    new.amount := coalesce(new.qty, 0) * coalesce(new.unit_price, 0);
    new.hours := null; new.man_days := null; new.productivity := null;
    new.overtime_hours := null; new.overtime_rate := null;
  elsif new.kind = 'work' then
    -- 作業内容の man_days は入力値（投入人工）
    new.amount       := coalesce(new.qty, 0) * coalesce(new.unit_price, 0);
    new.productivity := case when coalesce(new.man_days, 0) = 0 then null else new.qty / new.man_days end;
    new.hours        := null;
    new.overtime_hours := null; new.overtime_rate := null;
  end if;
  return new;
end;
$$;

drop trigger if exists gn_report_lines_compute on public.gn_report_lines;
create trigger gn_report_lines_compute before insert or update on public.gn_report_lines
  for each row execute function public.gn_report_lines_compute();

-- 指摘事項の site_id は親日報の site_id に強制する（他現場の日報への紐付けを防ぐ）。
-- security invoker：親日報の検索は呼び出しユーザーの RLS（gn_daily_reports の select =
-- 現場メンバーのみ）が効くので、他現場の日報は見つからず report_not_found になる。
-- 念のため gn_is_site_member でも明示的に確認する。
-- BEFORE トリガーは RLS の with check より先に走るので、強制後の site_id が検査される。
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

drop trigger if exists gn_report_issues_guard on public.gn_report_issues;
create trigger gn_report_issues_guard before insert or update on public.gn_report_issues
  for each row execute function public.gn_report_issues_guard();

-- ---------- 9. 日報の保存（upsert + 明細の置き換え + 合計の再計算） ----------
-- security invoker：呼び出しユーザーの RLS とガードトリガーがそのまま効く。
-- 承認済み日報を一般ユーザーが保存しようとすると upsert の update 段階で
-- gn_report_guard が approved_report_locked を投げる（全体がロールバックされる）。
-- 合計の更新は draft/submitted/rejected の日報に対してのみ行われ、ガードは status を変えない update を通す。
-- 明細の計算列は gn_report_lines_compute が入力値から計算し直すので、p_lines の amount / hours /
-- man_days（労務）/ productivity は使われない。合計はその計算結果から集計する。
-- 楽観ロック：p_report->>'expected_updated_at'（画面を開いたときの updated_at）があれば、
-- いまの日報の updated_at と比べ、違う（他の端末で更新された・削除された）なら stale_report。
-- 無い（null / 空）なら比べない（新しい日報の作成など）。
create or replace function public.gn_save_report(p_report jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id       uuid;
  v_expected timestamptz;
  v_current  timestamptz;
begin
  v_expected := nullif(p_report->>'expected_updated_at', '')::timestamptz;
  if v_expected is not null then
    select r.updated_at into v_current
      from public.gn_daily_reports r
     where r.site_id = (p_report->>'site_id')::uuid
       and r.report_date = (p_report->>'report_date')::date
       for update;
    if not found or v_current is distinct from v_expected then
      raise exception using message = 'stale_report';
    end if;
  end if;

  insert into public.gn_daily_reports (
    site_id, report_date, weather, supervisor, common_start, common_end,
    common_break_min, common_gap_min, issues_text, notes_text, created_by
  ) values (
    (p_report->>'site_id')::uuid,
    (p_report->>'report_date')::date,
    p_report->>'weather',
    p_report->>'supervisor',
    p_report->>'common_start',
    p_report->>'common_end',
    nullif(p_report->>'common_break_min', '')::numeric::int,
    nullif(p_report->>'common_gap_min', '')::numeric::int,
    p_report->>'issues_text',
    p_report->>'notes_text',
    auth.uid()
  )
  on conflict (site_id, report_date) do update set
    weather          = excluded.weather,
    supervisor       = excluded.supervisor,
    common_start     = excluded.common_start,
    common_end       = excluded.common_end,
    common_break_min = excluded.common_break_min,
    common_gap_min   = excluded.common_gap_min,
    issues_text      = excluded.issues_text,
    notes_text       = excluded.notes_text
  returning id into v_id;

  delete from public.gn_report_lines where report_id = v_id;

  insert into public.gn_report_lines (
    report_id, kind, sort_order, ref_id, name, spec, unit, qty, unit_price, amount,
    start_time, end_time, break_min, gap_min, hours, man_days, km_per_l, distance_km,
    price_per_l, vendor, trade, description, productivity, source, note,
    overtime_hours, overtime_rate
  )
  select
    v_id, t.kind, coalesce(t.sort_order, e.ord::int), t.ref_id, t.name, t.spec, t.unit,
    t.qty, t.unit_price, t.amount, t.start_time, t.end_time, t.break_min, t.gap_min,
    t.hours, t.man_days, t.km_per_l, t.distance_km, t.price_per_l, t.vendor, t.trade,
    t.description, t.productivity, t.source, t.note,
    t.overtime_hours, t.overtime_rate
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as e(elem, ord),
       lateral jsonb_populate_record(null::public.gn_report_lines, e.elem) as t
  order by coalesce(t.sort_order, e.ord::int), e.ord;

  -- 合計の書き込みはこの関数の中だけ（gn_report_guard が gn.in_save を確認する）。
  -- is_local = true なのでトランザクションの終わりで消えるが、念のため直後に戻す。
  perform set_config('gn.in_save', '1', true);
  update public.gn_daily_reports r set
    output_total   = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'work'), 0),
    cost_total     = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind <> 'work'), 0),
    man_days_total = coalesce((select sum(l.man_days) from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'labor'), 0)
  where r.id = v_id;
  perform set_config('gn.in_save', '', true);

  return v_id;
end;
$$;

-- ---------- 10. RLS（gn_* すべて有効化） ----------
alter table public.gn_sites enable row level security;
alter table public.gn_site_members enable row level security;
alter table public.gn_workers enable row level security;
alter table public.gn_worker_rates enable row level security;
alter table public.gn_suppliers enable row level security;
alter table public.gn_vehicles enable row level security;
alter table public.gn_lease_items enable row level security;
alter table public.gn_lease_item_rates enable row level security;
alter table public.gn_site_workers enable row level security;
alter table public.gn_site_suppliers enable row level security;
alter table public.gn_site_vehicles enable row level security;
alter table public.gn_site_lease_items enable row level security;
alter table public.gn_units enable row level security;
alter table public.gn_weather_options enable row level security;
alter table public.gn_daily_reports enable row level security;
alter table public.gn_report_lines enable row level security;
alter table public.gn_report_issues enable row level security;
alter table public.gn_carryovers enable row level security;

-- 現場：メンバー（と管理者）だけ閲覧、変更は管理者のみ
drop policy if exists gn_sites_select on public.gn_sites;
create policy gn_sites_select on public.gn_sites for select to authenticated using (public.gn_is_site_member(id));
drop policy if exists gn_sites_admin_insert on public.gn_sites;
create policy gn_sites_admin_insert on public.gn_sites for insert to authenticated with check (public.is_admin());
drop policy if exists gn_sites_admin_update on public.gn_sites;
create policy gn_sites_admin_update on public.gn_sites for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_sites_admin_delete on public.gn_sites;
create policy gn_sites_admin_delete on public.gn_sites for delete to authenticated using (public.is_admin());

-- マスター6表・単位・天候：全認証ユーザーが閲覧、変更は管理者のみ
drop policy if exists gn_workers_select on public.gn_workers;
create policy gn_workers_select on public.gn_workers for select to authenticated using (true);
drop policy if exists gn_workers_admin_insert on public.gn_workers;
create policy gn_workers_admin_insert on public.gn_workers for insert to authenticated with check (public.is_admin());
drop policy if exists gn_workers_admin_update on public.gn_workers;
create policy gn_workers_admin_update on public.gn_workers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_workers_admin_delete on public.gn_workers;
create policy gn_workers_admin_delete on public.gn_workers for delete to authenticated using (public.is_admin());
drop policy if exists gn_worker_rates_select on public.gn_worker_rates;
create policy gn_worker_rates_select on public.gn_worker_rates for select to authenticated using (true);
drop policy if exists gn_worker_rates_admin_insert on public.gn_worker_rates;
create policy gn_worker_rates_admin_insert on public.gn_worker_rates for insert to authenticated with check (public.is_admin());
drop policy if exists gn_worker_rates_admin_update on public.gn_worker_rates;
create policy gn_worker_rates_admin_update on public.gn_worker_rates for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_worker_rates_admin_delete on public.gn_worker_rates;
create policy gn_worker_rates_admin_delete on public.gn_worker_rates for delete to authenticated using (public.is_admin());
drop policy if exists gn_suppliers_select on public.gn_suppliers;
create policy gn_suppliers_select on public.gn_suppliers for select to authenticated using (true);
drop policy if exists gn_suppliers_admin_insert on public.gn_suppliers;
create policy gn_suppliers_admin_insert on public.gn_suppliers for insert to authenticated with check (public.is_admin());
drop policy if exists gn_suppliers_admin_update on public.gn_suppliers;
create policy gn_suppliers_admin_update on public.gn_suppliers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_suppliers_admin_delete on public.gn_suppliers;
create policy gn_suppliers_admin_delete on public.gn_suppliers for delete to authenticated using (public.is_admin());
drop policy if exists gn_vehicles_select on public.gn_vehicles;
create policy gn_vehicles_select on public.gn_vehicles for select to authenticated using (true);
drop policy if exists gn_vehicles_admin_insert on public.gn_vehicles;
create policy gn_vehicles_admin_insert on public.gn_vehicles for insert to authenticated with check (public.is_admin());
drop policy if exists gn_vehicles_admin_update on public.gn_vehicles;
create policy gn_vehicles_admin_update on public.gn_vehicles for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_vehicles_admin_delete on public.gn_vehicles;
create policy gn_vehicles_admin_delete on public.gn_vehicles for delete to authenticated using (public.is_admin());
drop policy if exists gn_lease_items_select on public.gn_lease_items;
create policy gn_lease_items_select on public.gn_lease_items for select to authenticated using (true);
drop policy if exists gn_lease_items_admin_insert on public.gn_lease_items;
create policy gn_lease_items_admin_insert on public.gn_lease_items for insert to authenticated with check (public.is_admin());
drop policy if exists gn_lease_items_admin_update on public.gn_lease_items;
create policy gn_lease_items_admin_update on public.gn_lease_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_lease_items_admin_delete on public.gn_lease_items;
create policy gn_lease_items_admin_delete on public.gn_lease_items for delete to authenticated using (public.is_admin());
drop policy if exists gn_lease_item_rates_select on public.gn_lease_item_rates;
create policy gn_lease_item_rates_select on public.gn_lease_item_rates for select to authenticated using (true);
drop policy if exists gn_lease_item_rates_admin_insert on public.gn_lease_item_rates;
create policy gn_lease_item_rates_admin_insert on public.gn_lease_item_rates for insert to authenticated with check (public.is_admin());
drop policy if exists gn_lease_item_rates_admin_update on public.gn_lease_item_rates;
create policy gn_lease_item_rates_admin_update on public.gn_lease_item_rates for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_lease_item_rates_admin_delete on public.gn_lease_item_rates;
create policy gn_lease_item_rates_admin_delete on public.gn_lease_item_rates for delete to authenticated using (public.is_admin());
drop policy if exists gn_units_select on public.gn_units;
create policy gn_units_select on public.gn_units for select to authenticated using (true);
drop policy if exists gn_units_admin_insert on public.gn_units;
create policy gn_units_admin_insert on public.gn_units for insert to authenticated with check (public.is_admin());
drop policy if exists gn_units_admin_update on public.gn_units;
create policy gn_units_admin_update on public.gn_units for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_units_admin_delete on public.gn_units;
create policy gn_units_admin_delete on public.gn_units for delete to authenticated using (public.is_admin());
drop policy if exists gn_weather_options_select on public.gn_weather_options;
create policy gn_weather_options_select on public.gn_weather_options for select to authenticated using (true);
drop policy if exists gn_weather_options_admin_insert on public.gn_weather_options;
create policy gn_weather_options_admin_insert on public.gn_weather_options for insert to authenticated with check (public.is_admin());
drop policy if exists gn_weather_options_admin_update on public.gn_weather_options;
create policy gn_weather_options_admin_update on public.gn_weather_options for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_weather_options_admin_delete on public.gn_weather_options;
create policy gn_weather_options_admin_delete on public.gn_weather_options for delete to authenticated using (public.is_admin());

-- 現場メンバー・現場×マスター4表・繰越：現場メンバーが閲覧、変更は管理者のみ
drop policy if exists gn_site_members_select on public.gn_site_members;
create policy gn_site_members_select on public.gn_site_members for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_members_admin_insert on public.gn_site_members;
create policy gn_site_members_admin_insert on public.gn_site_members for insert to authenticated with check (public.is_admin());
drop policy if exists gn_site_members_admin_update on public.gn_site_members;
create policy gn_site_members_admin_update on public.gn_site_members for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_site_members_admin_delete on public.gn_site_members;
create policy gn_site_members_admin_delete on public.gn_site_members for delete to authenticated using (public.is_admin());
drop policy if exists gn_site_workers_select on public.gn_site_workers;
create policy gn_site_workers_select on public.gn_site_workers for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_workers_admin_insert on public.gn_site_workers;
create policy gn_site_workers_admin_insert on public.gn_site_workers for insert to authenticated with check (public.is_admin());
drop policy if exists gn_site_workers_admin_update on public.gn_site_workers;
create policy gn_site_workers_admin_update on public.gn_site_workers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_site_workers_admin_delete on public.gn_site_workers;
create policy gn_site_workers_admin_delete on public.gn_site_workers for delete to authenticated using (public.is_admin());
drop policy if exists gn_site_suppliers_select on public.gn_site_suppliers;
create policy gn_site_suppliers_select on public.gn_site_suppliers for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_suppliers_admin_insert on public.gn_site_suppliers;
create policy gn_site_suppliers_admin_insert on public.gn_site_suppliers for insert to authenticated with check (public.is_admin());
drop policy if exists gn_site_suppliers_admin_update on public.gn_site_suppliers;
create policy gn_site_suppliers_admin_update on public.gn_site_suppliers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_site_suppliers_admin_delete on public.gn_site_suppliers;
create policy gn_site_suppliers_admin_delete on public.gn_site_suppliers for delete to authenticated using (public.is_admin());
drop policy if exists gn_site_vehicles_select on public.gn_site_vehicles;
create policy gn_site_vehicles_select on public.gn_site_vehicles for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_vehicles_admin_insert on public.gn_site_vehicles;
create policy gn_site_vehicles_admin_insert on public.gn_site_vehicles for insert to authenticated with check (public.is_admin());
drop policy if exists gn_site_vehicles_admin_update on public.gn_site_vehicles;
create policy gn_site_vehicles_admin_update on public.gn_site_vehicles for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_site_vehicles_admin_delete on public.gn_site_vehicles;
create policy gn_site_vehicles_admin_delete on public.gn_site_vehicles for delete to authenticated using (public.is_admin());
drop policy if exists gn_site_lease_items_select on public.gn_site_lease_items;
create policy gn_site_lease_items_select on public.gn_site_lease_items for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_lease_items_admin_insert on public.gn_site_lease_items;
create policy gn_site_lease_items_admin_insert on public.gn_site_lease_items for insert to authenticated with check (public.is_admin());
drop policy if exists gn_site_lease_items_admin_update on public.gn_site_lease_items;
create policy gn_site_lease_items_admin_update on public.gn_site_lease_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_site_lease_items_admin_delete on public.gn_site_lease_items;
create policy gn_site_lease_items_admin_delete on public.gn_site_lease_items for delete to authenticated using (public.is_admin());
drop policy if exists gn_carryovers_select on public.gn_carryovers;
create policy gn_carryovers_select on public.gn_carryovers for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_carryovers_admin_insert on public.gn_carryovers;
create policy gn_carryovers_admin_insert on public.gn_carryovers for insert to authenticated with check (public.is_admin());
drop policy if exists gn_carryovers_admin_update on public.gn_carryovers;
create policy gn_carryovers_admin_update on public.gn_carryovers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_carryovers_admin_delete on public.gn_carryovers;
create policy gn_carryovers_admin_delete on public.gn_carryovers for delete to authenticated using (public.is_admin());

-- 日報・指摘事項：現場メンバーが閲覧・追加・更新。
-- 日報の削除は管理者、または作成者本人（現場メンバーのまま）で下書き・差戻しの日報だけ。
-- 明細・指摘事項は on delete cascade で一緒に消える。指摘事項だけの削除は管理者のみ
drop policy if exists gn_daily_reports_select on public.gn_daily_reports;
create policy gn_daily_reports_select on public.gn_daily_reports for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_insert on public.gn_daily_reports;
create policy gn_daily_reports_insert on public.gn_daily_reports for insert to authenticated with check (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_update on public.gn_daily_reports;
create policy gn_daily_reports_update on public.gn_daily_reports for update to authenticated using (public.gn_is_site_member(site_id)) with check (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_delete on public.gn_daily_reports;
create policy gn_daily_reports_delete on public.gn_daily_reports for delete to authenticated using (public.is_admin() or (created_by = auth.uid() and status in ('draft','rejected') and public.gn_is_site_member(site_id)));
drop policy if exists gn_report_issues_select on public.gn_report_issues;
create policy gn_report_issues_select on public.gn_report_issues for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_report_issues_insert on public.gn_report_issues;
create policy gn_report_issues_insert on public.gn_report_issues for insert to authenticated with check (public.gn_is_site_member(site_id));
drop policy if exists gn_report_issues_update on public.gn_report_issues;
create policy gn_report_issues_update on public.gn_report_issues for update to authenticated using (public.gn_is_site_member(site_id)) with check (public.gn_is_site_member(site_id));
drop policy if exists gn_report_issues_delete on public.gn_report_issues;
create policy gn_report_issues_delete on public.gn_report_issues for delete to authenticated using (public.is_admin());

-- 日報明細：親日報の site_id で同じ条件
drop policy if exists gn_report_lines_select on public.gn_report_lines;
create policy gn_report_lines_select on public.gn_report_lines for select to authenticated using (exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id)));
drop policy if exists gn_report_lines_insert on public.gn_report_lines;
create policy gn_report_lines_insert on public.gn_report_lines for insert to authenticated with check (exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id)));
drop policy if exists gn_report_lines_update on public.gn_report_lines;
create policy gn_report_lines_update on public.gn_report_lines for update to authenticated using (exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))) with check (exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id)));
drop policy if exists gn_report_lines_delete on public.gn_report_lines;
create policy gn_report_lines_delete on public.gn_report_lines for delete to authenticated using (exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id)));

-- ---------- 11. Storage バケット（非公開）と現場単位のアクセス制御 ----------
-- パス規約：3つのバケット (gn-photos / gn-estimates / gn-exports) のすべてのオブジェクトは
--   <site_id>/...   （最初のフォルダ = gn_sites.id の uuid）
-- に保存する。例: gn-photos/0b1c...-....-....-....-............/2026-11-01/001.jpg
-- アクセスできるのはその現場のメンバー（または管理者）だけ。
-- 最初のフォルダが uuid でない、または現場メンバーでないオブジェクトは誰も読み書きできない。
-- 更新・削除はさらにアップロード者本人（owner）または管理者に限る。
insert into storage.buckets (id, name, public) values
  ('gn-photos',    'gn-photos',    false),
  ('gn-estimates', 'gn-estimates', false),
  ('gn-exports',   'gn-exports',   false)
on conflict (id) do nothing;

-- オブジェクト名の先頭フォルダを現場 uuid として取り出す。uuid でなければ null。
create or replace function public.gn_storage_site(name text)
returns uuid language sql immutable set search_path = public as $$
  select case
           when name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
           then substr(name, 1, 36)::uuid
         end;
$$;

drop policy if exists gn_photos_read on storage.objects;
create policy gn_photos_read on storage.objects for select to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_photos_insert on storage.objects;
create policy gn_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_photos_update on storage.objects;
create policy gn_photos_update on storage.objects for update to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin())) with check (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));
drop policy if exists gn_photos_delete on storage.objects;
create policy gn_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));
drop policy if exists gn_estimates_read on storage.objects;
create policy gn_estimates_read on storage.objects for select to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_estimates_insert on storage.objects;
create policy gn_estimates_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_estimates_update on storage.objects;
create policy gn_estimates_update on storage.objects for update to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin())) with check (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));
drop policy if exists gn_estimates_delete on storage.objects;
create policy gn_estimates_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));
drop policy if exists gn_exports_read on storage.objects;
create policy gn_exports_read on storage.objects for select to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_exports_insert on storage.objects;
create policy gn_exports_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)));
drop policy if exists gn_exports_update on storage.objects;
create policy gn_exports_update on storage.objects for update to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin())) with check (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));
drop policy if exists gn_exports_delete on storage.objects;
create policy gn_exports_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and (owner = auth.uid() or public.is_admin()));

-- =====================================================================
-- 現場の削除（戻せる非表示）と削除ログ（2026-11-02）
-- =====================================================================
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

-- =====================================================================
-- マスターの更新者の記録と取り込み（2026-11-03）
-- =====================================================================
-- 1. 更新者の列 --------------------------------------------------------------
alter table public.gn_workers          add column if not exists updated_by uuid;
alter table public.gn_suppliers        add column if not exists updated_by uuid;
alter table public.gn_vehicles         add column if not exists updated_by uuid;
alter table public.gn_lease_items      add column if not exists updated_by uuid;
alter table public.gn_worker_rates     add column if not exists updated_at timestamptz not null default now();
alter table public.gn_worker_rates     add column if not exists updated_by uuid;
alter table public.gn_lease_item_rates add column if not exists updated_at timestamptz not null default now();
alter table public.gn_lease_item_rates add column if not exists updated_by uuid;
alter table public.gn_settings         add column if not exists updated_by uuid;

-- insert / update のたびに updated_at と updated_by を入れる（auth.uid() が無い SQL Editor からは updated_by を変えない）
create or replace function public.gn_touch_updated()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists gn_workers_touch on public.gn_workers;
create trigger gn_workers_touch before insert or update on public.gn_workers
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_suppliers_touch on public.gn_suppliers;
create trigger gn_suppliers_touch before insert or update on public.gn_suppliers
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_vehicles_touch on public.gn_vehicles;
create trigger gn_vehicles_touch before insert or update on public.gn_vehicles
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_lease_items_touch on public.gn_lease_items;
create trigger gn_lease_items_touch before insert or update on public.gn_lease_items
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_worker_rates_touch on public.gn_worker_rates;
create trigger gn_worker_rates_touch before insert or update on public.gn_worker_rates
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_lease_item_rates_touch on public.gn_lease_item_rates;
create trigger gn_lease_item_rates_touch before insert or update on public.gn_lease_item_rates
  for each row execute function public.gn_touch_updated();
drop trigger if exists gn_settings_touch on public.gn_settings;
create trigger gn_settings_touch before insert or update on public.gn_settings
  for each row execute function public.gn_touch_updated();

-- 2. 取り込み履歴 -----------------------------------------------------------
create table if not exists public.gn_import_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_name  text,
  actor_email text,
  file_name   text,
  effective_from date,
  counts      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.gn_import_log enable row level security;
drop policy if exists gn_import_log_admin_select on public.gn_import_log;
create policy gn_import_log_admin_select on public.gn_import_log
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.gn_import_log from authenticated, anon;

-- 3. 取り込み（管理者のみ・1 トランザクション） --------------------------------
-- p_payload の形：
-- { "workers":     [{"name":"山田 太郎","trade":"大工","note":null,"daily_rate":18000,"overtime_rate":null}],
--   "suppliers":   [{"name":"○○建材","category":"仕入","contact":"佐藤","note":null}],
--   "vehicles":    [{"name":"ハイエース 1234","kind":"バン","km_per_l":9.5,"note":null}],
--   "lease_items": [{"name":"発電機","spec":"2kVA","note":null,"unit_price":3000}] }
-- 文字列の空は null として扱う。数値は数値（null 可）。
-- 返り値：{"workers":{"inserted":n,"updated":n,"unchanged":n}, "suppliers":{…}, "vehicles":{…}, "lease_items":{…}, "log_id": n}
create or replace function public.gn_import_masters(p_file_name text, p_effective_from date, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e        jsonb;
  v_name   text;
  v_id     uuid;
  v_changed boolean;
  v_new    boolean;
  v_rate   numeric;
  v_cur    numeric;
  w_ins int := 0; w_upd int := 0; w_same int := 0;
  s_ins int := 0; s_upd int := 0; s_same int := 0;
  v_ins int := 0; v_upd int := 0; v_same int := 0;
  l_ins int := 0; l_upd int := 0; l_same int := 0;
  v_pname text; v_email text;
  v_counts jsonb;
  v_log_id bigint;
  v_from date := coalesce(p_effective_from, current_date);
begin
  if not public.is_admin() then
    raise exception using message = 'not_admin';
  end if;

  -- 作業員
  for e in select * from jsonb_array_elements(coalesce(p_payload->'workers', '[]'::jsonb)) loop
    v_name := nullif(btrim(e->>'name'), '');
    if v_name is null then continue; end if;
    select id into v_id from public.gn_workers where btrim(name) = v_name order by created_at limit 1;
    v_new := false; v_changed := false;
    if v_id is null then
      insert into public.gn_workers (name, trade, note, overtime_rate)
      values (v_name, nullif(btrim(e->>'trade'), ''), nullif(btrim(e->>'note'), ''), nullif((e->>'overtime_rate')::numeric, 0))
      returning id into v_id;
      v_new := true;
    else
      update public.gn_workers set
        trade = coalesce(nullif(btrim(e->>'trade'), ''), trade),
        note  = coalesce(nullif(btrim(e->>'note'), ''), note),
        overtime_rate = case when e ? 'overtime_rate' and e->>'overtime_rate' is not null then nullif((e->>'overtime_rate')::numeric, 0) else overtime_rate end
      where id = v_id
        and (trade is distinct from coalesce(nullif(btrim(e->>'trade'), ''), trade)
          or note is distinct from coalesce(nullif(btrim(e->>'note'), ''), note)
          or (e ? 'overtime_rate' and e->>'overtime_rate' is not null and overtime_rate is distinct from nullif((e->>'overtime_rate')::numeric, 0)));
      v_changed := found;
    end if;
    -- 日当：有効単価と違うときだけ履歴を追加（同じ日付は上書き）
    v_rate := (e->>'daily_rate')::numeric;
    if v_rate is not null then
      select amount into v_cur from public.gn_worker_rates
       where worker_id = v_id and effective_from <= v_from order by effective_from desc limit 1;
      if v_cur is distinct from v_rate then
        insert into public.gn_worker_rates (worker_id, amount, effective_from) values (v_id, v_rate, v_from)
        on conflict (worker_id, effective_from) do update set amount = excluded.amount;
        v_changed := true;
      end if;
    end if;
    if v_new then w_ins := w_ins + 1;
    elsif v_changed then w_upd := w_upd + 1;
    else w_same := w_same + 1;
    end if;
  end loop;

  -- 取引先
  for e in select * from jsonb_array_elements(coalesce(p_payload->'suppliers', '[]'::jsonb)) loop
    v_name := nullif(btrim(e->>'name'), '');
    if v_name is null then continue; end if;
    select id into v_id from public.gn_suppliers where btrim(name) = v_name order by created_at limit 1;
    if v_id is null then
      insert into public.gn_suppliers (name, category, contact, note)
      values (v_name, nullif(btrim(e->>'category'), ''), nullif(btrim(e->>'contact'), ''), nullif(btrim(e->>'note'), ''));
      s_ins := s_ins + 1;
    else
      update public.gn_suppliers set
        category = coalesce(nullif(btrim(e->>'category'), ''), category),
        contact  = coalesce(nullif(btrim(e->>'contact'), ''), contact),
        note     = coalesce(nullif(btrim(e->>'note'), ''), note)
      where id = v_id
        and (category is distinct from coalesce(nullif(btrim(e->>'category'), ''), category)
          or contact is distinct from coalesce(nullif(btrim(e->>'contact'), ''), contact)
          or note is distinct from coalesce(nullif(btrim(e->>'note'), ''), note));
      if found then s_upd := s_upd + 1; else s_same := s_same + 1; end if;
    end if;
  end loop;

  -- 車両
  for e in select * from jsonb_array_elements(coalesce(p_payload->'vehicles', '[]'::jsonb)) loop
    v_name := nullif(btrim(e->>'name'), '');
    if v_name is null then continue; end if;
    select id into v_id from public.gn_vehicles where btrim(name) = v_name order by created_at limit 1;
    if v_id is null then
      insert into public.gn_vehicles (name, kind, km_per_l, note)
      values (v_name, nullif(btrim(e->>'kind'), ''), (e->>'km_per_l')::numeric, nullif(btrim(e->>'note'), ''));
      v_ins := v_ins + 1;
    else
      update public.gn_vehicles set
        kind     = coalesce(nullif(btrim(e->>'kind'), ''), kind),
        km_per_l = coalesce((e->>'km_per_l')::numeric, km_per_l),
        note     = coalesce(nullif(btrim(e->>'note'), ''), note)
      where id = v_id
        and (kind is distinct from coalesce(nullif(btrim(e->>'kind'), ''), kind)
          or km_per_l is distinct from coalesce((e->>'km_per_l')::numeric, km_per_l)
          or note is distinct from coalesce(nullif(btrim(e->>'note'), ''), note));
      if found then v_upd := v_upd + 1; else v_same := v_same + 1; end if;
    end if;
  end loop;

  -- リース品
  for e in select * from jsonb_array_elements(coalesce(p_payload->'lease_items', '[]'::jsonb)) loop
    v_name := nullif(btrim(e->>'name'), '');
    if v_name is null then continue; end if;
    select id into v_id from public.gn_lease_items where btrim(name) = v_name order by created_at limit 1;
    v_changed := false;
    if v_id is null then
      insert into public.gn_lease_items (name, spec, note)
      values (v_name, nullif(btrim(e->>'spec'), ''), nullif(btrim(e->>'note'), ''))
      returning id into v_id;
      l_ins := l_ins + 1;
      v_rate := (e->>'unit_price')::numeric;
      if v_rate is not null then
        insert into public.gn_lease_item_rates (item_id, amount, effective_from) values (v_id, v_rate, v_from)
        on conflict (item_id, effective_from) do update set amount = excluded.amount;
      end if;
    else
      update public.gn_lease_items set
        spec = coalesce(nullif(btrim(e->>'spec'), ''), spec),
        note = coalesce(nullif(btrim(e->>'note'), ''), note)
      where id = v_id
        and (spec is distinct from coalesce(nullif(btrim(e->>'spec'), ''), spec)
          or note is distinct from coalesce(nullif(btrim(e->>'note'), ''), note));
      v_changed := found;
      v_rate := (e->>'unit_price')::numeric;
      if v_rate is not null then
        select amount into v_cur from public.gn_lease_item_rates
         where item_id = v_id and effective_from <= v_from order by effective_from desc limit 1;
        if v_cur is distinct from v_rate then
          insert into public.gn_lease_item_rates (item_id, amount, effective_from) values (v_id, v_rate, v_from)
          on conflict (item_id, effective_from) do update set amount = excluded.amount;
          v_changed := true;
        end if;
      end if;
      if v_changed then l_upd := l_upd + 1; else l_same := l_same + 1; end if;
    end if;
  end loop;

  v_counts := jsonb_build_object(
    'workers',     jsonb_build_object('inserted', w_ins, 'updated', w_upd, 'unchanged', w_same),
    'suppliers',   jsonb_build_object('inserted', s_ins, 'updated', s_upd, 'unchanged', s_same),
    'vehicles',    jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same),
    'lease_items', jsonb_build_object('inserted', l_ins, 'updated', l_upd, 'unchanged', l_same)
  );
  select name, email into v_pname, v_email from public.profiles where id = auth.uid();
  insert into public.gn_import_log (actor_id, actor_name, actor_email, file_name, effective_from, counts)
  values (auth.uid(), v_pname, v_email, nullif(btrim(p_file_name), ''), v_from, v_counts)
  returning id into v_log_id;
  return v_counts || jsonb_build_object('log_id', v_log_id);
end;
$$;

revoke all on function public.gn_import_masters(text, date, jsonb) from public, anon;
grant execute on function public.gn_import_masters(text, date, jsonb) to authenticated;

-- =====================================================================
-- 氏名の参照関数（Excel 出力用、2026-11-03）
-- =====================================================================
create or replace function public.gn_profile_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.name), ''), p.email, '') as display_name
    from public.profiles p
   where auth.uid() is not null
     and p.id = any (coalesce(p_ids, array[]::uuid[]));
$$;
revoke all on function public.gn_profile_names(uuid[]) from public, anon;
grant execute on function public.gn_profile_names(uuid[]) to authenticated;
