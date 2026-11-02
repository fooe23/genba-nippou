-- マスターの更新者の記録と、Excel／CSV からの取り込み
-- 2026-11-03。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- 新規環境では schema_genba.sql に同じ内容が含まれているので、このファイルは不要。
--
--   * 作業員・取引先・車両・リース品・単価履歴・労務の設定に updated_by（更新した人）を持ち、
--     insert / update のたびにトリガーで auth.uid() を自動で入れる（アプリは明示しない）。
--   * 取り込みは RPC gn_import_masters(p_file_name, p_effective_from, p_payload) で 1 トランザクション。
--     名前の完全一致（前後の空白は除く）で既存と突き合わせ、無ければ追加、あれば差分だけ更新。
--     日当・リース単価は履歴：p_effective_from 時点の有効単価と違うときだけ、その日付の履歴を追加（同じ日付は上書き）。
--     Excel に無い行は消さない・無効化しない。
--   * 取り込み履歴 gn_import_log（誰が・いつ・ファイル名・種別ごとの件数）。管理者のみ閲覧。

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
