-- 追加・変更・減の記録（区分・指示者・根拠）と、契約の状態・提案金額の率・客先確認の列
-- 2026-11-04。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- 契約金額が固まらない現場や下請けの現場で、追加・変更・減を日報から拾って客先と交渉できるようにする。
--   * 作業内容の行：区分（契約内・追加・変更・減）・指示者・指示方法・指示日・根拠の件
--   * 重要事項の件：種別・指示者・指示方法・金額見込み
--   * 現場：契約の状態（確定・未確定）・概算（見積提示）額
--   * 全社の設定：経費率・利益率（提案金額に掛ける）・自社の名前と連絡先
--   * 日報：客先確認（確認者名・日時・メモ）。日報の保存（gn_save_report）では変えない
--   * gn_save_report：明細の新しい列も保存する（それ以外は変更なし。gn_report_lines_compute は変更なし）
-- 既存の行：区分は「契約内」、件の種別は「その他」、現場は「確定」、率は 15%・10% になる。それ以外の新しい列は空（null）。
-- 列は既存の表に足すので、RLS のポリシーはそのまま効く（変更なし）。

-- 1. 重要事項の件（作業内容の行が根拠の件として参照するので先に） -----------------
alter table public.gn_report_issues add column if not exists kind text not null default 'other'
  check (kind in ('extra','change','minus','client_delay','rework','other'));
alter table public.gn_report_issues add column if not exists instructed_by text;
alter table public.gn_report_issues add column if not exists instruction_method text
  check (instruction_method in ('oral','phone','email','document','other'));
alter table public.gn_report_issues add column if not exists amount_estimate numeric
  check (amount_estimate is null or amount_estimate >= 0);

-- 2. 作業内容の行（kind = 'work'）。作業内容以外の行の区分は 'contract' のまま使わない ----
alter table public.gn_report_lines add column if not exists change_kind text not null default 'contract'
  check (change_kind in ('contract','extra','change','minus'));
alter table public.gn_report_lines add column if not exists instructed_by text;
alter table public.gn_report_lines add column if not exists instruction_method text
  check (instruction_method in ('oral','phone','email','document','other'));
alter table public.gn_report_lines add column if not exists instructed_on date;
alter table public.gn_report_lines add column if not exists issue_id uuid
  references public.gn_report_issues(id) on delete set null;

-- （任意・既定では実行しない）既存の source = 'extra' の作業内容の行を区分「追加」にする場合だけ、下の 5 行の
-- 先頭の「-- 」を外して実行する。これまでの画面と Excel 取り込みは作業内容の行をすべて source = 'extra' で
-- 保存しているため、実行すると既存の作業内容がすべて「追加」になる点に注意。承認済みの日報・完了現場の行も
-- 対象にするため、明細のガードを一時的に外す（recalc_2026-11-03_labor.sql と同じやり方）。
-- begin;
--   alter table public.gn_report_lines disable trigger gn_report_lines_guard;
--   update public.gn_report_lines set change_kind = 'extra' where kind = 'work' and source = 'extra' and change_kind is distinct from 'extra';
--   alter table public.gn_report_lines enable trigger gn_report_lines_guard;
-- commit;

-- 3. 現場：契約金額の状態と、未確定のときに使う概算・見積提示額 -----------------------
alter table public.gn_sites add column if not exists contract_status text not null default 'fixed'
  check (contract_status in ('fixed','tentative'));
alter table public.gn_sites add column if not exists estimated_amount numeric
  check (estimated_amount is null or estimated_amount >= 0);

-- 4. 全社の設定：追加・変更の提案金額に掛ける経費率・利益率と、自社の名前・連絡先 -------------
alter table public.gn_settings add column if not exists overhead_rate numeric not null default 0.15 check (overhead_rate >= 0);
alter table public.gn_settings add column if not exists profit_rate   numeric not null default 0.10 check (profit_rate >= 0);
alter table public.gn_settings add column if not exists company_name    text;
alter table public.gn_settings add column if not exists company_contact text;

-- 5. 日報の客先確認（確認者名・日時・メモ）。日報の保存（gn_save_report）では変えない --------
alter table public.gn_daily_reports add column if not exists client_confirmed_by   text;
alter table public.gn_daily_reports add column if not exists client_confirmed_at   timestamptz;
alter table public.gn_daily_reports add column if not exists client_confirmed_note text;

-- 6. 日報の保存：明細の新しい列も書く（schema_genba.sql の 9. と同じ） ----------------------
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
    change_kind, instructed_by, instruction_method, instructed_on, issue_id
  )
  select
    v_id, t.kind, coalesce(t.sort_order, e.ord::int), t.ref_id, t.name, t.spec, t.unit,
    t.qty, t.unit_price, t.amount, t.start_time, t.end_time, t.break_min, t.gap_min,
    t.hours, t.man_days, t.km_per_l, t.distance_km, t.price_per_l, t.vendor, t.trade,
    t.description, t.productivity, t.source, t.note,
    t.overtime_hours, t.overtime_rate,
    -- 区分は not null。送られない（作業内容以外の行・古い画面）なら契約内。
    coalesce(t.change_kind, 'contract'), t.instructed_by, t.instruction_method, t.instructed_on, t.issue_id
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
