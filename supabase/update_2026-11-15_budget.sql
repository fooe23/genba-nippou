-- 2026-11-15：積算連携の第 1 段階（現場の工種・元請けの内訳・実行予算・読み替え表・進み具合の上書き）。何度実行しても安全。
-- update_2026-11-14_estimate_submitted.sql の後に 1 回実行する（schema_genba.sql には反映済み）。
-- アプリは日報の作業内容の行に site_trade_id を送り、予算の画面でこれらの表を読むので、アプリを新しい版にする前に実行する。
--
-- 1. 新しい表（RLS あり）：
--    * gn_site_trades（現場の工種。読む＝現場メンバー［協力会社も］、書く＝社員・管理者）
--    * gn_contract_items（元請けの内訳。読む・書く＝社員・管理者だけ）
--    * gn_budget_lines（実行予算。読む・書く＝社員・管理者だけ）
--    * gn_trade_aliases（読み替え表：日報の工種の文字 → 工種。読む＝現場メンバー、書く＝社員・管理者）
--    * gn_trade_progress（進み具合の上書きの履歴。読む＝社員・管理者、入れる＝管理者か、その現場の確認・承認の人［社員］）
--    書くのはどれも、完了・削除済みの現場では不可（管理者も同じ）。
-- 2. gn_report_lines に site_trade_id（作業内容の行の工種。null＝選んでいない）を足す。
-- 3. gn_save_report を作り直す（今までの動きはすべてそのまま。足したのは site_trade_id の列だけ：作業内容の行だけ書き、
--    それ以外の行は null）。
-- 4. ガード：工種の削除は、日報の作業内容の行・読み替え表・実行予算・元請けの内訳・進み具合の上書きから使われていれば断る（trade_in_use）。
--    工種はその現場のもの（trade_not_in_site）。請負・常用の会社は協力会社の印のある会社（not_partner）。
--    内訳・予算の金額はトリガーが round(数量 × 単価)（1 円単位・四捨五入）で入れ直す。
-- 5. まとめて書く関数（途中で失敗すれば全部戻る）：gn_save_site_trades・gn_replace_budget_lines・gn_replace_contract_items。
-- 6. 全社の設定（gn_settings）に「予算の標準日当」（budget_daily_rate。実行予算の自社の労務の単価の初期値、既定 20000）。
--
-- 制約の名前：列の check は名前を付けない（Postgres の自動の名前 <表>_<列>_check）。表の check だけ
-- gn_contract_items_trade_ck・gn_budget_lines_combo_ck と名前を付ける（自動の名前と重ならない _ck）。
--
-- 拒否の理由（アプリが文言に変える）：trade_in_use（detail に工種の名前）・trade_not_in_site・trade_site_fixed・not_partner・
--   trade_not_found・not_employee・not_member・site_closed・invalid_input。

begin;

-- 予算の標準日当（実行予算の自社の労務［人工］の単価の初期値。円／人工。行ごとに書き換えられる）。管理者が 労務の設定 で変える。
-- 列の check は名前を付けない（自動の名前 gn_settings_budget_daily_rate_check）。
alter table public.gn_settings add column if not exists budget_daily_rate numeric not null default 20000 check (budget_daily_rate >= 0);

-- 現場の工種（実行予算の工種）。名前は現場の中で一意（前後の空白はトリガーが落とす）。日報の作業内容の行・読み替え表・
-- 実行予算・元請けの内訳・進み具合の上書きがこの id を指す。読めるのは現場メンバー（協力会社も。日報で選ぶため）。
-- 書けるのは社員・管理者（完了・削除済みの現場は不可）。名前の一意は遅延（deferrable）にして、gn_save_site_trades の中で
-- 2 つの工種の名前を入れ替えられるようにする。
create table if not exists public.gn_site_trades (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.gn_sites(id),
  name       text not null check (char_length(btrim(name)) between 1 and 50),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (site_id, name) deferrable initially deferred
);

-- 元請けの内訳の行。区分（当初・変更）・名称・規格・数量・単位・単価・金額・識別（工種・経費・減分）。
-- 金額は トリガーが round(数量 × 単価)（1 円単位・四捨五入）で入れ直す（クライアントの値は使わない）。
-- 工種（trade_id）を持てるのは識別が工種（'trade'）の行だけ（工種の行でも null＝まだ識別していない、は可）。
-- 識別に使われている工種は消せない（trade_in_use。on delete set null は念のため）。読めるのも書けるのも社員・管理者だけ。
create table if not exists public.gn_contract_items (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.gn_sites(id),
  section    text not null default 'initial' check (section in ('initial','change')),
  name       text not null check (char_length(btrim(name)) between 1 and 200),
  spec       text not null default '' check (char_length(spec) <= 200),
  qty        numeric not null check (qty > '-Infinity'::numeric and qty < 'Infinity'::numeric),
  unit       text not null default '' check (char_length(unit) <= 20),
  unit_price numeric not null check (unit_price > '-Infinity'::numeric and unit_price < 'Infinity'::numeric),
  amount     numeric not null default 0,
  trade_id   uuid references public.gn_site_trades(id) on delete set null,
  category   text not null default 'trade' check (category in ('trade','expense','reduction')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint gn_contract_items_trade_ck check (category = 'trade' or trade_id is null)
);
create index if not exists gn_contract_items_site_idx  on public.gn_contract_items (site_id, sort_order);
create index if not exists gn_contract_items_trade_idx on public.gn_contract_items (trade_id) where trade_id is not null;

-- 実行予算の行。工種（null＝現場全体）・施工者（自社・協力会社）・項目・内容・数量・単位・単価・金額。
-- 組み合わせ（gn_budget_lines_combo_ck）：
--   * 材料・リース・その他（material・lease・other）は現場全体（trade_id null）・自社・会社なし。
--   * 労務（labor）は自社・会社なし。
--   * 請負・常用（subcontract・jouyou）は協力会社・会社あり（会社は協力会社の印 is_partner。トリガーが確かめる＝not_partner）。
-- 金額はトリガーが round(数量 × 単価) で入れ直す。工種が使われている（行がある）間は工種を消せない（trade_in_use）。
-- 読めるのも書けるのも社員・管理者だけ。
create table if not exists public.gn_budget_lines (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.gn_sites(id),
  trade_id    uuid references public.gn_site_trades(id),
  performer   text not null default 'own' check (performer in ('own','partner')),
  supplier_id uuid references public.gn_suppliers(id),
  item        text not null check (item in ('labor','subcontract','jouyou','material','lease','other')),
  note        text not null default '' check (char_length(note) <= 200),
  qty         numeric not null check (qty >= 0 and qty < 'Infinity'::numeric),
  unit        text not null default '' check (char_length(unit) <= 20),
  unit_price  numeric not null check (unit_price >= 0 and unit_price < 'Infinity'::numeric),
  amount      numeric not null default 0,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  constraint gn_budget_lines_combo_ck check (
    (item in ('material','lease','other') and trade_id is null and performer = 'own' and supplier_id is null)
    or (item = 'labor' and performer = 'own' and supplier_id is null)
    or (item in ('subcontract','jouyou') and performer = 'partner' and supplier_id is not null)
  )
);
create index if not exists gn_budget_lines_site_idx  on public.gn_budget_lines (site_id, sort_order);
create index if not exists gn_budget_lines_trade_idx on public.gn_budget_lines (trade_id) where trade_id is not null;

-- 読み替え表：日報の工種の文字（gn_report_lines.trade）→ 実行予算の工種。日報の行は書き換えずに、集計で使う。
-- 読めるのは現場メンバー、書けるのは社員・管理者。使われている間は工種を消せない（trade_in_use）。
create table if not exists public.gn_trade_aliases (
  site_id    uuid not null references public.gn_sites(id),
  trade_text text not null check (char_length(btrim(trade_text)) between 1 and 200),
  trade_id   uuid not null references public.gn_site_trades(id),
  created_at timestamptz not null default now(),
  primary key (site_id, trade_text)
);
create index if not exists gn_trade_aliases_trade_idx on public.gn_trade_aliases (trade_id);

-- 進み具合の上書き（履歴。工種ごとに set_at の最新の行が有効。percent が null の行は「上書きを消した」）。
-- 入れた人（set_by）・日時（set_at）はトリガーが auth.uid()・now() にする。変更・削除はしない（ポリシーを作らない）。
-- 履歴のある工種は消せない（trade_in_use。on delete cascade は念のため）。読めるのは社員・管理者、入れられるのは社員・管理者のうち、
-- 管理者か、その現場の確認・承認の人（gn_site_role が reviewer・approver）だけ。
create table if not exists public.gn_trade_progress (
  id       uuid primary key default gen_random_uuid(),
  site_id  uuid not null references public.gn_sites(id),
  trade_id uuid not null references public.gn_site_trades(id) on delete cascade,
  percent  numeric check (percent is null or (percent >= 0 and percent <= 100)),
  set_by   uuid references public.profiles(id),
  set_at   timestamptz not null default now()
);
create index if not exists gn_trade_progress_trade_idx on public.gn_trade_progress (trade_id, set_at desc);
create index if not exists gn_trade_progress_site_idx  on public.gn_trade_progress (site_id);

-- 日報の作業内容の行の工種（null＝選んでいない。読み替え表 → 予算外の順で決める）。作業内容の行だけ
-- （gn_save_report が作業内容以外の行を null にし、gn_report_lines_trade も null にする）。
-- 日報の行から使われている間は工種を消せない（trade_in_use。外部キーも on delete の指定なし＝消せない）。
alter table public.gn_report_lines add column if not exists site_trade_id uuid references public.gn_site_trades(id);
create index if not exists gn_report_lines_site_trade_idx on public.gn_report_lines (site_trade_id) where site_trade_id is not null;

-- 工種がその現場のものか（null は「工種なし」で true）。RLS に関係なく読む。
create or replace function public.gn_trade_in_site(p_trade uuid, p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_trade is null
         or exists (select 1 from public.gn_site_trades t where t.id = p_trade and t.site_id = p_site);
$$;
revoke all on function public.gn_trade_in_site(uuid, uuid) from public, anon;
grant execute on function public.gn_trade_in_site(uuid, uuid) to authenticated;

-- 工種のガード：名前の前後の空白を落とす・現場は付け替えられない（trade_site_fixed）・
-- 日報の作業内容の行・読み替え表・実行予算・元請けの内訳・進み具合の上書き（履歴）から使われている工種は消せない
-- （trade_in_use。detail に工種の名前。内訳の識別と % の履歴を黙って失わないため）。使われているかは RLS に関係なく見る（security definer）。拒否の文字列はアプリが文言に変えるので変えないこと。
create or replace function public.gn_site_trades_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.gn_report_lines l where l.site_trade_id = old.id)
       or exists (select 1 from public.gn_trade_aliases a where a.trade_id = old.id)
       or exists (select 1 from public.gn_budget_lines b where b.trade_id = old.id)
       or exists (select 1 from public.gn_contract_items c where c.trade_id = old.id)
       or exists (select 1 from public.gn_trade_progress p where p.trade_id = old.id) then
      raise exception using message = 'trade_in_use', detail = old.name;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.site_id is distinct from old.site_id then
    raise exception using message = 'trade_site_fixed';
  end if;
  new.name := btrim(new.name);
  return new;
end;
$$;
drop trigger if exists gn_site_trades_guard on public.gn_site_trades;
create trigger gn_site_trades_guard before insert or update or delete on public.gn_site_trades
  for each row execute function public.gn_site_trades_guard();

-- 元請けの内訳のガード：文字の前後の空白を落とす・工種はその現場のもの（trade_not_in_site）・金額＝round(数量 × 単価)。
create or replace function public.gn_contract_items_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.spec := btrim(coalesce(new.spec, ''));
  new.unit := btrim(coalesce(new.unit, ''));
  if not public.gn_trade_in_site(new.trade_id, new.site_id) then
    raise exception using message = 'trade_not_in_site';
  end if;
  new.amount := round(new.qty * new.unit_price);
  return new;
end;
$$;
drop trigger if exists gn_contract_items_guard on public.gn_contract_items;
create trigger gn_contract_items_guard before insert or update on public.gn_contract_items
  for each row execute function public.gn_contract_items_guard();

-- 実行予算のガード：文字の前後の空白を落とす・工種はその現場のもの（trade_not_in_site）・
-- 会社は協力会社の印のある会社（not_partner。入れるときと会社を変えるときだけ）・金額＝round(数量 × 単価)。
create or replace function public.gn_budget_lines_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.note := btrim(coalesce(new.note, ''));
  new.unit := btrim(coalesce(new.unit, ''));
  if not public.gn_trade_in_site(new.trade_id, new.site_id) then
    raise exception using message = 'trade_not_in_site';
  end if;
  if new.supplier_id is not null
     and (tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id)
     and not exists (select 1 from public.gn_suppliers s where s.id = new.supplier_id and s.is_partner) then
    raise exception using message = 'not_partner';
  end if;
  new.amount := round(new.qty * new.unit_price);
  return new;
end;
$$;
drop trigger if exists gn_budget_lines_guard on public.gn_budget_lines;
create trigger gn_budget_lines_guard before insert or update on public.gn_budget_lines
  for each row execute function public.gn_budget_lines_guard();

-- 読み替え表のガード：工種の文字の前後の空白を落とす・工種はその現場のもの（trade_not_in_site）。
create or replace function public.gn_trade_aliases_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.trade_text := btrim(new.trade_text);
  if not public.gn_trade_in_site(new.trade_id, new.site_id) then
    raise exception using message = 'trade_not_in_site';
  end if;
  return new;
end;
$$;
drop trigger if exists gn_trade_aliases_guard on public.gn_trade_aliases;
create trigger gn_trade_aliases_guard before insert or update on public.gn_trade_aliases
  for each row execute function public.gn_trade_aliases_guard();

-- 進み具合の上書きのガード（insert だけ）：工種はその現場のもの（trade_not_in_site）・入れた人と日時をそろえる
-- （アプリの利用者は auth.uid()。SQL Editor・service role は送った値か null）。
create or replace function public.gn_trade_progress_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not public.gn_trade_in_site(new.trade_id, new.site_id) then
    raise exception using message = 'trade_not_in_site';
  end if;
  new.set_by := coalesce(auth.uid(), new.set_by);
  new.set_at := clock_timestamp();  -- 同じトランザクションで 2 回入れても順が付くよう now() ではなく
  return new;
end;
$$;
drop trigger if exists gn_trade_progress_guard on public.gn_trade_progress;
create trigger gn_trade_progress_guard before insert on public.gn_trade_progress
  for each row execute function public.gn_trade_progress_guard();

-- 日報の行の工種：作業内容以外の行は null にする。作業内容の行の工種は日報の現場のもの（trade_not_in_site）。
-- 承認済みの鍵・完了現場は gn_report_lines_guard が見る（このトリガーは工種だけを見る）。
create or replace function public.gn_report_lines_trade()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_site uuid;
begin
  if new.site_trade_id is null then
    return new;
  end if;
  if new.kind <> 'work' then
    new.site_trade_id := null;
    return new;
  end if;
  select r.site_id into v_site from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or not public.gn_trade_in_site(new.site_trade_id, v_site) then
    raise exception using message = 'trade_not_in_site';
  end if;
  return new;
end;
$$;
drop trigger if exists gn_report_lines_trade on public.gn_report_lines;
create trigger gn_report_lines_trade before insert or update on public.gn_report_lines
  for each row execute function public.gn_report_lines_trade();

-- 工種の一覧をまとめて保存する（画面の「工種」の保存・Excel の取り込み）。p_trades は今の一覧の全部（並びの順）：
--   [{ "id": 既存の工種の id か null（新しい工種）, "name": 名前 }, ...]
-- 一覧に無い工種は消す（使われていれば trade_in_use で全部戻る）。id のある行は名前と並びを直し、id の無い行は足す。
-- 並び（sort_order）は配列の順（0 から）。名前の重複は一意の制約（遅延）がコミットのときに断る。途中で失敗すれば全部戻る。
-- 戻り値：保存後の工種の一覧 [{ id, name, sort_order }]（並び順）。
-- security invoker：呼び出しユーザーの RLS とガードトリガーがそのまま効く。
-- 拒否の理由：not_employee・site_closed・not_member・invalid_input（配列でない）・trade_not_found（id がこの現場の工種でない）・
--   trade_in_use（消そうとした工種が使われている）。
create or replace function public.gn_save_site_trades(p_site uuid, p_trades jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_trades jsonb := coalesce(p_trades, '[]'::jsonb);
  v_result jsonb;
begin
  if not public.gn_is_employee_or_admin() then
    raise exception using message = 'not_employee';
  end if;
  if p_site is null or public.gn_site_closed(p_site) then
    raise exception using message = 'site_closed';
  end if;
  if not public.gn_is_site_member(p_site) then
    raise exception using message = 'not_member';
  end if;
  if jsonb_typeof(v_trades) <> 'array' then
    raise exception using message = 'invalid_input';
  end if;
  -- 同じ現場の入れ替え・工種の保存を同時に走らせない（行が二重にならないよう、トランザクションの終わりまで順番待ち）
  perform pg_advisory_xact_lock(hashtextextended('gn_budget:' || p_site::text, 0));

  if exists (
    select 1 from jsonb_array_elements(v_trades) e(elem)
     where nullif(e.elem->>'id', '') is not null
       and not exists (select 1 from public.gn_site_trades s
                        where s.id = (e.elem->>'id')::uuid and s.site_id = p_site)
  ) then
    raise exception using message = 'trade_not_found';
  end if;

  delete from public.gn_site_trades s
   where s.site_id = p_site
     and not exists (select 1 from jsonb_array_elements(v_trades) e(elem)
                      where nullif(e.elem->>'id', '') is not null and (e.elem->>'id')::uuid = s.id);

  update public.gn_site_trades s
     set name = t.name, sort_order = t.ord
    from (select (e.elem->>'id')::uuid as id, e.elem->>'name' as name, (e.ord - 1)::int as ord
            from jsonb_array_elements(v_trades) with ordinality e(elem, ord)
           where nullif(e.elem->>'id', '') is not null) t
   where s.id = t.id and s.site_id = p_site;

  insert into public.gn_site_trades (site_id, name, sort_order)
  select p_site, e.elem->>'name', (e.ord - 1)::int
    from jsonb_array_elements(v_trades) with ordinality e(elem, ord)
   where nullif(e.elem->>'id', '') is null
   order by e.ord;

  -- 名前の重複はここで断る（遅延の一意をコミットまで待たず、この関数の中で 23505 にする）
  set constraints public.gn_site_trades_site_id_name_key immediate;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'sort_order', s.sort_order)
                            order by s.sort_order, s.name), '[]'::jsonb)
    into v_result
    from public.gn_site_trades s where s.site_id = p_site;
  return v_result;
end;
$$;
revoke all on function public.gn_save_site_trades(uuid, jsonb) from public, anon;
grant execute on function public.gn_save_site_trades(uuid, jsonb) to authenticated;

-- 実行予算の行を全部入れ替える（画面の保存・Excel の取り込み。日報から参照されないので入れ替えてよい）。
-- p_lines：[{ trade_id, performer, supplier_id, item, note, qty, unit, unit_price }, ...]（並びの順。sort_order は配列の順）。
-- 金額はトリガーが計算する。途中で失敗すれば全部戻る（入れ替える前の予算が残る）。
-- 拒否の理由：not_employee・site_closed・not_member・invalid_input・trade_not_in_site・not_partner・
--   gn_budget_lines_combo_ck などの制約違反（アプリが先に検証する）。
create or replace function public.gn_replace_budget_lines(p_site uuid, p_lines jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
begin
  if not public.gn_is_employee_or_admin() then
    raise exception using message = 'not_employee';
  end if;
  if p_site is null or public.gn_site_closed(p_site) then
    raise exception using message = 'site_closed';
  end if;
  if not public.gn_is_site_member(p_site) then
    raise exception using message = 'not_member';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception using message = 'invalid_input';
  end if;

  -- 同じ現場の入れ替え・工種の保存を同時に走らせない（行が二重にならないよう、トランザクションの終わりまで順番待ち）
  perform pg_advisory_xact_lock(hashtextextended('gn_budget:' || p_site::text, 0));

  delete from public.gn_budget_lines where site_id = p_site;

  insert into public.gn_budget_lines (site_id, trade_id, performer, supplier_id, item, note, qty, unit, unit_price, sort_order)
  select p_site, t.trade_id, coalesce(t.performer, 'own'), t.supplier_id, t.item, coalesce(t.note, ''),
         t.qty, coalesce(t.unit, ''), t.unit_price, (e.ord - 1)::int
    from jsonb_array_elements(v_lines) with ordinality e(elem, ord),
         lateral jsonb_to_record(e.elem) as t(trade_id uuid, performer text, supplier_id uuid, item text, note text,
                                              qty numeric, unit text, unit_price numeric)
   order by e.ord;
end;
$$;
revoke all on function public.gn_replace_budget_lines(uuid, jsonb) from public, anon;
grant execute on function public.gn_replace_budget_lines(uuid, jsonb) to authenticated;

-- 元請けの内訳の行を入れる。p_mode：
--   * 'replace'：全部入れ替える（新しい注文書が届いたとき）。区分は送った値。
--   * 'appendChange'：今の行の後ろに「変更」の行として足す（変更の内訳だけ届いたとき）。区分は 'change' にする。
-- p_items：[{ section, name, spec, qty, unit, unit_price, trade_id, category }, ...]（並びの順）。金額はトリガーが計算する。
-- 拒否の理由：not_employee・site_closed・not_member・invalid_input（配列でない・mode が違う）・trade_not_in_site・制約違反。
create or replace function public.gn_replace_contract_items(p_site uuid, p_items jsonb, p_mode text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_base  int := 0;
begin
  if not public.gn_is_employee_or_admin() then
    raise exception using message = 'not_employee';
  end if;
  if p_site is null or public.gn_site_closed(p_site) then
    raise exception using message = 'site_closed';
  end if;
  if not public.gn_is_site_member(p_site) then
    raise exception using message = 'not_member';
  end if;
  if jsonb_typeof(v_items) <> 'array' or p_mode is null or p_mode not in ('replace', 'appendChange') then
    raise exception using message = 'invalid_input';
  end if;

  -- 同じ現場の入れ替え・工種の保存を同時に走らせない（行が二重にならないよう、トランザクションの終わりまで順番待ち）
  perform pg_advisory_xact_lock(hashtextextended('gn_budget:' || p_site::text, 0));

  if p_mode = 'replace' then
    delete from public.gn_contract_items where site_id = p_site;
  else
    select coalesce(max(c.sort_order) + 1, 0) into v_base from public.gn_contract_items c where c.site_id = p_site;
  end if;

  insert into public.gn_contract_items (site_id, section, name, spec, qty, unit, unit_price, trade_id, category, sort_order)
  select p_site,
         case when p_mode = 'appendChange' then 'change' else coalesce(t.section, 'initial') end,
         t.name, coalesce(t.spec, ''), t.qty, coalesce(t.unit, ''), t.unit_price, t.trade_id,
         coalesce(t.category, 'trade'), v_base + (e.ord - 1)::int
    from jsonb_array_elements(v_items) with ordinality e(elem, ord),
         lateral jsonb_to_record(e.elem) as t(section text, name text, spec text, qty numeric, unit text,
                                              unit_price numeric, trade_id uuid, category text)
   order by e.ord;
end;
$$;
revoke all on function public.gn_replace_contract_items(uuid, jsonb, text) from public, anon;
grant execute on function public.gn_replace_contract_items(uuid, jsonb, text) to authenticated;

-- RLS
alter table public.gn_site_trades    enable row level security;
alter table public.gn_contract_items enable row level security;
alter table public.gn_budget_lines   enable row level security;
alter table public.gn_trade_aliases  enable row level security;
alter table public.gn_trade_progress enable row level security;

-- 工種：読むのは現場メンバー（協力会社も）。書くのは社員・管理者（完了・削除済みの現場は不可。管理者も同じ）。
drop policy if exists gn_site_trades_select on public.gn_site_trades;
create policy gn_site_trades_select on public.gn_site_trades for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_trades_staff_insert on public.gn_site_trades;
create policy gn_site_trades_staff_insert on public.gn_site_trades for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_site_trades_staff_update on public.gn_site_trades;
create policy gn_site_trades_staff_update on public.gn_site_trades for update to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id)) with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_site_trades_staff_delete on public.gn_site_trades;
create policy gn_site_trades_staff_delete on public.gn_site_trades for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));

-- 読み替え表：工種と同じ。
drop policy if exists gn_trade_aliases_select on public.gn_trade_aliases;
create policy gn_trade_aliases_select on public.gn_trade_aliases for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_trade_aliases_staff_insert on public.gn_trade_aliases;
create policy gn_trade_aliases_staff_insert on public.gn_trade_aliases for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_trade_aliases_staff_update on public.gn_trade_aliases;
create policy gn_trade_aliases_staff_update on public.gn_trade_aliases for update to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id)) with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_trade_aliases_staff_delete on public.gn_trade_aliases;
create policy gn_trade_aliases_staff_delete on public.gn_trade_aliases for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));

-- 元請けの内訳・実行予算：読むのも書くのも社員・管理者だけ（協力会社は 0 行）。書くのは完了・削除済みの現場では不可。
drop policy if exists gn_contract_items_select on public.gn_contract_items;
create policy gn_contract_items_select on public.gn_contract_items for select to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id));
drop policy if exists gn_contract_items_staff_insert on public.gn_contract_items;
create policy gn_contract_items_staff_insert on public.gn_contract_items for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_contract_items_staff_update on public.gn_contract_items;
create policy gn_contract_items_staff_update on public.gn_contract_items for update to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id)) with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_contract_items_staff_delete on public.gn_contract_items;
create policy gn_contract_items_staff_delete on public.gn_contract_items for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_budget_lines_select on public.gn_budget_lines;
create policy gn_budget_lines_select on public.gn_budget_lines for select to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id));
drop policy if exists gn_budget_lines_staff_insert on public.gn_budget_lines;
create policy gn_budget_lines_staff_insert on public.gn_budget_lines for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_budget_lines_staff_update on public.gn_budget_lines;
create policy gn_budget_lines_staff_update on public.gn_budget_lines for update to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id)) with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_budget_lines_staff_delete on public.gn_budget_lines;
create policy gn_budget_lines_staff_delete on public.gn_budget_lines for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));

-- 進み具合の上書き：読むのは社員・管理者。入れるのは社員・管理者のうち管理者か、その現場の確認・承認の人だけ
-- （担当［staff］・割り当ての無い社員・協力会社は不可）。完了・削除済みの現場は不可。変更・削除のポリシーは作らない（履歴）。
drop policy if exists gn_trade_progress_select on public.gn_trade_progress;
create policy gn_trade_progress_select on public.gn_trade_progress for select to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id));
drop policy if exists gn_trade_progress_reviewer_insert on public.gn_trade_progress;
create policy gn_trade_progress_reviewer_insert on public.gn_trade_progress for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id) and (public.is_admin() or public.gn_site_role(site_id) in ('reviewer','approver')));

-- 日報の保存（schema_genba.sql の「9. 日報の保存」と同じ。site_trade_id を足しただけ）
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
    overtime_hours, overtime_rate,
    change_kind, instructed_by, instruction_method, instructed_on, issue_id,
    labor_contract, affiliation, supplier_id,
    site_trade_id
  )
  select
    v_id, t.kind, coalesce(t.sort_order, e.ord::int), t.ref_id, t.name, t.spec, t.unit,
    t.qty, t.unit_price, t.amount, t.start_time, t.end_time, t.break_min, t.gap_min,
    t.hours, t.man_days, t.km_per_l, t.distance_km, t.price_per_l, t.vendor, t.trade,
    t.description, t.productivity, t.source, t.note,
    t.overtime_hours, t.overtime_rate,
    -- 区分は not null。送られない（作業内容以外の行・古い画面）なら契約内。
    coalesce(t.change_kind, 'contract'), t.instructed_by, t.instruction_method, t.instructed_on, t.issue_id,
    -- 常用・請負とその日の所属の写し（2026-11-07）は労務の行だけ。それ以外の行は null。
    case when t.kind = 'labor' then t.labor_contract end,
    case when t.kind = 'labor' then t.affiliation end,
    case when t.kind = 'labor' then t.supplier_id end,
    -- 実行予算の工種（2026-11-15）は作業内容の行だけ。それ以外の行は null。
    case when t.kind = 'work' then t.site_trade_id end
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

commit;
