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
--   * 区分（account_type）・会社名（company_name）も同様に管理者だけが変えられる。
--     管理者以外の変更・insert での employee 以外／会社名の指定は account_type_locked
--     （協力会社の職長が自分の区分を employee に書き換えて業務日報アプリに入るのを防ぐ）
--   * 名前・メールなど他の列の更新はこれまでどおり通る
--   * 判定するのはアプリ利用者（ロール authenticated / anon）からの変更だけ。
--     SQL Editor（postgres）や service_role、既存の security definer 関数からの変更は止めない
--     （README の「最初の管理者」の update を SQL Editor で実行できるようにするため）。
--
-- 前提：add_profile_account_type.sql を先に実行しておくこと（account_type・company_name 列を参照する）。
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
    -- 管理者以外は、区分 employee・会社名なしの行しか作れない
    if (new.account_type is distinct from 'employee' or new.company_name is not null)
       and not public.is_admin() then
      raise exception using message = 'account_type_locked';
    end if;
    return new;
  end if;

  -- update：null と false は同じ「管理者でない」として比べる
  if coalesce(new.is_admin, false) is distinct from coalesce(old.is_admin, false)
     and not public.is_admin() then
    raise exception using message = 'is_admin_locked';
  end if;

  -- 区分・会社名の変更は管理者だけ
  if (new.account_type is distinct from old.account_type
      or new.company_name is distinct from old.company_name)
     and not public.is_admin() then
    raise exception using message = 'account_type_locked';
  end if;
  return new;
end;
$$;

drop trigger if exists gn_profiles_guard on public.profiles;
create trigger gn_profiles_guard before insert or update on public.profiles
  for each row execute function public.gn_profiles_guard();
