-- 人工・残業ルールの反映（V34 雛形と同じ計算）と、共通時間の既定値
-- 2026-11-03。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- 新規環境では schema_genba.sql に同じ内容が含まれているので、このファイルは不要。
--
-- ルール（docs/superpowers/plans/2026-10-30-phase1-record.md「決定（2026-10-31）人工・残業ルール」）
--   人工        = 実働 ≤ 所定（既定 7.5H）なら ROUND(実働 ÷ 所定, 2)、超えたら 1.0
--   残業時間(H) = MAX(実働 − 固定残業の上限（既定 8.0H）, 0)
--   残業単価    = 作業員の残業単価（空欄・0 なら ROUND(日当 ÷ 基準時間（既定 8）× 割増率（既定 1.25）, 0)）
--   労務費      = 日当 × 人工 ＋ 残業時間 × 残業単価
-- 設定の変更は、その後に保存した日報から効く（保存済みの日報の値は保存し直すまで変わらない）。

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

-- 2. 作業員の残業単価（円/H。null・0 は「標準の計算式を使う」） ----------------
alter table public.gn_workers add column if not exists overtime_rate numeric check (overtime_rate is null or overtime_rate >= 0);

-- 3. 明細の残業列（保存時のスナップショット） -------------------------------
alter table public.gn_report_lines add column if not exists overtime_hours numeric;
alter table public.gn_report_lines add column if not exists overtime_rate  numeric;

-- 4. 現場ごとの共通時間の既定（null なら gn_settings の既定を使う） ------------
alter table public.gn_sites add column if not exists common_start     text;
alter table public.gn_sites add column if not exists common_end       text;
alter table public.gn_sites add column if not exists common_break_min int;
alter table public.gn_sites add column if not exists common_gap_min   int;

-- 5. 明細の再計算（労務の人工・残業・労務費） --------------------------------
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

-- 6. 保存 RPC：明細の残業列（overtime_hours・overtime_rate）を受け取る -----------
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
