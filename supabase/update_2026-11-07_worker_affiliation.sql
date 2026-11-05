-- 2026-11-07：作業員の所属（自社／協力会社）、労務の行の常用・請負とその日の所属の写し、
-- 協力会社アカウントの会社、現場の協力会社（請負金額は任意）、社員による協力会社の作業員の現場登録。
-- update_2026-11-06_estimate_method.sql まで適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * gn_is_employee_or_admin()：社員か管理者なら true（新しい RLS で使う）
--   * gn_workers.affiliation（'own' 自社・'partner' 協力会社。既定 'own'）・supplier_id（協力会社のとき必須＝アプリで検証）
--   * gn_report_lines.labor_contract（'jouyou' 常用・'ukeoi' 請負。null は常用）・affiliation・supplier_id（保存時の所属の写し）
--     既存の労務の行のうち、作業員マスターを参照している行（ref_id が gn_workers にある）は自社（'own'）で埋める。
--     手入力の行（ref_id なし）は null ＝ 所属なしのまま。
--   * gn_save_report：上の 3 列も保存する（労務の行だけ。それ以外は変更なし。gn_report_lines_compute は変更なし）
--   * gn_partner_accounts（協力会社アカウント → 取引先）。本人と社員・管理者が読める、管理者だけ書ける
--   * gn_site_partners（現場の協力会社・請負金額・メモ）。現場メンバーが読める、社員・管理者が書ける（完了現場は不可）
--   * gn_site_workers：社員も協力会社の作業員の登録を追加・削除できる（進行中の現場だけ。自社の作業員の選択は管理者だけのまま）
-- 協力会社の上下（1 次・2 次）は持たない。
-- アプリは新しい列・表を読むので、アプリを新しい版にする前に実行する（先にアプリを出すと作業員・日報の読み込みが失敗する）。

-- 1. 社員か管理者か -------------------------------------------------------------
-- 社員（profiles.account_type = 'employee'）か管理者なら true。協力会社・profiles の行が無いユーザーは false
-- （gn_report_issues_guard の not_employee と同じ判定。許す側を名指しする）。2026-11-07。
create or replace function public.gn_is_employee_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
         or exists (
           select 1 from public.profiles p
            where p.id = auth.uid()
              and p.account_type = 'employee'
         );
$$;

-- 2. 作業員の所属 ---------------------------------------------------------------
-- 作業員の所属（2026-11-07。update_2026-11-07_worker_affiliation.sql）：自社（own）か協力会社（partner）。
-- 協力会社のときは supplier_id（取引先の 1 社）が必須（アプリで検証）。既存の作業員は自社になる。
alter table public.gn_workers add column if not exists affiliation text not null default 'own'
  check (affiliation in ('own','partner'));
alter table public.gn_workers add column if not exists supplier_id uuid references public.gn_suppliers(id);

-- 3. 労務の行の常用・請負と所属の写し -------------------------------------------
-- 労務の行の常用・請負と、その日の所属の写し（2026-11-07。update_2026-11-07_worker_affiliation.sql）。労務の行だけ使う。
--   * labor_contract：'jouyou'（常用）・'ukeoi'（請負）。null は常用扱い。所属が協力会社の作業員の行だけ値を持つ。
--   * affiliation・supplier_id：保存時に作業員マスターから写した所属（名前・日当の写しと同じ扱い）。
--     帳票は行の値を使うので、後から作業員の所属を変えても、保存し直すまで過去の日報は変わらない。
--     手入力の行（ref_id なし）は null ＝ 所属なし。
alter table public.gn_report_lines add column if not exists labor_contract text
  check (labor_contract in ('jouyou','ukeoi'));
alter table public.gn_report_lines add column if not exists affiliation text
  check (affiliation in ('own','partner'));
alter table public.gn_report_lines add column if not exists supplier_id uuid references public.gn_suppliers(id);

-- 既存の労務の行の所属を埋める（作業員マスターを参照している行＝自社。手入力の行は null のまま）。
-- 承認済みの日報・完了現場の行も対象なので明細のガードを外し、金額・人工を計算し直さないよう計算のトリガーも外す
-- （所属の列だけを変える。recalc_2026-11-03_labor.sql と同じやり方）。2 回目以降は対象が 0 行になる。
begin;
  alter table public.gn_report_lines disable trigger gn_report_lines_guard;
  alter table public.gn_report_lines disable trigger gn_report_lines_compute;
  update public.gn_report_lines l set affiliation = 'own'
   where l.kind = 'labor'
     and l.affiliation is null
     and l.ref_id is not null
     and exists (select 1 from public.gn_workers w where w.id = l.ref_id);
  alter table public.gn_report_lines enable trigger gn_report_lines_compute;
  alter table public.gn_report_lines enable trigger gn_report_lines_guard;
commit;

-- 4. 日報の保存（新しい 3 列を保存する。それ以外は schema_genba.sql の版と同じ） ------------
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
    labor_contract, affiliation, supplier_id
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
    case when t.kind = 'labor' then t.supplier_id end
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

-- 5. 協力会社アカウントの会社・現場の協力会社 ------------------------------------
-- 協力会社アカウントの会社（2026-11-07）：協力会社アカウント（profiles.account_type = 'partner'）を取引先の 1 社に結び付ける。
-- profiles は業務日報アプリと共有なので列を足さず、別の表にする。未設定のアカウントは行が無い。
create table if not exists public.gn_partner_accounts (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  supplier_id uuid not null references public.gn_suppliers(id),
  created_at  timestamptz not null default now()
);

-- 現場の協力会社（2026-11-07）：1 つの現場に入る協力会社（取引先）と、任意の請負金額・メモ。
-- 社員・管理者がいつでも追加・削除できる（完了・削除済みの現場は不可）。協力会社は担当現場の行を読めるだけ。
create table if not exists public.gn_site_partners (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.gn_sites(id),
  supplier_id uuid not null references public.gn_suppliers(id),
  amount      numeric check (amount is null or amount >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  unique (site_id, supplier_id)
);

-- 6. RLS ------------------------------------------------------------------------
-- 協力会社アカウントの会社（2026-11-07）：本人と社員・管理者が読める。書けるのは管理者だけ。
alter table public.gn_partner_accounts enable row level security;
drop policy if exists gn_partner_accounts_select on public.gn_partner_accounts;
create policy gn_partner_accounts_select on public.gn_partner_accounts for select to authenticated using (user_id = auth.uid() or public.gn_is_employee_or_admin());
drop policy if exists gn_partner_accounts_admin_insert on public.gn_partner_accounts;
create policy gn_partner_accounts_admin_insert on public.gn_partner_accounts for insert to authenticated with check (public.is_admin());
drop policy if exists gn_partner_accounts_admin_update on public.gn_partner_accounts;
create policy gn_partner_accounts_admin_update on public.gn_partner_accounts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists gn_partner_accounts_admin_delete on public.gn_partner_accounts;
create policy gn_partner_accounts_admin_delete on public.gn_partner_accounts for delete to authenticated using (public.is_admin());

-- 現場の協力会社（2026-11-07）：現場メンバー（協力会社の担当を含む）が読める。
-- 追加・変更・削除は社員・管理者だけで、完了・削除済みの現場は不可（管理者も同じ）。
alter table public.gn_site_partners enable row level security;
drop policy if exists gn_site_partners_select on public.gn_site_partners;
create policy gn_site_partners_select on public.gn_site_partners for select to authenticated using (public.gn_is_site_member(site_id));
drop policy if exists gn_site_partners_staff_insert on public.gn_site_partners;
create policy gn_site_partners_staff_insert on public.gn_site_partners for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_site_partners_staff_update on public.gn_site_partners;
create policy gn_site_partners_staff_update on public.gn_site_partners for update to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id)) with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));
drop policy if exists gn_site_partners_staff_delete on public.gn_site_partners;
create policy gn_site_partners_staff_delete on public.gn_site_partners for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id));

-- 現場の作業員の選択（gn_site_workers）のうち、協力会社の作業員の登録（2026-11-07）：管理者（上の admin ポリシー）に加えて、
-- 社員も追加・削除できる（進行中の現場だけ）。自社の作業員の選択は従来どおり管理者だけ。ポリシーは OR で効く。
drop policy if exists gn_site_workers_partner_insert on public.gn_site_workers;
create policy gn_site_workers_partner_insert on public.gn_site_workers for insert to authenticated with check (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id) and exists (select 1 from public.gn_workers w where w.id = gn_site_workers.worker_id and w.affiliation = 'partner'));
drop policy if exists gn_site_workers_partner_delete on public.gn_site_workers;
create policy gn_site_workers_partner_delete on public.gn_site_workers for delete to authenticated using (public.gn_is_employee_or_admin() and public.gn_is_site_member(site_id) and not public.gn_site_closed(site_id) and exists (select 1 from public.gn_workers w where w.id = gn_site_workers.worker_id and w.affiliation = 'partner'));

-- 確認（任意）：新しい列・表があれば適用済み。
-- select column_name from information_schema.columns where table_name = 'gn_report_lines' and column_name in ('labor_contract','affiliation','supplier_id');
-- select count(*) filter (where affiliation = 'own') as own_lines, count(*) filter (where affiliation is null) as no_affiliation from public.gn_report_lines where kind = 'labor';
