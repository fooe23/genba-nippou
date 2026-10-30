-- =====================================================================
-- 既存アプリの profiles 保護（必須・1回だけ実行）
--
-- 既存の業務報告アプリのポリシー
--   profiles_update using (id = auth.uid() or public.is_admin())
-- には with check が無いため、ログインした利用者なら誰でも自分の行の is_admin を
-- true に書き換えられる（管理者への自己昇格）。現場日報アプリは is_admin を
-- 全現場の閲覧・承認・マスター管理の判定に使うので、この穴をふさぐ。
--
-- 既存のポリシーには手を付けず、トリガーで「管理者以外が is_admin を変える」ことだけを止める。
--   * update：is_admin の値が変わり、かつ実行者が管理者でなければ is_admin_locked
--   * insert：is_admin = true の行を、管理者でない利用者が作ろうとしたら is_admin_locked
--   * 名前・メールなど他の列の更新はこれまでどおり通る
--   * 判定するのはアプリ利用者（ロール authenticated / anon）からの変更だけ。
--     SQL Editor（postgres）や service_role、既存の security definer 関数からの変更は止めない
--     （README の「最初の管理者」の update を SQL Editor で実行できるようにするため）。
--
-- profiles は既存アプリと共用のテーブル。適用するかどうかはプロジェクトの管理者が決める。
-- 何度実行しても安全（冪等）。schema_genba.sql とは別に、SQL Editor で実行する。
-- =====================================================================

-- security invoker：current_user が呼び出したロール（authenticated / anon / postgres など）になる。
create or replace function public.gn_profiles_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- アプリ利用者以外（SQL Editor・service_role・security definer 関数）は対象外
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) = true and not public.is_admin() then
      raise exception using message = 'is_admin_locked';
    end if;
    return new;
  end if;

  -- update：null と false は同じ「管理者でない」として比べる
  if coalesce(new.is_admin, false) is distinct from coalesce(old.is_admin, false)
     and not public.is_admin() then
    raise exception using message = 'is_admin_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists gn_profiles_guard on public.profiles;
create trigger gn_profiles_guard before insert or update on public.profiles
  for each row execute function public.gn_profiles_guard();
