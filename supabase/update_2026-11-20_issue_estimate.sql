-- 2026-11-20：件の見積書（要［先に出す］・要［お客様の指示で先に対応・後出し］・不要）と、現場の「見積提出が必須のお客様」。
-- update_2026-11-19_unnamed_workers.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全（冪等）。
--
-- 足すもの：
--   1. gn_sites.estimate_required boolean not null default false（見積提出が必須のお客様）。
--      列の SELECT を authenticated に付ける（update_2026-11-16_site_money.sql で表の SELECT を外し、列ごとに付けているため。
--      付けないと誰も読めない）。お金の列ではないので協力会社も読めてよい。
--   2. gn_report_issues.estimate_requirement text not null default 'none'
--      （'before'＝要［先に出す］・'after'＝要［お客様の指示で先に対応・後出し］・'none'＝不要）。
--      check は列の定義に書かず、名前付きの制約 gn_report_issues_estimate_requirement_ck で付ける
--      （列に書くと自動の名前 gn_report_issues_estimate_requirement_check になり、付け直しのときに重なるため）。
--      既存の件：見積提出の記録がある件だけ 'before'、ほかは 'none'（今までどおり自由に進められる）。
--      埋めるのは列を初めて足したときだけ（2 回目以降は何もしない）。承認済みの日報・完了現場の件も対象なので、
--      件のガードと updated_at のトリガーを外して埋める（recalc_2026-11-03_labor.sql と同じやり方）。
--   3. gn_report_issues_guard の差し替え（update_2026-11-14_estimate_submitted.sql の定義をそのまま写し、次を足す）：
--      * 見積書の欄（estimate_requirement）を変える（update）のは社員か管理者だけ（not_employee）。
--        insert で協力会社（と profiles の行が無いユーザー）が作るときは、値を見ずに現場の設定と種別から決める
--        （必須の現場で種別がやり直し［rework］以外＝'before'、それ以外＝'none'）。社員・管理者が作るときは渡した値のまま。
--        状態・精算・見積提出と同じく、件の日報の状態（提出済み・承認済み）に関係なくいつでも変えられる（件の中身の鍵の対象外）。
--      * 要（先に出す）で見積提出の記録が無い件は、対応中・完了にできない（estimate_required_first）。
--        insert で対応中を渡されたときは見積中にする（古い版のアプリ・行から作る件のため）。完了を渡されたときは断る。
--        update は、状態・見積書の欄・見積提出の日のどれかが変わったときだけ確かめる（関係のない更新は止めない）。
--        見積提出の記録の取り消しで、要（先に出す）の対応中・完了の件が記録なしになるときも同じ理由で断る。
--      auth.uid() が無い呼び出し（SQL Editor・service role）は対象外（今までの確かめと同じ）。
--
-- 拒否の理由（足したもの）：estimate_required_first。
--
-- 実行の順番：この SQL を先に実行してから、新しい版のアプリを出す。
--   新しい版のアプリはこの SQL の前でも動く（列が無ければ、見積書の欄・現場の設定・赤い印を出さず、今までどおり）。
--   古い版のアプリはこの SQL の後でも動く（列を読まない。必須の現場で協力会社・行から作った件は見積中になり、
--   要［先に出す］の件の対応中・完了は DB が断る［古い版は「処理に失敗しました」と出る］）。

-- 1・2. 列（初めて足したときだけ既存の件を埋める） -----------------------------------------------
begin;

alter table public.gn_sites add column if not exists estimate_required boolean not null default false;
grant select (estimate_required) on public.gn_sites to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'gn_report_issues' and column_name = 'estimate_requirement'
  ) then
    alter table public.gn_report_issues add column estimate_requirement text not null default 'none';
    alter table public.gn_report_issues disable trigger gn_report_issues_guard;
    alter table public.gn_report_issues disable trigger gn_report_issues_touch;
    -- 足したばかりの列なので、文は実行のときに組み立てる（execute）
    execute 'update public.gn_report_issues set estimate_requirement = ''before'' where estimate_submitted_on is not null';
    alter table public.gn_report_issues enable trigger gn_report_issues_guard;
    alter table public.gn_report_issues enable trigger gn_report_issues_touch;
  end if;
end
$$;

alter table public.gn_report_issues drop constraint if exists gn_report_issues_estimate_requirement_ck;
alter table public.gn_report_issues add constraint gn_report_issues_estimate_requirement_ck
  check (estimate_requirement in ('before','after','none'));

-- 3. 件のガード ---------------------------------------------------------------------------
create or replace function public.gn_report_issues_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_site     uuid;
  v_status   text;
  v_creator  uuid;
  v_settles  boolean;
  v_estimate boolean;
  v_staff    boolean;
  v_required boolean;
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
  -- 件の見積書（要［先に出す］・要［後出し］・不要）。2026-11-20（update_2026-11-20_issue_estimate.sql）。
  -- 協力会社（と profiles の行が無いユーザー）が件を作るときは、渡した値を見ずに現場の設定と種別（やり直しは不要）から決める。変える（update）のは
  -- 社員か管理者だけ（not_employee）。件の日報の状態に関係なくいつでも変えられる。auth.uid() が無い呼び出しは対象外。
  if auth.uid() is not null then
    v_staff := exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and (p.account_type = 'employee' or public.is_admin())
    );
    -- （insert では old を参照しないよう、insert と update を分けて判定する）
    if tg_op = 'INSERT' then
      if not v_staff then
        select s.estimate_required into v_required from public.gn_sites s where s.id = v_site;
        new.estimate_requirement := case when coalesce(v_required, false) and new.kind is distinct from 'rework' then 'before' else 'none' end;
      end if;
    elsif not v_staff and new.estimate_requirement is distinct from old.estimate_requirement then
      raise exception using message = 'not_employee';
    end if;
    -- 要（先に出す）で見積提出の記録が無い件は、見積中のまま。insert の対応中は見積中にし、完了は断る。
    -- update は状態・見積書の欄・見積提出の日のどれかが変わったときだけ確かめる。
    if new.estimate_requirement = 'before' and new.estimate_submitted_on is null and new.status in ('open','done') then
      if tg_op = 'INSERT' then
        if new.status = 'open' then
          new.status := 'estimating';
          new.done_at := null;
        else
          raise exception using message = 'estimate_required_first';
        end if;
      elsif new.status is distinct from old.status
         or new.estimate_requirement is distinct from old.estimate_requirement
         or new.estimate_submitted_on is distinct from old.estimate_submitted_on then
        raise exception using message = 'estimate_required_first';
      end if;
    end if;
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
