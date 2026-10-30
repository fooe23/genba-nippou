-- =====================================================================
-- profiles に「区分（社員／協力会社）」と「会社名」の列を追加する（1回だけ実行）
--
-- 目的：協力会社の職長に現場日報アプリ専用のアカウントを発行できるようにする。
--   * account_type：'employee'（社員・既定）または 'partner'（協力会社）
--   * company_name：協力会社の会社名（社員は null）
-- 業務日報アプリ側は、区分が partner のアカウントを一覧から除外・ログインさせない
-- ように別途修正する。
--
-- 注意：fix_profiles_guard.sql は新しい列を参照するので、必ずこのファイルを
-- 先に実行してから fix_profiles_guard.sql を実行すること。
--
-- profiles は既存アプリと共用のテーブルだが、ここで行うのは列の追加のみ。
-- 既存の列・ポリシー・既存アプリの動作は変わらない。
-- 何度実行しても安全（冪等）。SQL Editor で実行する。
-- =====================================================================

alter table public.profiles add column if not exists account_type text not null default 'employee';
alter table public.profiles add column if not exists company_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_type_check') then
    alter table public.profiles
      add constraint profiles_account_type_check check (account_type in ('employee', 'partner'));
  end if;
end
$$;
