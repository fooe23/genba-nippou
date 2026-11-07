-- 2026-11-11：重要事項の件の種別に「現場判断（要協議）」（site_judgment）、指示方法に「指示なし（現場判断）」（site）を足す。
-- update_2026-11-04d_increase_kind.sql まで適用済みの環境で 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
--   * gn_report_issues.kind：'extra','increase','change','minus','client_delay','rework','other','site_judgment'
--     site_judgment は指示が無いのに現場の状況でやった作業（精算はあとで協議。数え方は追加と同じ＝アプリ側）。
--   * gn_report_issues.instruction_method・gn_report_lines.instruction_method：'oral','phone','email','document','other','site'
--     site は指示なし（指示者は空でよい）。
-- 制約の名前：
--   列の check 制約は add column の中で書いたので名前が自動（<表>_<列>_check。例 gn_report_issues_instruction_method_check）。
--   名前に頼らず、その列 1 つだけに掛かっている check 制約を pg_constraint から全部探して外し、<表>_<列>_check の名前で付け直す。
--   同じ名前の別の制約（ほかの列も含む check など）が残っていれば、付け直す前に例外で止める（黙って別の制約を消さない）。
--   いまのスキーマに、これらの列を含む複数列の check は無い（kind・instruction_method の check は各列 1 つだけ）。
-- 既存の行の値は変えない（今ある値はすべて新しい制約を満たす）。

begin;

-- 列 1 つだけの check 制約を全部外し、<表>_<列>_check で付け直す（同じ名前の別の制約が残っていれば止める）。
create or replace function pg_temp.gn_replace_column_check(p_table text, p_column text, p_check text) returns void
language plpgsql as $f$
declare
  c record;
  v_name text := p_table || '_' || p_column || '_check';
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attname = p_column
    where con.conrelid = ('public.' || p_table)::regclass
      and con.contype = 'c'
      and con.conkey = array[a.attnum]
  loop
    execute format('alter table public.%I drop constraint %I', p_table, c.conname);
  end loop;
  if exists (select 1 from pg_constraint where conrelid = ('public.' || p_table)::regclass and conname = v_name) then
    raise exception '制約 % が別の内容で残っています。中身を確かめてから付け直してください', v_name;
  end if;
  execute format('alter table public.%I add constraint %I check (%s)', p_table, v_name, p_check);
end $f$;

-- 1. 重要事項の件の種別
select pg_temp.gn_replace_column_check('gn_report_issues', 'kind',
  $c$kind in ('extra','increase','change','minus','client_delay','rework','other','site_judgment')$c$);

-- 2. 指示方法（件・作業内容の行）
select pg_temp.gn_replace_column_check('gn_report_issues', 'instruction_method',
  $c$instruction_method in ('oral','phone','email','document','other','site')$c$);
select pg_temp.gn_replace_column_check('gn_report_lines', 'instruction_method',
  $c$instruction_method in ('oral','phone','email','document','other','site')$c$);

commit;

-- 確認（任意）：3 行とも site_judgment / site を含む定義が出れば適用済み。
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('gn_report_issues_kind_check', 'gn_report_issues_instruction_method_check', 'gn_report_lines_instruction_method_check');
