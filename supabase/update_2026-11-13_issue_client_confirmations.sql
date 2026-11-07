-- 2026-11-13：件ごとのお客様確認（サインを保存したとき、お客様に確認していただいた件を記録する）。
-- update_2026-11-12_issue_report_fixed.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- アプリは gn_save_client_signature を p_issue_ids 付きで呼び、gn_issue_client_confirmations を読むので、
-- アプリを新しい版にする前に実行する（先にアプリを出すと、サインの保存・お客様用 PDF・件の印の読み込みがエラーになる）。
--
-- 1. 表 gn_issue_client_confirmations：件ごとのお客様確認（件・日報・現場・確認した日［日報の日付］・確認者・サインした日時・
--    入れた人・取り消した日時・人）。(issue_id, report_id) は 1 行。件・日報を消すと一緒に消える（サインのある日報は消せない）。
--    RLS：現場メンバー（協力会社を含む）が読める。insert・update・delete のポリシーは作らない（書くのは下の 2 つの関数だけ）。
-- 2. gn_save_client_signature に p_issue_ids uuid[] default '{}' を足す（古い 7 引数の版は消してから作る。引数の数が違う
--    同じ名前の関数が 2 つあると、引数 6 つの呼び出しがあいまいになるため）。今までの確かめはすべてそのまま。足した確かめ：
--    件は重複を除いて 50 件まで、どれもその日報の現場の件で、やり直し（rework）でないこと（違えば invalid_issue）。
--    サインの列を入れるのと同じ処理の中で件ごとに確認の行を入れる（サインが保存できなければ行も入らない）。
--    同じ日報で取り消した後にサインを取り直し、同じ件をまた選んだときは、取り消した行を新しい確認で上書きする。
-- 3. gn_revoke_client_signature：その日報の確認の行（取り消していないもの）に revoked_at・revoked_by を入れる（消さない）。
--    取り消した記録（client_signature_history）に、そのサインで確認していただいた件の id（issue_ids）も残す。
-- 4. gn_report_issues_delete_guard：お客様の確認を受けた件（取り消されていない確認がある件）は消せない（issue_confirmed）。
--    今までの確かめはすべてそのまま（関数を作り直し、トリガーも付け直す）。
--
-- 5. 表 gn_report_signature_issue_sets：いまのサインで確認していただいた件の一覧（日報ごとに 1 行。空でも入る）。
--    gn_save_client_signature が入れ、gn_revoke_client_signature が消す。行が無いのにサインがある日報は、この SQL より前に
--    もらったサイン（アプリはその日報の件を「確認していただく件」に載せる）。RLS：その日報の現場メンバーが読める。
-- 6. gn_report_delete_guard：日報の件が（ほかの日報のサインで）お客様の確認を受けている（取り消されていない）なら、
--    その日報は消せない（report_has_confirmed_issue。消すと件と一緒に確認の記録も消えるため）。今までの確かめはそのまま。
--
-- 拒否の理由（足したもの）：invalid_issue、issue_confirmed、report_has_confirmed_issue。

begin;

-- 件ごとのお客様確認（2026-11-13。update_2026-11-13_issue_client_confirmations.sql）。
-- サインを保存したとき、お客様に確認していただいた件ごとに 1 行（その日報の日付・確認者・サインした日時）。
-- 書くのは gn_save_client_signature（行を入れる）と gn_revoke_client_signature（revoked_at・revoked_by を入れる。消さない）だけ
-- （insert・update・delete のポリシーを作らない）。現場メンバー（協力会社を含む）が読める。
-- 件の印「お客様の確認：確認済み MM/DD」は、取り消されていない行のうち confirmed_on が最新のもの。
-- 同じ日報で取り消した後にサインを取り直し、同じ件をまた選んだときは、取り消した行を新しい確認で上書きする
-- （(issue_id, report_id) は 1 行。取り消した時点の件の一覧は gn_daily_reports.client_signature_history の issue_ids に残る）。
create table if not exists public.gn_issue_client_confirmations (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references public.gn_report_issues(id) on delete cascade,
  report_id    uuid not null references public.gn_daily_reports(id) on delete cascade,
  site_id      uuid not null references public.gn_sites(id),
  confirmed_on date not null,
  confirmed_by text not null,
  signed_at    timestamptz not null,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles(id),
  -- 名前は自動の <表>_<列>_check・<表>_<列>_key と重ならないものにする
  constraint gn_issue_client_confirmations_issue_report_uniq unique (issue_id, report_id),
  constraint gn_issue_client_confirmations_revoked_pair check ((revoked_at is null) = (revoked_by is null))
);
create index if not exists gn_issue_client_confirmations_report_idx on public.gn_issue_client_confirmations (report_id);
create index if not exists gn_issue_client_confirmations_site_idx on public.gn_issue_client_confirmations (site_id);

alter table public.gn_issue_client_confirmations enable row level security;
drop policy if exists gn_issue_client_confirmations_select on public.gn_issue_client_confirmations;
create policy gn_issue_client_confirmations_select on public.gn_issue_client_confirmations
  for select to authenticated using (public.gn_is_site_member(site_id));

-- サインで確認していただいた件の一覧（2026-11-13）。いまのサイン 1 つにつき 1 行（件を 1 つも選ばなかったときも空の配列で入る）。
-- 行が無いのにサインがある日報は、件ごとの確認を記録する前（第 4 段階より前）にもらったサイン。
-- 書くのは gn_save_client_signature（入れる・取り直しで上書き）と gn_revoke_client_signature（消す。取り消したサインの件は
-- client_signature_history の issue_ids に残る）だけ（insert・update・delete のポリシーを作らない）。その日報の現場メンバーが読める。
-- 制約は主キーと外部キーだけ（名前は自動の <表>_pkey・<表>_report_id_fkey）。
create table if not exists public.gn_report_signature_issue_sets (
  report_id uuid primary key references public.gn_daily_reports(id) on delete cascade,
  issue_ids uuid[] not null,
  signed_at timestamptz not null
);
alter table public.gn_report_signature_issue_sets enable row level security;
drop policy if exists gn_report_signature_issue_sets_select on public.gn_report_signature_issue_sets;
create policy gn_report_signature_issue_sets_select on public.gn_report_signature_issue_sets
  for select to authenticated using (
    exists (select 1 from public.gn_daily_reports r where r.id = report_id and public.gn_is_site_member(r.site_id))
  );

-- サインを保存する（現場メンバー。どの状態の日報でも・完了現場でも。1 回だけ）。
--   p_signed_at：サインした日時（＝客先確認の日時。PDF に出した時刻と同じにするためアプリが送る）。今から 10 分前〜1 分後の範囲だけ。
--   p_signature_path：gn-photos/<site_id>/sign/<uuid>.png（本人が置いた実体。2MB まで）
--   p_pdf_path：gn-exports/<site_id>/signed/<report_id>-<数字>.pdf（本人が置いた実体）
--   p_expected_updated_at：画面の版（null なら比べない）。違えば stale_report。
--   p_issue_ids：お客様に確認していただいた件（2026-11-13）。重複は除き 50 件まで。どれもその日報の現場の件で、
--     やり直し（rework）でないこと（違えば・null を含めば invalid_issue）。件ごとに gn_issue_client_confirmations の行を入れる
--     （サインの列と同じ処理の中。サインが保存できなければ行も入らない）。
-- 戻り値は保存後の updated_at（画面の楽観ロック用）。
-- 2026-11-13：p_issue_ids を足したので、古い 7 引数の版を消してから作る（両方あると引数 6 つの呼び出しがあいまいになる）。
drop function if exists public.gn_save_client_signature(uuid, text, text, timestamptz, text, text, timestamptz);
create or replace function public.gn_save_client_signature(
  p_report_id uuid,
  p_confirmed_by text,
  p_note text,
  p_signed_at timestamptz,
  p_signature_path text,
  p_pdf_path text,
  p_expected_updated_at timestamptz default null,
  p_issue_ids uuid[] default '{}'
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_site    uuid;
  v_date    date;
  v_updated timestamptz;
  v_path    text;
  v_history jsonb;
  v_by      text := btrim(coalesce(p_confirmed_by, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_at      timestamptz := coalesce(p_signed_at, now());
  v_obj     jsonb;
  v_size    bigint;
  v_issues  uuid[];
  v_found   int;
  v_uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if v_uid is null then
    raise exception using message = 'not_authenticated';
  end if;
  select r.site_id, r.report_date, r.updated_at, r.client_signature_path, r.client_signature_history
    into v_site, v_date, v_updated, v_path, v_history
    from public.gn_daily_reports r where r.id = p_report_id
     for update;
  if v_site is null or not public.gn_is_site_member(v_site) then
    raise exception using message = 'report_not_found';
  end if;
  if p_expected_updated_at is not null and v_updated is distinct from p_expected_updated_at then
    raise exception using message = 'stale_report';
  end if;
  if v_path is not null then
    raise exception using message = 'signature_exists';
  end if;
  if char_length(v_by) not between 1 and 100
     or (v_note is not null and char_length(v_note) > 500)
     or v_at < now() - interval '10 minutes' or v_at > now() + interval '1 minute' then
    raise exception using message = 'invalid_signature_input';
  end if;

  -- 確認していただく件：重複を除いて 50 件まで。どれもその日報の現場の件で、やり直しでないこと
  if exists (select 1 from unnest(coalesce(p_issue_ids, '{}'::uuid[])) as t(id) where t.id is null) then
    raise exception using message = 'invalid_issue';
  end if;
  select coalesce(array_agg(distinct t.id), '{}'::uuid[]) into v_issues
    from unnest(coalesce(p_issue_ids, '{}'::uuid[])) as t(id);
  if cardinality(v_issues) > 50 then
    raise exception using message = 'invalid_issue';
  end if;
  if cardinality(v_issues) > 0 then
    select count(*) into v_found
      from public.gn_report_issues i
      join public.gn_daily_reports ir on ir.id = i.report_id
     where i.id = any(v_issues) and i.site_id = v_site and ir.site_id = v_site and i.kind <> 'rework';
    if v_found <> cardinality(v_issues) then
      raise exception using message = 'invalid_issue';
    end if;
  end if;

  -- パスの規約（その日報の現場の下）。取り消したサインの画像・PDF をもう一度使うことはできない
  if p_signature_path is null
     or p_signature_path !~ ('^' || v_site::text || '/sign/' || v_uuid_re || '\.png$')
     or p_pdf_path is null
     or p_pdf_path !~ ('^' || v_site::text || '/signed/' || p_report_id::text || '-[0-9]{1,20}\.pdf$')
     or exists (
       select 1 from jsonb_array_elements(coalesce(v_history, '[]'::jsonb)) e
        where e->>'path' = p_signature_path or e->>'pdf_path' = p_pdf_path
     ) then
    raise exception using message = 'invalid_storage_path';
  end if;

  -- サインの画像：本人が置いた実体で、2MB まで（列の有無に頼らないよう jsonb で読む。owner_id か owner）
  select to_jsonb(o) into v_obj from storage.objects o
   where o.bucket_id = 'gn-photos' and o.name = p_signature_path;
  if v_obj is null then
    raise exception using message = 'storage_object_missing';
  end if;
  if coalesce(nullif(v_obj->>'owner_id', ''), v_obj->>'owner') is distinct from v_uid::text then
    raise exception using message = 'storage_object_not_owned';
  end if;
  v_size := coalesce((v_obj->'metadata'->>'size')::bigint, 0);
  if v_size > 2097152 then
    raise exception using message = 'storage_object_too_large';
  end if;

  -- サインした時点の PDF：本人が置いた実体
  v_obj := null;
  select to_jsonb(o) into v_obj from storage.objects o
   where o.bucket_id = 'gn-exports' and o.name = p_pdf_path;
  if v_obj is null then
    raise exception using message = 'storage_object_missing';
  end if;
  if coalesce(nullif(v_obj->>'owner_id', ''), v_obj->>'owner') is distinct from v_uid::text then
    raise exception using message = 'storage_object_not_owned';
  end if;

  perform set_config('gn.in_signature', '1', true);
  update public.gn_daily_reports
     set client_signature_path  = p_signature_path,
         client_signed_at       = v_at,
         client_signed_by       = v_uid,
         client_signed_pdf_path = p_pdf_path,
         client_confirmed_by    = v_by,
         client_confirmed_at    = v_at,
         client_confirmed_note  = v_note
   where id = p_report_id
   returning updated_at into v_updated;
  perform set_config('gn.in_signature', '', true);

  -- 件ごとのお客様確認。この日報にいまのサインは無い（signature_exists で止めた）ので、同じ件・日報の行があれば
  -- 取り消した行だけ。それを新しい確認で上書きする（取り消していない行は変えない）。
  insert into public.gn_issue_client_confirmations as c
         (issue_id, report_id, site_id, confirmed_on, confirmed_by, signed_at, created_by)
  select t.id, p_report_id, v_site, v_date, v_by, v_at, v_uid
    from unnest(v_issues) as t(id)
  on conflict (issue_id, report_id) do update
     set site_id      = excluded.site_id,
         confirmed_on = excluded.confirmed_on,
         confirmed_by = excluded.confirmed_by,
         signed_at    = excluded.signed_at,
         created_by   = excluded.created_by,
         created_at   = now(),
         revoked_at   = null,
         revoked_by   = null
   where c.revoked_at is not null;

  -- このサインで確認していただいた件の一覧（空でも入れる。行があること＝第 4 段階の後のサイン）
  insert into public.gn_report_signature_issue_sets (report_id, issue_ids, signed_at)
  values (p_report_id, v_issues, v_at)
  on conflict (report_id) do update set issue_ids = excluded.issue_ids, signed_at = excluded.signed_at;
  return v_updated;
end;
$$;
revoke all on function public.gn_save_client_signature(uuid, text, text, timestamptz, text, text, timestamptz, uuid[]) from public, anon;
grant execute on function public.gn_save_client_signature(uuid, text, text, timestamptz, text, text, timestamptz, uuid[]) to authenticated;

-- サインを取り消す（管理者だけ。理由 1〜500 文字）。サインの列を空にし、取り消した記録（画像・PDF のパス、サインした日時・
-- 保存した人・確認者・日時・メモ、確認していただいた件［issue_ids。2026-11-13］、取り消した日時・人・理由）を
-- client_signature_history に足す。客先確認の 3 列は残す（取り消した後は記録し直し・取り消しができる）。PDF・画像の実体は消さない。
-- そのサインでの件ごとのお客様確認（gn_issue_client_confirmations）は消さずに revoked_at・revoked_by を入れる（2026-11-13）。
create or replace function public.gn_revoke_client_signature(
  p_report_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz default null
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_reason  text := btrim(coalesce(p_reason, ''));
  r         public.gn_daily_reports;
  v_updated timestamptz;
  v_issues  jsonb;
begin
  if v_uid is null then
    raise exception using message = 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception using message = 'not_admin';
  end if;
  if char_length(v_reason) not between 1 and 500 then
    raise exception using message = 'invalid_revoke_reason';
  end if;
  select * into r from public.gn_daily_reports where id = p_report_id for update;
  if not found then
    raise exception using message = 'report_not_found';
  end if;
  if p_expected_updated_at is not null and r.updated_at is distinct from p_expected_updated_at then
    raise exception using message = 'stale_report';
  end if;
  if r.client_signature_path is null then
    raise exception using message = 'signature_missing';
  end if;

  select coalesce(jsonb_agg(c.issue_id order by c.issue_id), '[]'::jsonb) into v_issues
    from public.gn_issue_client_confirmations c
   where c.report_id = p_report_id and c.revoked_at is null;

  perform set_config('gn.in_signature', '1', true);
  update public.gn_daily_reports
     set client_signature_path          = null,
         client_signed_at               = null,
         client_signed_by               = null,
         client_signed_pdf_path         = null,
         client_signature_revoked_at    = now(),
         client_signature_revoked_by    = v_uid,
         client_signature_revoke_reason = v_reason,
         client_signature_history       = coalesce(r.client_signature_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'path',         r.client_signature_path,
           'pdf_path',     r.client_signed_pdf_path,
           'signed_at',    r.client_signed_at,
           'signed_by',    r.client_signed_by,
           'confirmed_by', r.client_confirmed_by,
           'confirmed_at', r.client_confirmed_at,
           'note',         r.client_confirmed_note,
           'issue_ids',    v_issues,
           'revoked_at',   now(),
           'revoked_by',   v_uid,
           'reason',       v_reason))
   where id = p_report_id
   returning updated_at into v_updated;
  perform set_config('gn.in_signature', '', true);

  update public.gn_issue_client_confirmations
     set revoked_at = now(), revoked_by = v_uid
   where report_id = p_report_id and revoked_at is null;
  -- いまのサインの件の一覧は消す（取り消したサインの件は client_signature_history の issue_ids に残している）
  delete from public.gn_report_signature_issue_sets where report_id = p_report_id;
  return v_updated;
end;
$$;
revoke all on function public.gn_revoke_client_signature(uuid, text, timestamptz) from public, anon;
grant execute on function public.gn_revoke_client_signature(uuid, text, timestamptz) to authenticated;

-- 件の削除（2026-11-11）。件の日報が下書きか差戻しのあいだだけ消せる（管理者も同じ。issue_locked）。協力会社は自分が作った
-- 日報の件だけ（issue_not_own）。作業内容の行が根拠の件にしている件（issue_in_use）と、写真・資料が付いている件
-- （issue_has_attachments。協力会社に見えないファイルも数える）と、お客様の確認を受けた件（取り消されていない確認がある件。
-- issue_confirmed。2026-11-13）は消せない。security definer：行・添付の有無を RLS に関係なく見る。
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
  -- お客様の確認を受けた件（取り消されていない確認がある件）は消せない（2026-11-13）
  if exists (select 1 from public.gn_issue_client_confirmations c where c.issue_id = old.id and c.revoked_at is null) then
    raise exception using message = 'issue_confirmed';
  end if;
  return old;
end;
$$;

drop trigger if exists gn_report_issues_delete_guard on public.gn_report_issues;
create trigger gn_report_issues_delete_guard before delete on public.gn_report_issues
  for each row execute function public.gn_report_issues_delete_guard();


-- 日報の削除も完了・削除済みの現場では不可。サインがある日報は誰も消せない（管理者が取り消した後なら消せる。2026-11-10）
-- 件がお客様の確認を受けている（取り消されていない確認がある）日報も消せない（report_has_confirmed_issue。2026-11-13）
create or replace function public.gn_report_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.gn_site_closed(old.site_id) then
    raise exception using message = 'site_closed';
  end if;
  if old.client_signature_path is not null then
    raise exception using message = 'report_signed';
  end if;
  -- この日報の件が、ほかの日報のサインでお客様の確認を受けている（取り消されていない）なら消せない（2026-11-13）。
  -- 消すと件と一緒に確認の記録も消えてしまうため。そのサインを管理者が取り消した後なら消せる。
  if exists (
    select 1 from public.gn_issue_client_confirmations c
      join public.gn_report_issues i on i.id = c.issue_id
     where i.report_id = old.id and c.revoked_at is null
  ) then
    raise exception using message = 'report_has_confirmed_issue';
  end if;
  return old;
end;
$$;
drop trigger if exists gn_report_delete_guard on public.gn_daily_reports;
create trigger gn_report_delete_guard before delete on public.gn_daily_reports
  for each row execute function public.gn_report_delete_guard();

commit;
