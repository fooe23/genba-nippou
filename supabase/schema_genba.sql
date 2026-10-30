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
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

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
  active     boolean default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at    timestamptz not null default now()
);
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
-- 現場メンバー（または管理者）か
create or replace function public.gn_is_site_member(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public.gn_site_members
            where site_id = p_site and user_id = auth.uid()
         )
         or public.is_admin();
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
-- 承認済み日報の変更禁止（管理者は除く）／承認・差戻しは reviewer 以上のみ
-- メッセージ文字列はクライアントが判定に使うため変更しないこと
create or replace function public.gn_report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved' and not public.is_admin() then
    raise exception using message = 'approved_report_locked';
  end if;
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    if coalesce(public.gn_site_role(new.site_id), '') not in ('reviewer','approver') then
      raise exception using message = 'not_reviewer';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists gn_report_guard on public.gn_daily_reports;
create trigger gn_report_guard before update on public.gn_daily_reports
  for each row execute function public.gn_report_guard();

-- 親日報が承認済みなら明細の追加・変更・削除を禁止（管理者は除く）
create or replace function public.gn_report_lines_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
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

-- ---------- 9. 日報の保存（upsert + 明細の置き換え + 合計の再計算） ----------
-- security invoker：呼び出しユーザーの RLS とガードトリガーがそのまま効く。
-- 承認済み日報を一般ユーザーが保存しようとすると upsert の update 段階で
-- gn_report_guard が approved_report_locked を投げる（全体がロールバックされる）。
-- 合計の更新は draft/submitted/rejected の日報に対してのみ行われ、ガードは status を変えない update を通す。
create or replace function public.gn_save_report(p_report jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
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
    price_per_l, vendor, trade, description, productivity, source, note
  )
  select
    v_id, t.kind, coalesce(t.sort_order, e.ord::int), t.ref_id, t.name, t.spec, t.unit,
    t.qty, t.unit_price, t.amount, t.start_time, t.end_time, t.break_min, t.gap_min,
    t.hours, t.man_days, t.km_per_l, t.distance_km, t.price_per_l, t.vendor, t.trade,
    t.description, t.productivity, t.source, t.note
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as e(elem, ord),
       lateral jsonb_populate_record(null::public.gn_report_lines, e.elem) as t
  order by coalesce(t.sort_order, e.ord::int), e.ord;

  update public.gn_daily_reports r set
    output_total   = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'work'), 0),
    cost_total     = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind <> 'work'), 0),
    man_days_total = coalesce((select sum(l.man_days) from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'labor'), 0)
  where r.id = v_id;

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

-- 日報・指摘事項：現場メンバーが閲覧・追加・更新、削除は管理者のみ
drop policy if exists gn_daily_reports_select on public.gn_daily_reports;
create policy gn_daily_reports_select on public.gn_daily_reports for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_insert on public.gn_daily_reports;
create policy gn_daily_reports_insert on public.gn_daily_reports for insert to authenticated with check (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_update on public.gn_daily_reports;
create policy gn_daily_reports_update on public.gn_daily_reports for update to authenticated using (public.gn_is_site_member(site_id)) with check (public.gn_is_site_member(site_id));
drop policy if exists gn_daily_reports_delete on public.gn_daily_reports;
create policy gn_daily_reports_delete on public.gn_daily_reports for delete to authenticated using (public.is_admin());
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

-- ---------- 11. Storage バケット（非公開。第1計画では作成と基本ポリシーのみ） ----------
insert into storage.buckets (id, name, public) values
  ('gn-photos',    'gn-photos',    false),
  ('gn-estimates', 'gn-estimates', false),
  ('gn-exports',   'gn-exports',   false)
on conflict (id) do nothing;

drop policy if exists gn_photos_read on storage.objects;
create policy gn_photos_read on storage.objects for select to authenticated using (bucket_id = 'gn-photos');
drop policy if exists gn_photos_insert on storage.objects;
create policy gn_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-photos');
drop policy if exists gn_photos_update on storage.objects;
create policy gn_photos_update on storage.objects for update to authenticated using (bucket_id = 'gn-photos') with check (bucket_id = 'gn-photos');
drop policy if exists gn_estimates_read on storage.objects;
create policy gn_estimates_read on storage.objects for select to authenticated using (bucket_id = 'gn-estimates');
drop policy if exists gn_estimates_insert on storage.objects;
create policy gn_estimates_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-estimates');
drop policy if exists gn_estimates_update on storage.objects;
create policy gn_estimates_update on storage.objects for update to authenticated using (bucket_id = 'gn-estimates') with check (bucket_id = 'gn-estimates');
drop policy if exists gn_exports_read on storage.objects;
create policy gn_exports_read on storage.objects for select to authenticated using (bucket_id = 'gn-exports');
drop policy if exists gn_exports_insert on storage.objects;
create policy gn_exports_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-exports');
drop policy if exists gn_exports_update on storage.objects;
create policy gn_exports_update on storage.objects for update to authenticated using (bucket_id = 'gn-exports') with check (bucket_id = 'gn-exports');
