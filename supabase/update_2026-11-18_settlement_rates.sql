-- 2026-11-18：件の精算に掛ける 4 つの率（法定福利費率・材料経費率・リース燃料経費率・諸経費率［利益含む］）。何度実行しても安全（冪等）。
-- update_2026-11-17_subcontract.sql の後に 1 回実行する（schema_genba.sql には反映済み）。既存の行は書き換えない。
--
-- 足すもの：全社の設定（gn_settings）に 4 つの列（単位は %。15.1 = 15.1%）。
--   * legal_welfare_rate      法定福利費率（既定 15.1）：労務（施工金額）に掛ける
--   * material_expense_rate   材料経費率（既定 12）：材料（仕入の買掛・現金）に掛ける
--   * lease_fuel_expense_rate リース燃料経費率（既定 12）：リース・燃料に掛ける
--   * overhead_profit_rate    諸経費率（利益含む。既定 8）：上の 3 つを足した額に掛ける
--   件の精算の提案額 ＝ 円未満切り上げ（（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋（リース＋燃料）×（1＋リース燃料経費率））
--                     ×（1＋諸経費率）＋ 外注）。外注（根拠の件を選んだ外注の買掛）には率を掛けない。
--
-- 古い列 overhead_rate（経費率）・profit_rate（利益率）は消さずに残す（アプリはもう使わない）。
--
-- 制約の名前：check は列の定義に書かず、名前付きの制約（gn_settings_<列>_ck）で付ける
-- （列に書くと自動の名前 gn_settings_<列>_check になり、付け直しのときに重なるため）。値は 0〜100。
--
-- 実行の順番：アプリはこの SQL の前でも動く（列が無ければ既定の率 15.1%・12%・12%・8% で計算し、設定の画面で率を保存すると
-- 「率は保存できませんでした」と出す。ほかの設定は保存される）。
begin;

alter table public.gn_settings add column if not exists legal_welfare_rate    numeric not null default 15.1;
alter table public.gn_settings add column if not exists material_expense_rate numeric not null default 12;
alter table public.gn_settings add column if not exists lease_fuel_expense_rate numeric not null default 12;
alter table public.gn_settings add column if not exists overhead_profit_rate  numeric not null default 8;

alter table public.gn_settings drop constraint if exists gn_settings_legal_welfare_rate_ck;
alter table public.gn_settings add constraint gn_settings_legal_welfare_rate_ck
  check (legal_welfare_rate >= 0 and legal_welfare_rate <= 100);
alter table public.gn_settings drop constraint if exists gn_settings_material_expense_rate_ck;
alter table public.gn_settings add constraint gn_settings_material_expense_rate_ck
  check (material_expense_rate >= 0 and material_expense_rate <= 100);
alter table public.gn_settings drop constraint if exists gn_settings_lease_fuel_expense_rate_ck;
alter table public.gn_settings add constraint gn_settings_lease_fuel_expense_rate_ck
  check (lease_fuel_expense_rate >= 0 and lease_fuel_expense_rate <= 100);
alter table public.gn_settings drop constraint if exists gn_settings_overhead_profit_rate_ck;
alter table public.gn_settings add constraint gn_settings_overhead_profit_rate_ck
  check (overhead_profit_rate >= 0 and overhead_profit_rate <= 100);

commit;
