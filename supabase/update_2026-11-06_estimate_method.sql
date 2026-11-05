-- 2026-11-06：重要事項の件の精算の方法に「見積」（estimate）を足す。
-- update_2026-11-05b_issue_settlement_guard.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * gn_report_issues.settlement_method：'undecided'（未定）,'lump_sum'（一式）,'estimate'（見積）,'daily_rate'（常用）
--     一式は数量で表せないときのおおよその一括額、見積は材料などがはっきりしてからの細かい見積額。
--     計算は一式と同じ（fixed_amount を精算額にする。fixed_on は見積日として使う。見積は fixed_amount が必須＝アプリ側で検証）。
--   * 件のガード gn_report_issues_guard（05b）は 'undecided' 以外をすべて精算の値として扱うので変更なし
--     （協力会社が見積を入れることも not_employee で止まる）。
-- 列の check 制約は add column の中で書いたので名前が自動。名前に頼らず、その列だけに掛かっている check 制約を
-- pg_constraint から探して外し、gn_report_issues_settlement_method_check の名前で付け直す。
-- 既存の行の値は変えない（今ある値はすべて新しい制約を満たす）。
-- アプリは 'estimate' を書くので、アプリを新しい版にする前に実行する（先にアプリを出すと見積の保存が check 違反で失敗する）。

begin;

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attname = 'settlement_method'
    where con.conrelid = 'public.gn_report_issues'::regclass
      and con.contype = 'c'
      and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.gn_report_issues drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.gn_report_issues add constraint gn_report_issues_settlement_method_check
  check (settlement_method in ('undecided','lump_sum','estimate','daily_rate'));

commit;

-- 確認（任意）：'estimate' を含む定義が出れば適用済み。
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'gn_report_issues_settlement_method_check';
