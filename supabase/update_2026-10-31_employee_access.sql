-- =====================================================================
-- 2026-10-31 社員は全現場に入力可、協力会社は割り当て現場のみ（権限関数の差し替え）
--
-- schema_genba.sql を再実行しても同じ結果。既に全体を適用済みの環境ではこのファイルだけ実行すればよい。
-- 何度実行しても安全（create or replace のみ。テーブル・データは変わらない）。
--
-- ルール：
--   * 管理者：すべての現場
--   * 社員（profiles.account_type = 'employee'）：すべての現場の日報を閲覧・入力できる
--   * 協力会社（'partner'）：gn_site_members に割り当てられた現場だけ
--   * 承認・差戻しは従来どおり、その現場の reviewer / approver（と管理者）だけ（gn_site_role は変更なし）
--
-- 前提：add_profile_account_type.sql を実行済み（profiles.account_type 列が必要）。
-- =====================================================================

create or replace function public.gn_is_site_member(p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_site is not null
         and (
           public.is_admin()
           or exists (
             select 1 from public.gn_site_members
              where site_id = p_site and user_id = auth.uid()
           )
           or exists (
             select 1 from public.profiles p
              where p.id = auth.uid()
                and p.account_type = 'employee'
                and exists (select 1 from public.gn_sites s where s.id = p_site)
           )
         );
$$;
