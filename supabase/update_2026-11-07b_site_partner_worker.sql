-- 2026-11-07b：現場の「協力会社と作業員」画面から、協力会社の作業員を新しく登録する関数 gn_add_site_partner_worker。
-- 社員・管理者が、進行中の現場に入っている協力会社の作業員を、作業員マスター（所属＝その協力会社）・最初の日当・
-- この現場への登録まで 1 回で作る（社員は作業員マスターと日当に直接書けないため、権限を確かめる関数にする）。
-- 協力会社のアカウントは使えない。新しい協力会社（会社そのもの）の登録はこれまでどおり管理者だけ（マスター → 協力会社）。
-- update_2026-11-07_worker_affiliation.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- この関数を使うアプリの版は、この SQL を実行した後に出す（先に出すと登録ボタンがエラーになる）。

-- 現場から協力会社の作業員を新しく登録する（2026-11-07。update_2026-11-07b_site_partner_worker.sql）。
-- 社員は gn_workers・gn_worker_rates に直接書けない（管理者だけ）ので、権限を確かめてから 1 回で作る：
--   作業員マスター（所属＝協力会社・その会社・有効）＋ 最初の日当 ＋ この現場への登録（並び順は最後）。
-- 日当の適用開始日は、この現場の着工日（無ければ今日の 31 日前）・最初の日報の日付・今日（日本時間）のうち最も早い日
-- （適用開始日は日報の日付以前にする、という作業員マスターの規則に合わせる。新しい作業員なので前の日当は無い）。
-- 更新者（updated_by）は gn_touch_updated のトリガーが呼び出しユーザー（auth.uid()）で入れる。途中で失敗すれば全部戻る。
-- 拒否の理由（アプリが文言に変える）：
--   not_employee（社員・管理者でない）・site_closed（現場が無い・削除済み・完了）・not_member（現場を見られない）・
--   not_site_partner（有効な協力会社でない、またはこの現場の協力会社に入っていない）・
--   invalid_input（名前が空か 100 文字超・職種が 500 文字超・日当が無いか負か数でない・残業単価が負か数でない）・
--   duplicate_worker（この会社に同じ名前の有効な作業員がすでにいる）
drop function if exists public.gn_add_site_partner_worker(uuid, uuid, text, text, numeric, numeric, date);
create or replace function public.gn_add_site_partner_worker(
  p_site_id uuid,
  p_supplier_id uuid,
  p_name text,
  p_trade text,
  p_daily_rate numeric,
  p_overtime_rate numeric
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_trade  text := nullif(btrim(coalesce(p_trade, '')), '');
  v_today  date := (now() at time zone 'Asia/Tokyo')::date;
  v_start  date;
  v_first  date;
  v_from   date;
  v_worker uuid;
  v_sort   int;
begin
  if not public.gn_is_employee_or_admin() then
    raise exception using message = 'not_employee';
  end if;
  if p_site_id is null or public.gn_site_closed(p_site_id) then
    raise exception using message = 'site_closed';
  end if;
  if not public.gn_is_site_member(p_site_id) then
    raise exception using message = 'not_member';
  end if;
  if p_supplier_id is null or not exists (
    select 1
      from public.gn_suppliers s
      join public.gn_site_partners sp on sp.supplier_id = s.id and sp.site_id = p_site_id
     where s.id = p_supplier_id
       and s.is_partner
       and s.active is not false
  ) then
    raise exception using message = 'not_site_partner';
  end if;
  -- numeric の NaN は Infinity より大きく並ぶので、「0 以上かつ Infinity 未満」で NaN・±Infinity・負をまとめて弾く。
  if v_name = '' or length(v_name) > 100
     or length(coalesce(v_trade, '')) > 500
     or p_daily_rate is null or not (p_daily_rate >= 0 and p_daily_rate < 'Infinity'::numeric)
     or (p_overtime_rate is not null and not (p_overtime_rate >= 0 and p_overtime_rate < 'Infinity'::numeric)) then
    raise exception using message = 'invalid_input';
  end if;
  -- 同じ会社に同じ名前の有効な作業員がいれば作らない（チェックを付けて登録してもらう）。同時の登録は会社の行の鍵で順に並べる。
  perform 1 from public.gn_suppliers where id = p_supplier_id for update;
  if exists (
    select 1 from public.gn_workers w
     where w.supplier_id = p_supplier_id
       and w.affiliation = 'partner'
       and w.active is not false
       and btrim(w.name) = v_name
  ) then
    raise exception using message = 'duplicate_worker';
  end if;

  select s.start_date into v_start from public.gn_sites s where s.id = p_site_id;
  select min(r.report_date) into v_first from public.gn_daily_reports r where r.site_id = p_site_id;
  v_from := least(coalesce(v_start, v_today - 31), coalesce(v_first, v_today), v_today);

  insert into public.gn_workers (name, trade, overtime_rate, affiliation, supplier_id, active)
  values (v_name, v_trade, p_overtime_rate, 'partner', p_supplier_id, true)
  returning id into v_worker;

  insert into public.gn_worker_rates (worker_id, amount, effective_from)
  values (v_worker, p_daily_rate, v_from);

  select coalesce(max(coalesce(sort_order, 0)) + 1, 0) into v_sort
    from public.gn_site_workers where site_id = p_site_id;
  insert into public.gn_site_workers (site_id, worker_id, sort_order)
  values (p_site_id, v_worker, v_sort);

  return v_worker;
end;
$$;
revoke all on function public.gn_add_site_partner_worker(uuid, uuid, text, text, numeric, numeric) from public, anon;
grant execute on function public.gn_add_site_partner_worker(uuid, uuid, text, text, numeric, numeric) to authenticated;
