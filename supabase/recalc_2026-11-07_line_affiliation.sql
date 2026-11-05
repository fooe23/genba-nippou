-- 2026-11-07：保存済みの日報の作業員の行の所属（affiliation・supplier_id）を、いまの作業員マスターから写し直す（任意・1 回だけ）。
-- update_2026-11-07_worker_affiliation.sql は、過去の作業員の行（作業員マスターを参照している行）をすべて「自社」で埋める。
-- 既存の作業員のうち協力会社の人を作業員マスターで「協力会社」（と取引先）に分け終えてから、このファイルを 1 回だけ実行する。
-- 注意：作業員マスターを参照しているすべての過去の行の所属を、いまのマスターの所属で上書きする
--       （日報ごとの「その日の所属」は失われる。分け終えた直後に 1 回だけ使う。運用が始まってから実行しないこと）。
--   * 協力会社の作業員の行：affiliation = 'partner'、supplier_id = 作業員の取引先、常用・請負が空なら常用（'jouyou'）
--   * 自社の作業員の行：affiliation = 'own'、supplier_id・labor_contract は null
--   * 手入力の行（ref_id なし）・マスターに無い作業員の行：変えない（所属なし）
-- 人工・金額は計算し直さない（計算のトリガーを外す）。承認済みの日報・完了現場の行も対象なので明細のガードも外す
-- （recalc_2026-11-03_labor.sql と同じやり方）。同じマスターなら何度実行しても結果は同じ。
begin;
  alter table public.gn_report_lines disable trigger gn_report_lines_guard;
  alter table public.gn_report_lines disable trigger gn_report_lines_compute;
  update public.gn_report_lines l set
    affiliation    = case when w.affiliation = 'partner' then 'partner' else 'own' end,
    supplier_id    = case when w.affiliation = 'partner' then w.supplier_id end,
    labor_contract = case when w.affiliation = 'partner' then coalesce(l.labor_contract, 'jouyou') end
  from public.gn_workers w
  where l.kind = 'labor'
    and l.ref_id = w.id
    and (l.affiliation        is distinct from (case when w.affiliation = 'partner' then 'partner' else 'own' end)
      or l.supplier_id        is distinct from (case when w.affiliation = 'partner' then w.supplier_id end)
      or l.labor_contract     is distinct from (case when w.affiliation = 'partner' then coalesce(l.labor_contract, 'jouyou') end));
  alter table public.gn_report_lines enable trigger gn_report_lines_compute;
  alter table public.gn_report_lines enable trigger gn_report_lines_guard;
commit;

-- 確認：所属ごとの作業員の行の件数（所属なし＝手入力・マスターに無い作業員）
select coalesce(affiliation, '所属なし') as affiliation, count(*) as lines
  from public.gn_report_lines where kind = 'labor' group by 1 order by 1;
