-- 2026-11-04b：作業内容の「減」の行の金額を負で保存する。
-- update_2026-11-04_change_tracking.sql を適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * gn_report_lines_compute：kind = 'work' かつ change_kind = 'minus' の行は amount = −(数量 × 単価)。
--     利用者は減の行も数量・単価を正で入れる。歩掛（productivity）は今までどおり（数量 ÷ 投入人工）。
--     日報の出来高（output_total）は gn_save_report が作業内容の amount を足すので、減の分だけ自動で下がる。
--   * 保存済みの「減」の作業内容の行を計算し直し、その日報の出来高も計算し直す（対象が無ければ何もしない）。
-- アプリの画面の計算（src/lib/calc/report.ts の workAmount）も同じ規則。

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

-- 保存済みの「減」の作業内容の行を計算し直す（承認済み・完了現場の日報も対象なので、ガードを一時的に外す）。
begin;
  alter table public.gn_report_lines disable trigger gn_report_lines_guard;
  -- 「同じ値で更新」すると BEFORE UPDATE の gn_report_lines_compute が走り、金額が負で計算し直される
  update public.gn_report_lines set unit_price = unit_price where kind = 'work' and change_kind = 'minus';
  alter table public.gn_report_lines enable trigger gn_report_lines_guard;

  alter table public.gn_daily_reports disable trigger gn_report_guard;
  update public.gn_daily_reports r set
    output_total = coalesce((select sum(l.amount) from public.gn_report_lines l where l.report_id = r.id and l.kind = 'work'), 0)
  where exists (select 1 from public.gn_report_lines l where l.report_id = r.id and l.kind = 'work' and l.change_kind = 'minus');
  alter table public.gn_daily_reports enable trigger gn_report_guard;
commit;

-- 確認：「減」の作業内容の行で、金額が正のもの（計算し直しの漏れ）が 0 件であること
select count(*) as minus_lines, count(*) filter (where amount > 0) as positive_left
from public.gn_report_lines where kind = 'work' and change_kind = 'minus';
