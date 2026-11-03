-- 2026-11-04d：作業内容の区分と重要事項の件の種別に「増」（increase）を足す。
-- update_2026-11-04_change_tracking.sql を適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * 「追加」（extra）は新しく別の仕事が増えたもの、「増」（increase）は同じ流れの中で数量が増えたもの。
--     計算・集計・提案額の扱いは追加と同じ（アプリ側。DB の計算 gn_report_lines_compute は減だけを負にするので変更なし）。
--   * gn_report_lines.change_kind：'contract','extra','increase','change','minus'
--   * gn_report_issues.kind：'extra','increase','change','minus','client_delay','rework','other'
-- 列の check 制約は add column の中で書いたので名前が自動（gn_report_lines_change_kind_check など）。
-- 名前に頼らず、その列だけに掛かっている check 制約を pg_constraint から探して外し、同じ名前で付け直す。
-- 既存の行の値は変えない（今ある値はすべて新しい制約を満たす）。

begin;

-- 1. 作業内容の行の区分 ---------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attname = 'change_kind'
    where con.conrelid = 'public.gn_report_lines'::regclass
      and con.contype = 'c'
      and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.gn_report_lines drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.gn_report_lines add constraint gn_report_lines_change_kind_check
  check (change_kind in ('contract','extra','increase','change','minus'));

-- 2. 重要事項の件の種別 -------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attname = 'kind'
    where con.conrelid = 'public.gn_report_issues'::regclass
      and con.contype = 'c'
      and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.gn_report_issues drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.gn_report_issues add constraint gn_report_issues_kind_check
  check (kind in ('extra','increase','change','minus','client_delay','rework','other'));

commit;

-- 確認（任意）：2 行とも 'increase' を含む定義が出れば適用済み。
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('gn_report_lines_change_kind_check', 'gn_report_issues_kind_check');
