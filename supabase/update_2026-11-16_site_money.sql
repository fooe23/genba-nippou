-- 2026-11-16：現場のお金の列（請負金額 contract_amount・概算金額 estimated_amount・常用単価の既定 default_daily_rate）を
-- 協力会社のアカウントから読めなくする。update_2026-11-15_budget.sql の後に 1 回実行する（schema_genba.sql には反映済み）。
-- 何度実行しても安全（冪等）。制約・索引は作らない（名前の衝突は起きない）。
--
-- 今まで：gn_sites_select（using gn_is_site_member(id)）で、割り当てられた協力会社も gn_sites の全部の列を
--   Supabase の API から直接読めた（画面に出していなくても、自分のログインで contract_amount を取れた）。
-- これから：
--   1. 列の権限：authenticated の gn_sites の SELECT を表ごと外し、お金の 3 列を除いた列だけ SELECT を付け直す。
--      RLS（どの行が見えるか）は今までのまま。insert・update・delete の権限もそのまま（管理者の編集は今まで通り。
--      update の where は id・deleted_at、returning は id だけを使うので、お金の列の SELECT が無くても通る）。
--      → 協力会社も社員も、gn_sites を直接読むときはお金の列を取れない（select * も permission denied になる）。
--   2. お金の列は gn_site_money(p_site_ids) で読む（SECURITY DEFINER）。返すのは、呼んだ人が社員・管理者
--      （gn_is_employee_or_admin()）で、かつその現場を見られる（gn_is_site_member()。管理者は全部、社員は削除されていない全部）
--      現場の行だけ。協力会社には 1 行も返らない。
-- 既存の SECURITY DEFINER の関数（gn_is_site_member・gn_site_closed・gn_add_site_partner_worker など）は所有者の権限で読むので影響なし。
--
-- 注意：これ以降 gn_sites に列を足すときは、下の grant select (...) にその列を足すこと（足さないと誰も読めない）。
--
-- 実行の順番：この SQL を先に実行してから、新しい版のアプリを出す。
--   新しい版のアプリは、この SQL の前でも後でも動く（gn_site_money が無ければ、社員・管理者だけ今まで通り表から直接読む）。
--   古い版のアプリは、この SQL の後では現場の読み込み（お金の列を含む select）が失敗するので、SQL の後は必ず新しい版にする。

-- 1. 列の権限 -----------------------------------------------------------------------------
-- 表の SELECT を外すと、その表の列ごとの SELECT も一緒に外れる（付け直すので何度実行しても同じ結果）。
revoke select on public.gn_sites from authenticated, anon;
-- 付け直す列は、いまの表の列からお金の 3 列を除いたもの全部（DB に実際にある列から作るので、列の書き漏れが起きない）
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'gn_sites'
     and column_name not in ('contract_amount', 'estimated_amount', 'default_daily_rate');
  execute format('grant select (%s) on public.gn_sites to authenticated', cols);
end
$$;

-- 2. お金の列を読む関数 ---------------------------------------------------------------------
create or replace function public.gn_site_money(p_site_ids uuid[])
returns table (site_id uuid, contract_amount numeric, estimated_amount numeric, default_daily_rate numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.contract_amount, s.estimated_amount, s.default_daily_rate
    from public.gn_sites s
   where auth.uid() is not null
     and s.id = any (coalesce(p_site_ids, array[]::uuid[]))
     and public.gn_is_employee_or_admin()
     and public.gn_is_site_member(s.id);
$$;
revoke all on function public.gn_site_money(uuid[]) from public, anon;
grant execute on function public.gn_site_money(uuid[]) to authenticated;
