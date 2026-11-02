-- 2026-11-03 の追加修正：残業単価の既定式で、ちょうど .5 円になる値が切り捨てになる不具合を直す（先に掛けてから割る）。
-- update_2026-11-03_labor_rule.sql を適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。
-- 既定の設定（基準 8H・割増 1.25）では差は出ない。

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
