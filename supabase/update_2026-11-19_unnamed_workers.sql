-- 2026-11-19：名前なし（会社と人数）の作業員の行。update_2026-11-18_settlement_rates.sql の後に 1 回実行する
-- （schema_genba.sql には反映済み）。何度実行しても安全（冪等）。既存の行は書き換えない（update しない）。
--
-- 協力会社が請負で入るとき、作業した人の名前が分からないことがある。そのときは作業員を選ばずに、会社（協力会社）と
-- 人数だけで 1 行に入れる（日報の作業員の選択肢「（名前なし：会社と人数で入れる）」）。
--
-- 足すもの：
--   1. 列 gn_report_lines.headcount（人数。整数。null 可・既定なし）。名前なしの作業員の行（ref_id が null）だけ 1 以上が入る。
--      それ以外の行は null（名前のある行＝1 人）。check は列の定義に書かず、名前付きの制約 gn_report_lines_headcount_ck で付ける
--      （列に書くと自動の名前 gn_report_lines_headcount_check になり、付け直しのときに重なるため）。
--   2. gn_report_lines_compute の差し替え：作業員の行の人工（man_days）・残業時間（overtime_hours）を 1 人分 × 人数にする
--      （労務費 amount = 日当 × 人工 ＋ 残業時間 × 残業単価 は今までどおり。人数分の人工・残業から出すので人数分になる）。
--      実働（hours）は 1 人あたりのまま。人数が null の行（今までの行）は 1 人なので、計算は変わらない。
--      作業員以外の行と、作業員を選んだ行（ref_id あり）の人数は null にする。
--   3. gn_save_report の差し替え：人数を書く（作業員の行で ref_id が null の行だけ）。それ以外は update_2026-11-17_subcontract.sql と同じ。
--      日報の人工の合計（man_days_total）は行の man_days の和なので、人数分が入る。
--   名前（name）は「会社名（名前なし）」、所属の写しは affiliation = 'partner'・supplier_id = 選んだ会社（アプリが保存のときに決める）。
--
-- 実行の順番：この SQL を先に実行してから、新しい版のアプリを出す。
--   古い版のアプリはこの SQL の後でも動く（人数を送らない＝null＝1 人）。
--   新しい版のアプリはこの SQL の前でも動く（列が無ければ、作業員の選択肢に「名前なし」を出さず、名前なしの行の保存は
--   「まだ保存できません」で止める。読み取りは人数の列なしで読み直す）。
begin;

-- 1. 列 ------------------------------------------------------------------------------------
alter table public.gn_report_lines add column if not exists headcount integer;
alter table public.gn_report_lines drop constraint if exists gn_report_lines_headcount_ck;
alter table public.gn_report_lines add constraint gn_report_lines_headcount_ck
  check (headcount is null or headcount >= 1);

-- 2. 作業員の行の計算 --------------------------------------------------------------------------
-- 人工・残業時間は 1 人分 × 人数（人数 null は 1 人）。実働は 1 人あたり。
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
  v_count   int;
begin
  -- 人数（2026-11-19）は名前なし（作業員を選んでいない）作業員の行だけ。それ以外の行は null。
  if new.kind <> 'labor' or new.ref_id is not null then
    new.headcount := null;
  end if;
  if new.kind = 'labor' then
    -- 人数（null は名前のある行＝1 人）。実働は 1 人あたり、人工・残業時間・労務費は人数分。
    v_count := coalesce(new.headcount, 1);
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
      new.man_days := round(v_hours / coalesce(s.shotei_hours, 7.5), 2) * v_count;
    else
      new.man_days := v_count;
    end if;
    -- 残業時間：固定残業の上限を超えた分
    new.overtime_hours := round(greatest(v_hours - coalesce(s.fixed_overtime_limit, 8), 0), 2) * v_count;
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
    -- 作業内容の man_days は入力値（投入人工）。減（change_kind = 'minus'）は数量・単価を正で入れ、金額を負で保存する
    new.amount       := (case when new.change_kind = 'minus' then -1 else 1 end)
                        * coalesce(new.qty, 0) * coalesce(new.unit_price, 0);
    new.productivity := case when coalesce(new.man_days, 0) = 0 then null else new.qty / new.man_days end;
    new.hours        := null;
    new.overtime_hours := null; new.overtime_rate := null;
  end if;
  return new;
end;
$$;

-- 3. 日報の保存 ------------------------------------------------------------------------------
-- 名前なしの作業員の行の人数を書く。それ以外は 2026-11-17 の定義と同じ。
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
    purchase_kind, jouyou_hours,
    headcount
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
    case when t.kind = 'labor' then t.jouyou_hours end,
    -- 人数（2026-11-19）は名前なし（作業員を選んでいない）作業員の行だけ。gn_report_lines_compute も同じくそろえる。
    case when t.kind = 'labor' and t.ref_id is null then t.headcount end
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

commit;
