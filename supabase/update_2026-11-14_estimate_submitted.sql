-- 2026-11-14：件ごとの「見積提出」の記録（見積書の PDF を付けなくても、見積を出した日を件に残せる）。何度実行しても安全。
-- update_2026-11-13_issue_client_confirmations.sql の後に 1 回実行する（schema_genba.sql には反映済み）。
-- アプリは件を読むときに estimate_submitted_on を読むので、アプリを新しい版にする前に実行する
-- （先にアプリを出すと、件の読み込み［日報・現場・帳票・お客様用の画面］がエラーになる）。
--
-- 1. gn_report_issues に 2 列を足す（どちらも null 可。check 制約は付けない）。
--    * estimate_submitted_on date：見積を出した日（メール・紙で出したときなど。null＝記録なし）。
--    * estimate_submitted_by uuid（profiles）：記録した人。アプリの利用者が記録したときはトリガーが auth.uid() を入れる。
-- 2. gn_report_issues_guard を作り直す（今までの確かめはすべてそのまま：report_id の付け替え禁止［issue_report_fixed］・
--    現場メンバー［report_not_found］・完了現場［site_closed］・精算の項目は社員だけ［not_employee］・件の中身の鍵
--    ［issue_locked・issue_not_own］・site_id を日報の現場にする）。足した確かめ：
--    * 見積提出の 2 列を入れる（insert で null 以外）・変える（update）のは社員か管理者だけ（協力会社は not_employee）。
--      状態・精算と同じく、件の日報の状態（提出済み・承認済み）に関係なくいつでも変えられる（件の中身の鍵の対象外）。
--      完了現場は今までどおり site_closed。auth.uid() が無い呼び出し（SQL Editor・service role）は対象外。
--    * 提出日が null なら記録した人も null にする（2 つ一緒に消える）。アプリの利用者が提出日を入れた・変えた・記録した人を
--      変えようとしたときは、記録した人をその利用者（auth.uid()）にする（ほかの人の名前で記録できない）。
--
-- 協力会社のアカウント：列は RLS（現場メンバーが読める）で読めるが、出るのは日付だけ。アプリは協力会社が見る件の
-- estimateSubmittedOn を空にして渡し、画面・お客様用の画面・PDF にも出さない（見積書の印と同じ扱い）。
--
-- 拒否の理由（足したもの）：なし（not_employee を見積提出の列にも使う）。

begin;

alter table public.gn_report_issues add column if not exists estimate_submitted_on date;
alter table public.gn_report_issues add column if not exists estimate_submitted_by uuid references public.profiles(id);

create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site     uuid;
  v_status   text;
  v_creator  uuid;
  v_settles  boolean;
  v_estimate boolean;
begin
  -- 件の日報（report_id）は、アプリの利用者からは変えられない（提出済みの日報の件を自分の下書きの日報に付け替えて
  -- 中身の鍵を外すことを防ぐ）。2026-11-12（update_2026-11-12_issue_report_fixed.sql）。SQL Editor・service role は対象外。
  if tg_op = 'UPDATE' and auth.uid() is not null and new.report_id is distinct from old.report_id then
    raise exception using message = 'issue_report_fixed';
  end if;
  select r.site_id, r.status, r.created_by into v_site, v_status, v_creator from public.gn_daily_reports r where r.id = new.report_id;
  if v_site is null or not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if public.gn_site_closed(v_site) then
    raise exception using message = 'site_closed';
  end if;
  -- 精算の項目（精算の方法・確定額・常用単価・確定日）を入れる（insert で既定［未定・空］以外の値）・変える（update）のは
  -- 社員（account_type = 'employee'）か管理者だけ。それ以外（協力会社・profiles の行が無いユーザー）は not_employee。
  -- 見積提出（提出日・記録した人）も同じ（2026-11-14。update_2026-11-14_estimate_submitted.sql）。
  -- auth.uid() が無い呼び出し（SQL Editor・service role。RLS の外）は対象外。
  -- （insert では old を参照しないよう、insert と update を分けて判定する）
  if tg_op = 'INSERT' then
    v_settles := new.settlement_method <> 'undecided'
      or new.fixed_amount is not null
      or new.daily_rate is not null
      or new.fixed_on is not null;
    v_estimate := new.estimate_submitted_on is not null or new.estimate_submitted_by is not null;
  else
    v_settles := new.settlement_method is distinct from old.settlement_method
      or new.fixed_amount is distinct from old.fixed_amount
      or new.daily_rate is distinct from old.daily_rate
      or new.fixed_on is distinct from old.fixed_on;
    v_estimate := new.estimate_submitted_on is distinct from old.estimate_submitted_on
      or new.estimate_submitted_by is distinct from old.estimate_submitted_by;
  end if;
  if (v_settles or v_estimate) and auth.uid() is not null
     and not exists (
       select 1 from public.profiles p
        where p.id = auth.uid() and (p.account_type = 'employee' or public.is_admin())
     ) then
    raise exception using message = 'not_employee';
  end if;
  -- 見積提出：提出日が無ければ記録した人も無し（2 つ一緒に消す）。アプリの利用者が入れた・変えたときは、記録した人を
  -- その利用者にする（ほかの人の名前で記録させない）。状態・精算と同じく、件の日報の状態に関係なくいつでも変えられる。
  if new.estimate_submitted_on is null then
    new.estimate_submitted_by := null;
  elsif v_estimate and auth.uid() is not null then
    new.estimate_submitted_by := auth.uid();
  end if;
  -- 件の中身（内容・種別・指示者・指示方法・金額見込み）を直せるのは、件の日報が下書きか差戻しのあいだだけ（管理者も同じ）。
  -- それ以外は issue_locked。協力会社は自分が作った日報の件だけ（issue_not_own）。状態・精算・見積提出の項目は今までどおり
  -- いつでも変えられる。auth.uid() が無い呼び出し（SQL Editor・service role）は対象外。2026-11-11（update_2026-11-11_site_judgment.sql）。
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

drop trigger if exists gn_report_issues_guard on public.gn_report_issues;
create trigger gn_report_issues_guard before insert or update on public.gn_report_issues
  for each row execute function public.gn_report_issues_guard();

commit;
