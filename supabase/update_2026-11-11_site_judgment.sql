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
-- あわせて（3・4）、件を提出前と差戻し後に直せる・消せるようにする：
--   * gn_report_issues_guard を差し替え：件の中身（内容・種別・指示者・指示方法・金額見込み）を変えられるのは件の日報が
--     下書き・差戻しのあいだだけ（issue_locked）、協力会社は自分が作った日報の件だけ（issue_not_own）。状態・精算の項目は今までどおり。
--   * 件の削除のトリガー gn_report_issues_delete_guard を足す（下書き・差戻しだけ、作業内容の行が使っている件・添付のある件は消せない）。
--   * 件の削除のポリシー gn_report_issues_delete を管理者だけから現場メンバーに広げる（条件はトリガーが見る）。

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

-- 3. 件の中身を直せるのは下書き・差戻しのあいだだけ（件のガードの差し替え）
create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site    uuid;
  v_status  text;
  v_creator uuid;
  v_settles boolean;
begin
  select r.site_id, r.status, r.created_by into v_site, v_status, v_creator from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  -- 精算の項目（精算の方法・確定額・常用単価・確定日）を入れる（insert で既定［未定・空］以外の値）・変える（update）のは
  -- 社員（account_type = 'employee'）か管理者だけ。それ以外（協力会社・profiles の行が無いユーザー）は not_employee。
  -- auth.uid() が無い呼び出し（SQL Editor・service role。RLS の外）は対象外。
  -- （insert では old を参照しないよう、insert と update を分けて判定する）
  if tg_op = 'INSERT' then
    v_settles := new.settlement_method <> 'undecided'
      or new.fixed_amount is not null
      or new.daily_rate is not null
      or new.fixed_on is not null;
  else
    v_settles := new.settlement_method is distinct from old.settlement_method
      or new.fixed_amount is distinct from old.fixed_amount
      or new.daily_rate is distinct from old.daily_rate
      or new.fixed_on is distinct from old.fixed_on;
  end if;
  if v_settles and auth.uid() is not null
     and not exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and (p.account_type = 'employee' or public.is_admin())
     ) then
    raise exception using message = 'not_employee';
  end if;
  -- 件の中身（内容・種別・指示者・指示方法・金額見込み）を直せるのは、件の日報が下書きか差戻しのあいだだけ（管理者も同じ）。
  -- それ以外は issue_locked。協力会社は自分が作った日報の件だけ（issue_not_own）。状態・精算の項目は今までどおりいつでも変えられる。
  -- auth.uid() が無い呼び出し（SQL Editor・service role）は対象外。2026-11-11（update_2026-11-11_site_judgment.sql）。
  if tg_op = 'UPDATE' and auth.uid() is not null
     and (new.body, new.kind, new.instructed_by, new.instruction_method, new.amount_estimate)
         is distinct from (old.body, old.kind, old.instructed_by, old.instruction_method, old.amount_estimate) then
    if v_status not in ('draft','rejected') then
      raise exception using message = 'issue_locked';
    end if;
    if not (public.gn_is_employee_or_admin() or v_creator = auth.uid()) then
      raise exception using message = 'issue_not_own';
    end if;
  end if;
  new.site_id := v_site;
  return new;
end;
$$;

-- 4. 件の削除
-- 件の削除（2026-11-11）。件の日報が下書きか差戻しのあいだだけ消せる（管理者も同じ。issue_locked）。協力会社は自分が作った
-- 日報の件だけ（issue_not_own）。作業内容の行が根拠の件にしている件（issue_in_use）と、写真・資料が付いている件
-- （issue_has_attachments。協力会社に見えないファイルも数える）は消せない。security definer：行・添付の有無を RLS に関係なく見る。
-- 親の日報がもう無い＝日報を消したときの連鎖削除は、日報の削除の権限で決まっているので通す。
-- auth.uid() が無い呼び出し（SQL Editor・service role）も通す。
create or replace function public.gn_report_issues_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_site    uuid;
  v_status  text;
  v_creator uuid;
begin
  if auth.uid() is null then
    return old;
  end if;
  select r.site_id, r.status, r.created_by into v_site, v_status, v_creator from public.gn_daily_reports r where r.id = old.report_id;
  if not found then
    return old;
  end if;
  if not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  if v_status not in ('draft','rejected') then
    raise exception using message = 'issue_locked';
  end if;
  if not (public.gn_is_employee_or_admin() or v_creator = auth.uid()) then
    raise exception using message = 'issue_not_own';
  end if;
  if exists (select 1 from public.gn_report_lines l where l.issue_id = old.id) then
    raise exception using message = 'issue_in_use';
  end if;
  if exists (select 1 from public.gn_attachments a where a.issue_id = old.id) then
    raise exception using message = 'issue_has_attachments';
  end if;
  return old;
end;
$$;

drop trigger if exists gn_report_issues_delete_guard on public.gn_report_issues;
create trigger gn_report_issues_delete_guard before delete on public.gn_report_issues
  for each row execute function public.gn_report_issues_delete_guard();

-- 件の削除は現場メンバー（2026-11-11。以前は管理者だけ）。消せる条件はトリガー gn_report_issues_delete_guard が見る。
drop policy if exists gn_report_issues_delete on public.gn_report_issues;
create policy gn_report_issues_delete on public.gn_report_issues for delete to authenticated using (public.gn_is_site_member(site_id));

commit;

-- 確認（任意）：3 行とも site_judgment / site を含む定義が出れば適用済み。
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('gn_report_issues_kind_check', 'gn_report_issues_instruction_method_check', 'gn_report_lines_instruction_method_check');
-- select tgname from pg_trigger where tgname = 'gn_report_issues_delete_guard';
