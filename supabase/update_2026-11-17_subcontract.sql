-- 2026-11-17：外注（請負）の買掛・行の根拠（件）・うち常用の時間。update_2026-11-16_site_money.sql の後に 1 回実行する
-- （schema_genba.sql には反映済み）。何度実行しても安全（冪等）。既存の行は書き換えない（update しない）。
--
-- 足すもの：
--   1. 列 gn_report_lines.purchase_kind（買掛の区分。null・'material'＝仕入、'subcontract'＝外注。買掛の行だけ）と
--      gn_report_lines.jouyou_hours（作業員の行の「うち常用の時間」。時間。作業員の行だけ）。どちらも null 可・既定なし。
--      check は列の定義に書かず、名前付きの制約（gn_report_lines_purchase_kind_ck・gn_report_lines_jouyou_hours_ck）で付ける
--      （列に書くと自動の名前 gn_report_lines_<列>_check になり、付け直しのときに重なるため）。
--   2. gn_save_report の差し替え：上の 2 列を書く。工種（site_trade_id）は作業内容の行と外注の買掛の行だけ、根拠の件（issue_id）は
--      作業員以外の行。原価の合計（cost_total）は外注の買掛を除いた合計にする（協力会社も読める列から外注の支払いが分からないように。
--      外注を含む原価はアプリが明細から出す）。引数・戻り値・楽観ロックは変えない。
--   3. gn_report_lines_trade の差し替え：外注の買掛の行の工種も日報の現場のもの（trade_not_in_site）。それ以外の行は null。
--   4. トリガー gn_report_lines_issue（新規）：根拠の件は日報の現場の件（issue_not_in_site）。作業員の行は null にする。
--   5. RLS：協力会社のアカウントは外注の買掛の行を読めない・足せない・変えられない・消せない（社員・管理者は今まで通り）。
--      gn_save_report は security invoker なので、協力会社が日報を保存し直しても、見えない外注の行は消えずに残る。
--   6. 関数 gn_site_ukeoi_suppliers(p_site)：その現場の実行予算で請負（subcontract）の行に入っている会社の id（金額は返さない）。
--      現場メンバー（協力会社も）が呼べる。日報で新しく足す協力会社の作業員の行の「常用／請負」の既定に使う。
--
-- 実行の順番：この SQL を先に実行してから、新しい版のアプリを出す。
--   古い版のアプリはこの SQL の後でも動く（新しい列は送らない＝null。外注の行は無いので RLS の条件も今まで通り）。
--   新しい版のアプリはこの SQL の前でも動く（列が無ければ、買掛の区分「外注」を出さず、読み取りは新しい列なしで読み直す）。
begin;

-- 1. 列 ------------------------------------------------------------------------------------
alter table public.gn_report_lines add column if not exists purchase_kind text;
alter table public.gn_report_lines add column if not exists jouyou_hours numeric;
alter table public.gn_report_lines drop constraint if exists gn_report_lines_purchase_kind_ck;
alter table public.gn_report_lines add constraint gn_report_lines_purchase_kind_ck
  check (purchase_kind is null or purchase_kind in ('material','subcontract'));
alter table public.gn_report_lines drop constraint if exists gn_report_lines_jouyou_hours_ck;
alter table public.gn_report_lines add constraint gn_report_lines_jouyou_hours_ck
  check (jouyou_hours is null or (jouyou_hours >= 0 and jouyou_hours <= 24));

-- 2. 日報の保存 ------------------------------------------------------------------------------
-- 作業内容以外の行の根拠の件・外注の買掛の工種・買掛の区分・うち常用の時間を書き、原価の合計から外注の買掛を除く。
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
    site_trade_id,
    purchase_kind, jouyou_hours
  )
  select
    v_id, t.kind, coalesce(t.sort_order, e.ord::int), t.ref_id, t.name, t.spec, t.unit,
    t.qty, t.unit_price, t.amount, t.start_time, t.end_time, t.break_min, t.gap_min,
    t.hours, t.man_days, t.km_per_l, t.distance_km, t.price_per_l, t.vendor, t.trade,
    t.description, t.productivity, t.source, t.note,
    t.overtime_hours, t.overtime_rate,
    -- 区分は not null。送られない（作業内容以外の行・古い画面）なら契約内。
    coalesce(t.change_kind, 'contract'), t.instructed_by, t.instruction_method, t.instructed_on,
    -- 根拠の件（2026-11-17）は作業員以外の行（作業内容・燃料・リース・現金・買掛）。作業員の行は null。
    case when t.kind <> 'labor' then t.issue_id end,
    -- 常用・請負とその日の所属の写し（2026-11-07）は労務の行だけ。それ以外の行は null。
    case when t.kind = 'labor' then t.labor_contract end,
    case when t.kind = 'labor' then t.affiliation end,
    case when t.kind = 'labor' then t.supplier_id end,
    -- 実行予算の工種（2026-11-15）は作業内容の行と、外注の買掛の行（2026-11-17）だけ。それ以外の行は null。
    case when t.kind = 'work' or (t.kind = 'credit' and t.purchase_kind = 'subcontract') then t.site_trade_id end,
    -- 買掛の区分（2026-11-17。null・'material'＝仕入、'subcontract'＝外注）は買掛の行だけ。
    case when t.kind = 'credit' then t.purchase_kind end,
    -- うち常用の時間（2026-11-17）は作業員の行だけ。
    case when t.kind = 'labor' then t.jouyou_hours end
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as e(elem, ord),
       lateral jsonb_populate_record(null::public.gn_report_lines, e.elem) as t
  order by coalesce(t.sort_order, e.ord::int), e.ord;

  -- 合計の書き込みはこの関数の中だけ（gn_report_guard が gn.in_save を確認する）。
  -- is_local = true なのでトランザクションの終わりで消えるが、念のため直後に戻す。
  perform set_config('gn.in_save', '1', true);
  update public.gn_daily_reports r set
    output_total   = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'work'), 0),
    -- 原価の合計は外注の買掛を除く（2026-11-17。協力会社も読める列から外注の支払いが分からないように）。
    -- 外注を含む原価はアプリが明細から出す。
    cost_total     = coalesce((select sum(l.amount)   from public.gn_report_lines l
                                where l.report_id = v_id and l.kind <> 'work'
                                  and not (l.kind = 'credit' and l.purchase_kind is not distinct from 'subcontract')), 0),
    man_days_total = coalesce((select sum(l.man_days) from public.gn_report_lines l
                                where l.report_id = v_id and l.kind = 'labor'), 0)
  where r.id = v_id;
  perform set_config('gn.in_save', '', true);

  return v_id;
end;
$$;

-- 3. 日報の行の工種 --------------------------------------------------------------------------
-- 作業内容の行と外注の買掛の行（2026-11-17）の工種は日報の現場のもの（trade_not_in_site）。それ以外の行（仕入の買掛を含む）は null。
-- 承認済みの鍵・完了現場は gn_report_lines_guard が見る（このトリガーは工種だけを見る）。
create or replace function public.gn_report_lines_trade()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_site uuid;
begin
  if new.site_trade_id is null then
    return new;
  end if;
  if not (new.kind = 'work' or (new.kind = 'credit' and new.purchase_kind = 'subcontract')) then
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

-- 4. 日報の行の根拠の件 ----------------------------------------------------------------------
-- 根拠の件（issue_id）は日報の現場の件（issue_not_in_site）。作業員の行は null にする。件は RLS に関係なく読む。
create or replace function public.gn_report_lines_issue()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_site  uuid;
  v_isite uuid;
begin
  if new.issue_id is null then
    return new;
  end if;
  if new.kind = 'labor' then
    new.issue_id := null;
    return new;
  end if;
  select r.site_id into v_site from public.gn_daily_reports r where r.id = new.report_id;
  select i.site_id into v_isite from public.gn_report_issues i where i.id = new.issue_id;
  if v_site is null or v_isite is null or v_isite <> v_site then
    raise exception using message = 'issue_not_in_site';
  end if;
  return new;
end;
$$;
drop trigger if exists gn_report_lines_issue on public.gn_report_lines;
create trigger gn_report_lines_issue before insert or update on public.gn_report_lines
  for each row execute function public.gn_report_lines_issue();

-- 5. RLS：外注の買掛の行は社員・管理者だけ ----------------------------------------------------
-- 条件は「親日報の現場のメンバー」かつ「社員・管理者か、外注の買掛の行でない」。purchase_kind が null の行も外注でない
-- （is distinct from で null を外注でないとみなす）。
drop policy if exists gn_report_lines_select on public.gn_report_lines;
create policy gn_report_lines_select on public.gn_report_lines for select to authenticated using (
  exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))
  and (gn_report_lines.kind <> 'credit' or gn_report_lines.purchase_kind is distinct from 'subcontract' or public.gn_is_employee_or_admin()));
drop policy if exists gn_report_lines_insert on public.gn_report_lines;
create policy gn_report_lines_insert on public.gn_report_lines for insert to authenticated with check (
  exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))
  and (gn_report_lines.kind <> 'credit' or gn_report_lines.purchase_kind is distinct from 'subcontract' or public.gn_is_employee_or_admin()));
drop policy if exists gn_report_lines_update on public.gn_report_lines;
create policy gn_report_lines_update on public.gn_report_lines for update to authenticated using (
  exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))
  and (gn_report_lines.kind <> 'credit' or gn_report_lines.purchase_kind is distinct from 'subcontract' or public.gn_is_employee_or_admin()))
  with check (
  exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))
  and (gn_report_lines.kind <> 'credit' or gn_report_lines.purchase_kind is distinct from 'subcontract' or public.gn_is_employee_or_admin()));
drop policy if exists gn_report_lines_delete on public.gn_report_lines;
create policy gn_report_lines_delete on public.gn_report_lines for delete to authenticated using (
  exists (select 1 from public.gn_daily_reports r where r.id = gn_report_lines.report_id and public.gn_is_site_member(r.site_id))
  and (gn_report_lines.kind <> 'credit' or gn_report_lines.purchase_kind is distinct from 'subcontract' or public.gn_is_employee_or_admin()));

-- 6. 請負の会社の一覧 ------------------------------------------------------------------------
-- その現場の実行予算で請負（subcontract）の行に入っている会社の id（重複なし）。金額は返さない。
-- 呼んだ人がその現場のメンバー（gn_is_site_member。協力会社も）のときだけ返す。それ以外は 0 行。
create or replace function public.gn_site_ukeoi_suppliers(p_site uuid)
returns table (supplier_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct b.supplier_id
    from public.gn_budget_lines b
   where auth.uid() is not null
     and p_site is not null
     and b.site_id = p_site
     and b.item = 'subcontract'
     and b.supplier_id is not null
     and public.gn_is_site_member(p_site);
$$;
revoke all on function public.gn_site_ukeoi_suppliers(uuid) from public, anon;
grant execute on function public.gn_site_ukeoi_suppliers(uuid) to authenticated;

commit;
