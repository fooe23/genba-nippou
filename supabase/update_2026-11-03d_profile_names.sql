-- 氏名の参照関数（Excel 出力の作成者・確認者・承認者欄のため）
-- 2026-11-03。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- profiles は本人と管理者しか読めない（RLS）ので、ログイン中のユーザーに
-- 「指定した id の氏名」だけを返す security definer の関数を用意する（メールや権限は返さない）。
-- 見られる範囲は本人・管理者・自分が見られる現場の日報に出てくる人・現場の担当者に限る。
create or replace function public.gn_profile_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  -- 返すのは氏名だけ（メールは返さない）。見られる範囲：本人、管理者、
  -- 自分が見られる現場の日報の作成者・確認者・承認者、自分が見られる現場の担当者。
  select p.id, coalesce(nullif(btrim(p.name), ''), '') as display_name
    from public.profiles p
   where auth.uid() is not null
     and p.id = any (coalesce(p_ids, array[]::uuid[]))
     and (
       p.id = auth.uid()
       or public.is_admin()
       or exists (
         select 1 from public.gn_daily_reports r
          where public.gn_is_site_member(r.site_id)
            and p.id in (r.created_by, r.reviewed_by, r.approved_by)
       )
       or exists (
         select 1 from public.gn_site_members m
          where m.user_id = p.id and public.gn_is_site_member(m.site_id)
       )
     );
$$;
revoke all on function public.gn_profile_names(uuid[]) from public, anon;
grant execute on function public.gn_profile_names(uuid[]) to authenticated;
