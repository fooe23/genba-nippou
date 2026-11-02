-- 氏名の参照関数（Excel 出力の作成者・確認者・承認者欄のため）
-- 2026-11-03。schema_genba.sql 適用済みの環境に対する差分。何度実行しても安全。
-- profiles は本人と管理者しか読めない（RLS）ので、ログイン中のユーザーに
-- 「指定した id の氏名（無ければメール）」だけを返す security definer の関数を用意する。
-- 返すのは id と表示名だけ（メールや権限は返さない）。
create or replace function public.gn_profile_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.name), ''), p.email, '') as display_name
    from public.profiles p
   where auth.uid() is not null
     and p.id = any (coalesce(p_ids, array[]::uuid[]));
$$;
revoke all on function public.gn_profile_names(uuid[]) from public, anon;
grant execute on function public.gn_profile_names(uuid[]) to authenticated;
