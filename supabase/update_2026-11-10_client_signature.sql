-- 2026-11-10：お客様のサインと、サインした時点のお客様用日報 PDF。
-- update_2026-11-09_attachments.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- アプリは gn_daily_reports のサインの列を読み、gn_save_client_signature / gn_revoke_client_signature を呼ぶので、
-- アプリを新しい版にする前に実行する（先にアプリを出すと、日報の画面・お客様用 PDF・承認画面の読み込みがエラーになる）。
--
-- 1. gn_daily_reports にサインの列：
--      client_signature_path（gn-photos/<site_id>/sign/<uuid>.png）・client_signed_at（サインした日時＝客先確認の日時）・
--      client_signed_by（保存した操作者）・client_signed_pdf_path（gn-exports/<site_id>/signed/<report_id>-<ミリ秒>.pdf）・
--      client_signature_revoked_at / _by / _revoke_reason（最後の取り消し）・
--      client_signature_history（取り消したサインの記録の配列。PDF のパスも残す。消さない）。
-- 2. 書けるのは次の 2 つの関数だけ（gn_report_guard が印 gn.in_signature = '1' の無い変更を signature_locked で止める。
--    PostgREST からは set_config を呼べないので、利用者が印を立てることはできない）。
--      * gn_save_client_signature：現場メンバー（協力会社を含む）が、どの状態の日報でも・完了現場でも 1 回だけ。
--        確認者・日時・メモ（client_confirmed_*）も同時に入れて固定する。サイン画像と PDF は本人が先に Storage に置き、
--        関数がパスの規約・実体の有無・置いた人（本人か）を確かめる。
--      * gn_revoke_client_signature：管理者だけ。理由（1〜500 文字）必須。サインの列を空にし、取り消した記録を
--        client_signature_history に足す（PDF は消さない）。
-- 3. サインがある間は客先確認の 3 列（client_confirmed_*）を誰も変えられない（取り消しの後なら変えられる）。
--    承認解除・差戻し・日報の保存ではサインの列は変わらない。サインがある日報は消せない（report_signed）。
-- 4. Storage：gn-photos の <site_id>/sign/ と gn-exports の <site_id>/signed/ の実体は、置いた本人・管理者でも
--    上書き・削除できない（サインした時点の PDF を消さない）。gn-exports を読めるのは社員・管理者と、協力会社は
--    自分の現場の <site_id>/signed/ だけ（台帳の xlsm などの出力は協力会社には見せない）。gn-exports の上書き・削除の
--    「置いた本人か」を owner_id の列に合わせる（gn-photos・gn-estimates と同じ式）。
--
-- 既知の残り：サインの保存が途中で失敗・中断したとき（画像を置いた後、PDF を置いた後）の <site_id>/sign/・<site_id>/signed/ の
--   実体は残る（孤児）。上のポリシーで利用者は消せないので、掃除するときは管理者が Storage の管理画面（service role）で消す。
--   列にもサインの記録（client_signature_history）にも無いパスだけが孤児（画面には出ない・容量だけの問題）。
--
-- 拒否の理由（アプリが文言に変える。文字列を変えないこと）：
--   not_authenticated・report_not_found・stale_report・signature_exists（もうサインがある）・signature_missing（取り消すサインが無い）・
--   invalid_signature_input（確認者・メモ・日時が正しくない）・invalid_storage_path・storage_object_missing・
--   storage_object_not_owned・storage_object_too_large・not_admin・invalid_revoke_reason・signature_locked・report_signed。

begin;

-- ---------- 1. サインの列 ----------
alter table public.gn_daily_reports add column if not exists client_signature_path          text;
alter table public.gn_daily_reports add column if not exists client_signed_at               timestamptz;
alter table public.gn_daily_reports add column if not exists client_signed_by               uuid references public.profiles(id);
alter table public.gn_daily_reports add column if not exists client_signed_pdf_path         text;
alter table public.gn_daily_reports add column if not exists client_signature_revoked_at    timestamptz;
alter table public.gn_daily_reports add column if not exists client_signature_revoked_by    uuid references public.profiles(id);
alter table public.gn_daily_reports add column if not exists client_signature_revoke_reason text;
alter table public.gn_daily_reports add column if not exists client_signature_history       jsonb not null default '[]'::jsonb;

-- ---------- 2. 日報のガード（サインの列・サインがある間の客先確認） ----------
create or replace function public.gn_report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_reviewer boolean;
  v_closed   boolean;
begin
  v_reviewer := coalesce(public.gn_site_role(new.site_id), '') in ('reviewer','approver');
  v_closed   := public.gn_site_closed(new.site_id);

  if tg_op = 'INSERT' then
    if v_closed then
      raise exception using message = 'site_closed';
    end if;
    if new.status not in ('draft','submitted') and not v_reviewer then
      raise exception using message = 'not_reviewer';
    end if;
    if not v_reviewer and (
         new.reviewed_by is not null or new.approved_by is not null
         or new.approved_at is not null or new.rejected_reason is not null) then
      raise exception using message = 'not_reviewer';
    end if;
    if not public.is_admin() then
      new.created_by := auth.uid();
    end if;
    -- 合計は明細から計算する値。insert の時点では明細が無いので 0 にする（クライアントの値は使わない）
    new.output_total   := 0;
    new.cost_total     := 0;
    new.man_days_total := 0;
    -- サインは gn_save_client_signature でだけ入れる（insert では常に空）
    new.client_signature_path          := null;
    new.client_signed_at               := null;
    new.client_signed_by               := null;
    new.client_signed_pdf_path         := null;
    new.client_signature_revoked_at    := null;
    new.client_signature_revoked_by    := null;
    new.client_signature_revoke_reason := null;
    new.client_signature_history       := '[]'::jsonb;
    return new;
  end if;

  -- update
  -- サインの列は gn_save_client_signature / gn_revoke_client_signature の中（gn.in_signature = '1'）でだけ変えられる
  -- （管理者も同じ）。関数が変えるのはサインの列・客先確認の 3 列・updated_at だけ。状態・完了現場に関係なく通す
  -- （権限・状態の判定は関数がする）。2026-11-10（update_2026-11-10_client_signature.sql）。
  if (new.client_signature_path, new.client_signed_at, new.client_signed_by, new.client_signed_pdf_path,
      new.client_signature_revoked_at, new.client_signature_revoked_by, new.client_signature_revoke_reason,
      new.client_signature_history)
     is distinct from
     (old.client_signature_path, old.client_signed_at, old.client_signed_by, old.client_signed_pdf_path,
      old.client_signature_revoked_at, old.client_signature_revoked_by, old.client_signature_revoke_reason,
      old.client_signature_history) then
    if current_setting('gn.in_signature', true) is distinct from '1'
       or (to_jsonb(new) - 'client_signature_path' - 'client_signed_at' - 'client_signed_by' - 'client_signed_pdf_path'
                         - 'client_signature_revoked_at' - 'client_signature_revoked_by' - 'client_signature_revoke_reason'
                         - 'client_signature_history'
                         - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at')
          is distinct from
          (to_jsonb(old) - 'client_signature_path' - 'client_signed_at' - 'client_signed_by' - 'client_signed_pdf_path'
                         - 'client_signature_revoked_at' - 'client_signature_revoked_by' - 'client_signature_revoke_reason'
                         - 'client_signature_history'
                         - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at') then
      raise exception using message = 'signature_locked';
    end if;
    return new;
  end if;
  -- サインがある間は、客先確認の 3 列（確認者・日時・メモ）を誰も変えられない（管理者がサインを取り消した後なら変えられる）
  if old.client_signature_path is not null
     and (new.client_confirmed_by, new.client_confirmed_at, new.client_confirmed_note)
         is distinct from (old.client_confirmed_by, old.client_confirmed_at, old.client_confirmed_note) then
    raise exception using message = 'signature_locked';
  end if;
  -- 客先確認の3列だけの変更（updated_at は gn_daily_reports_touch が進める）は、承認済み・完了現場でも通す。
  -- 3列のどれかが実際に変わったときだけ（何も変えない更新はこの例外に入れない）
  if (to_jsonb(new) - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at')
     is not distinct from
     (to_jsonb(old) - 'client_confirmed_by' - 'client_confirmed_at' - 'client_confirmed_note' - 'updated_at')
     and (new.client_confirmed_by, new.client_confirmed_at, new.client_confirmed_note)
         is distinct from (old.client_confirmed_by, old.client_confirmed_at, old.client_confirmed_note) then
    return new;
  end if;
  -- 完了・削除済みの現場：承認／差戻し（状態と確認列だけの変更）以外は不可
  if v_closed then
    if new.status not in ('approved','rejected')
       or (to_jsonb(new) - 'status' - 'reviewed_by' - 'approved_by' - 'approved_at' - 'rejected_reason' - 'updated_at')
          is distinct from
          (to_jsonb(old) - 'status' - 'reviewed_by' - 'approved_by' - 'approved_at' - 'rejected_reason' - 'updated_at') then
      raise exception using message = 'site_closed';
    end if;
  end if;
  -- 合計3列は gn_save_report の中（gn.in_save = '1'）でだけ変更できる（管理者も同じ）
  if (new.output_total   is distinct from old.output_total
      or new.cost_total     is distinct from old.cost_total
      or new.man_days_total is distinct from old.man_days_total)
     and current_setting('gn.in_save', true) is distinct from '1' then
    raise exception using message = 'totals_locked';
  end if;
  -- 承認済みは管理者だけが変えられる。例外：その現場の確認者・承認者（gn_site_role が reviewer / approver）の
  -- 承認解除（approved → draft）。そのとき変えてよいのは status・approved_by・approved_at・reviewed_by・updated_at だけ
  -- （ほかの列が変わっていれば approved_report_locked）。2026-11-08（update_2026-11-08_issue_estimating_fix_request.sql）。
  if old.status = 'approved' and not public.is_admin() then
    if not (
         v_reviewer
         and new.status = 'draft'
         and (to_jsonb(new) - 'status' - 'approved_by' - 'approved_at' - 'reviewed_by' - 'updated_at')
             is not distinct from
             (to_jsonb(old) - 'status' - 'approved_by' - 'approved_at' - 'reviewed_by' - 'updated_at')
       ) then
      raise exception using message = 'approved_report_locked';
    end if;
  end if;
  if new.status is distinct from old.status and new.status in ('approved','rejected')
     and not v_reviewer then
    raise exception using message = 'not_reviewer';
  end if;
  if not v_reviewer and (
       new.reviewed_by     is distinct from old.reviewed_by
       or new.approved_by     is distinct from old.approved_by
       or new.approved_at     is distinct from old.approved_at
       or new.rejected_reason is distinct from old.rejected_reason) then
    raise exception using message = 'not_reviewer';
  end if;
  return new;
end;
$$;

drop trigger if exists gn_report_guard on public.gn_daily_reports;
create trigger gn_report_guard before insert or update on public.gn_daily_reports
  for each row execute function public.gn_report_guard();

-- 日報の削除も完了・削除済みの現場では不可。サインがある日報は誰も消せない（管理者が取り消した後なら消せる）
create or replace function public.gn_report_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.gn_site_closed(old.site_id) then
    raise exception using message = 'site_closed';
  end if;
  if old.client_signature_path is not null then
    raise exception using message = 'report_signed';
  end if;
  return old;
end;
$$;
drop trigger if exists gn_report_delete_guard on public.gn_daily_reports;
create trigger gn_report_delete_guard before delete on public.gn_daily_reports
  for each row execute function public.gn_report_delete_guard();

-- ---------- 3. サインを保存する・取り消す ----------
-- サインを保存する（現場メンバー。どの状態の日報でも・完了現場でも。1 回だけ）。
--   p_signed_at：サインした日時（＝客先確認の日時。PDF に出した時刻と同じにするためアプリが送る）。今から 10 分前〜1 分後の範囲だけ。
--   p_signature_path：gn-photos/<site_id>/sign/<uuid>.png（本人が置いた実体。2MB まで）
--   p_pdf_path：gn-exports/<site_id>/signed/<report_id>-<数字>.pdf（本人が置いた実体）
--   p_expected_updated_at：画面の版（null なら比べない）。違えば stale_report。
-- 戻り値は保存後の updated_at（画面の楽観ロック用）。
create or replace function public.gn_save_client_signature(
  p_report_id uuid,
  p_confirmed_by text,
  p_note text,
  p_signed_at timestamptz,
  p_signature_path text,
  p_pdf_path text,
  p_expected_updated_at timestamptz default null
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_site    uuid;
  v_updated timestamptz;
  v_path    text;
  v_history jsonb;
  v_by      text := btrim(coalesce(p_confirmed_by, ''));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_at      timestamptz := coalesce(p_signed_at, now());
  v_obj     jsonb;
  v_size    bigint;
  v_uuid_re constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if v_uid is null then
    raise exception using message = 'not_authenticated';
  end if;
  select r.site_id, r.updated_at, r.client_signature_path, r.client_signature_history
    into v_site, v_updated, v_path, v_history
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
  return v_updated;
end;
$$;
revoke all on function public.gn_save_client_signature(uuid, text, text, timestamptz, text, text, timestamptz) from public, anon;
grant execute on function public.gn_save_client_signature(uuid, text, text, timestamptz, text, text, timestamptz) to authenticated;

-- サインを取り消す（管理者だけ。理由 1〜500 文字）。サインの列を空にし、取り消した記録（画像・PDF のパス、サインした日時・
-- 保存した人・確認者・日時・メモ、取り消した日時・人・理由）を client_signature_history に足す。客先確認の 3 列は残す
-- （取り消した後は記録し直し・取り消しができる）。PDF・画像の実体は消さない。
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
           'revoked_at',   now(),
           'revoked_by',   v_uid,
           'reason',       v_reason))
   where id = p_report_id
   returning updated_at into v_updated;
  perform set_config('gn.in_signature', '', true);
  return v_updated;
end;
$$;
revoke all on function public.gn_revoke_client_signature(uuid, text, timestamptz) from public, anon;
grant execute on function public.gn_revoke_client_signature(uuid, text, timestamptz) to authenticated;

-- ---------- 4. Storage：サインの画像・サインした時点の PDF を消させない、協力会社は台帳の出力を読めない ----------
-- gn-exports を読めるのは、社員・管理者（台帳の xlsm など、その現場の出力すべて）と、協力会社は自分の現場の
-- <site_id>/signed/（サインした時点の PDF）だけ（2026-11-10）。台帳の出力（金額）は協力会社には見せない。
drop policy if exists gn_exports_read on storage.objects;
create policy gn_exports_read on storage.objects for select to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and (public.gn_is_employee_or_admin() or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/signed/'));
-- gn-photos の <site_id>/sign/ と gn-exports の <site_id>/signed/ は、置いた本人・管理者でも上書き・削除できず、
-- ほかの名前から動かして来ることもできない（2026-11-10）。gn-exports の上書き・削除の「置いた本人か」は、gn-photos・
-- gn-estimates と同じく owner_id の列があれば owner_id（空なら owner）で比べる。
do $do$
declare
  v_owner text;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'
  ) then
    v_owner := '(coalesce(nullif(owner_id::text, ''''), owner::text) = auth.uid()::text or public.is_admin())';
  else
    v_owner := '(owner = auth.uid() or public.is_admin())';
  end if;

  execute 'drop policy if exists gn_photos_update on storage.objects';
  execute format($p$create policy gn_photos_update on storage.objects for update to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/sign/') with check (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and (public.is_admin() or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/att/'))$p$, v_owner);
  execute 'drop policy if exists gn_photos_delete on storage.objects';
  execute format($p$create policy gn_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/sign/')$p$, v_owner);
  execute 'drop policy if exists gn_exports_update on storage.objects';
  execute format($p$create policy gn_exports_update on storage.objects for update to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/signed/') with check (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/signed/')$p$, v_owner);
  execute 'drop policy if exists gn_exports_delete on storage.objects';
  execute format($p$create policy gn_exports_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-exports' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/signed/')$p$, v_owner);
end
$do$;

commit;
