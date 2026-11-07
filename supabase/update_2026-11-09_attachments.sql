-- 2026-11-09：日報・件の添付（写真・ファイル・リンク）。
-- update_2026-11-08_issue_estimating_fix_request.sql の後に 1 回実行する（schema_genba.sql には反映済み）。何度実行しても安全。
-- アプリは gn_attachments を読み書きするので、アプリを新しい版にする前に実行する
-- （先にアプリを出すと、日報・件の画面で添付の読み込みがエラーになる）。
--
-- 1. Storage の gn-estimates（見積書などのファイル）の読み書きを社員・管理者だけにする（gn_is_employee_or_admin()）。
--    いままでは現場メンバー全員（協力会社を含む）が読めた。協力会社は見積書（金額）を見られない・置けない。
-- 2. 添付の台帳 gn_attachments（check・索引）と、ガードのトリガー gn_attachments_guard、RLS。
--    日報の添付は日報が下書き・差戻しのときだけ足す・消す（提出後は修正申請）。件の添付は件が完了するまで。
--    完了・削除済みの現場は不可。ファイルの行は社員・管理者だけ読める・付けられる。
--    更新は「お客様用に載せる」（client_visible）だけ：社員・管理者と付けた本人。
-- 3. gn-photos・gn-estimates のバケットを 1 つ 10MB までにし、置ける種類（allowed_mime_types）を絞る。
-- 0. gn-photos に管理者以外が置ける場所を <site_id>/att/（写真）と <site_id>/sign/（サイン。<ランダムな uuid>.png）に絞る。
-- 既知の残り：行を作る前に失敗・中断したとき、日報・件を消したときの Storage の実体は残る（孤児。掃除は今後の課題）。
--
-- Storage の実体の置き方（アプリ）：サーバーが添付の id とパス（<site_id>/att/<id>.jpg など）を決め、ブラウザが
-- 自分のログインで Storage に直接置き（上の Storage のポリシーが効く）、サーバーが行を作る。行を作るときにガードが
-- 実体の有無・大きさ・置いた人（本人か）を storage.objects で確かめる。

begin;

-- ---------- 0. gn-photos に置ける場所（写真は att、サインは sign） ----------
-- gn-photos に置ける場所（2026-11-09。update_2026-11-09_attachments.sql）：管理者以外は次の 2 つだけ。
--   * <site_id>/att/<添付の id>.jpg：日報・件の写真（台帳 gn_attachments の行を作るときにガードが本人の実体か確かめる）
--   * <site_id>/sign/<ランダムな uuid>.png：お客様のサイン（画面かサーバーが uuid を作る。記録するときに
--     本人が置いた実体があるかを確かめる＝Task 5）
-- それ以外の場所（<site_id>/other/... など）には置けない・名前を変えて動かせない。
drop policy if exists gn_photos_insert on storage.objects;
create policy gn_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and (public.is_admin() or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(att|sign)/'));

-- ---------- 1. gn-estimates を社員・管理者だけに ----------
drop policy if exists gn_estimates_read on storage.objects;
create policy gn_estimates_read on storage.objects for select to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and public.gn_is_employee_or_admin());
drop policy if exists gn_estimates_insert on storage.objects;
create policy gn_estimates_insert on storage.objects for insert to authenticated with check (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and public.gn_is_employee_or_admin());
-- 置いた本人か（2026-11-09。update_2026-11-09_attachments.sql）：いまの Storage は置いた人を owner_id（text）に入れ、
-- owner（uuid）は古い版の列。どちらの版でも動くよう、owner_id の列があれば owner_id（空なら owner）で比べる。
-- gn-photos・gn-estimates の上書き（update）・削除（delete）は、置いた本人か管理者だけ。
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
  execute format($p$create policy gn_photos_update on storage.objects for update to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s) with check (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s and (public.is_admin() or name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(att|sign)/'))$p$, v_owner);
  execute 'drop policy if exists gn_photos_delete on storage.objects';
  execute format($p$create policy gn_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-photos' and public.gn_is_site_member(public.gn_storage_site(name)) and %1$s)$p$, v_owner);
  execute 'drop policy if exists gn_estimates_update on storage.objects';
  execute format($p$create policy gn_estimates_update on storage.objects for update to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and public.gn_is_employee_or_admin() and %1$s) with check (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and public.gn_is_employee_or_admin() and %1$s)$p$, v_owner);
  execute 'drop policy if exists gn_estimates_delete on storage.objects';
  execute format($p$create policy gn_estimates_delete on storage.objects for delete to authenticated using (bucket_id = 'gn-estimates' and public.gn_is_site_member(public.gn_storage_site(name)) and public.gn_is_employee_or_admin() and %1$s)$p$, v_owner);
end
$do$;

-- ---------- 2・3. 添付の台帳・ガード・RLS・バケットの上限 ----------
-- 添付の台帳。日報（report_id）か件（issue_id）のどちらか一方に付ける。
--   * kind：'photo'（写真。gn-photos/<site_id>/att/<id>.jpg。画面で縮めた JPEG）・'file'（見積書などのファイル。
--     gn-estimates/<site_id>/att/<id>.<拡張子>。社員・管理者だけ）・'link'（G ドライブなどの URL。http/https だけ）。
--   * 写真・ファイルの実体は、ブラウザが自分のログインで Storage に直接置く（Storage のポリシーが効く）。
--     そのあとで行を作る。行を作るときにガードが、パスが規約どおりか・実体があるか・10MB 以下かを確かめる。
--   * client_visible：お客様用 PDF に載せるか。写真だけ true にできる（ファイル・リンクは常に false）。
--   * attached_on：付けた日。日報の添付はその日報の日付（ガードが入れ直す）。件の添付は、付けたときに開いていた
--     日報の画面の日付（アプリが送る。件の日報の日付〜今日の範囲外・空なら日本時間の今日）。お客様用日報 PDF に「その日に件へ付けた写真」を載せるのに使う。
--   * created_by・created_by_name（その時点の名前の写し）・created_at・site_id はガードが入れる（クライアントの値は使わない）。
--     名前を写すのは、管理者以外は他人の profiles を読めないため（画面に付けた人を出す）。
--   * 日報・件を消すと一緒に消える（on delete cascade）。既知の残り：そのときと、行を作る前に失敗・中断したときの
--     Storage の実体は消えずに残る（孤児。容量だけの問題で、行が無いので画面には出ない。掃除は今後の課題）。
create table if not exists public.gn_attachments (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.gn_sites(id),
  report_id       uuid references public.gn_daily_reports(id) on delete cascade,
  issue_id        uuid references public.gn_report_issues(id) on delete cascade,
  kind            text not null check (kind in ('photo','file','link')),
  storage_bucket  text,
  storage_path    text,
  url             text,
  name            text not null check (char_length(btrim(name)) between 1 and 100),
  caption         text not null default '' check (char_length(caption) <= 200),
  mime            text check (mime is null or char_length(mime) <= 200),
  size_bytes      int check (size_bytes is null or size_bytes between 1 and 10485760),
  client_visible  boolean not null default false,
  attached_on     date not null,
  created_by      uuid references public.profiles(id),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  sort_order      int not null default 0,
  constraint gn_attachments_target_check check ((report_id is null) <> (issue_id is null)),
  constraint gn_attachments_kind_check check (
    (kind = 'photo' and storage_bucket = 'gn-photos'    and storage_path is not null and url is null)
    or (kind = 'file' and storage_bucket = 'gn-estimates' and storage_path is not null and url is null)
    or (kind = 'link' and storage_bucket is null and storage_path is null
        and url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 2000)
  ),
  constraint gn_attachments_client_visible_check check (kind = 'photo' or client_visible = false)
);
create index if not exists gn_attachments_report_idx on public.gn_attachments (report_id) where report_id is not null;
create index if not exists gn_attachments_issue_idx  on public.gn_attachments (issue_id)  where issue_id is not null;
create index if not exists gn_attachments_site_day_idx on public.gn_attachments (site_id, attached_on);

-- 添付のガード（insert / update / delete）。security definer：日報・件・Storage の実体を権限に関係なく読み、
-- 現場メンバーかどうかは gn_is_site_member で明示的に確かめる。RLS のポリシーも別に効く。
-- auth.uid() が無い呼び出し（SQL Editor・service role。RLS の外）は、権限と日報・件の状態の判定を飛ばす
-- （site_id・付けた日・パスの規約はそろえる）。
-- 拒否の理由（アプリが文言に変える。文字列を変えないこと）：
--   report_not_found / issue_not_found（無い・見られない）・site_closed（完了・削除済みの現場）・
--   report_locked（日報が下書き・差戻し以外＝提出済み・承認済み）・issue_done（件が完了）・
--   file_not_allowed（協力会社がファイルを付けた）・invalid_storage_path（パスが規約と違う）・
--   storage_object_missing（実体が無い）・storage_object_too_large（実体が 10MB を超える）・
--   storage_object_not_owned（実体を置いたのが本人でない）・attachment_exists（同じ id の行がもうある＝二度押し）・
--   attachment_readonly（client_visible 以外を変えた）・not_allowed_to_update（社員・管理者・付けた本人以外が切り替えた）・
--   not_attachment_owner（付けた本人・管理者以外が消した）。
-- 消すとき：付けた本人か管理者。日報の添付は日報が下書き・差戻しのとき、件の添付は件が完了でないとき、完了現場は不可（管理者も同じ）。
-- 日報・件を消したときの連鎖削除（on delete cascade）は、親（日報・件）がもう無いので通す（親の削除の権限で決まっている）。
-- 件の添付の付けた日は、件の日報の日付〜日本時間の今日の範囲にする（範囲外・空なら今日にそろえる。エラーにはしない）。
-- 実体の mime は storage.objects の metadata->>'mimetype' があればそれを使う。
-- お客様用に載せるか（client_visible）の切り替えは、日報・件の状態や現場の完了に関係なく通す（お客様に出すときに選ぶため。
-- 客先確認と同じ扱い）。
create or replace function public.gn_attachments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row     public.gn_attachments;
  v_site    uuid;
  v_rstatus text;
  v_rdate   date;
  v_istatus text;
  v_idate   date;
  v_today   date := (now() at time zone 'Asia/Tokyo')::date;
  v_obj     jsonb;
  v_size    bigint;
  v_uid     uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    -- 変えてよいのは client_visible だけ
    v_row := new;
    v_row.client_visible := old.client_visible;
    if v_row is distinct from old then
      raise exception using message = 'attachment_readonly';
    end if;
    if v_uid is not null and not (public.gn_is_employee_or_admin() or old.created_by = v_uid) then
      raise exception using message = 'not_allowed_to_update';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_uid is null then
      return old;
    end if;
    -- 親（日報・件）がもう無い＝親を消したときの連鎖削除。親の削除の権限で決まっているので通す
    if old.report_id is not null then
      select r.status into v_rstatus from public.gn_daily_reports r where r.id = old.report_id;
    else
      select i.status into v_istatus from public.gn_report_issues i where i.id = old.issue_id;
    end if;
    if not found then
      return old;
    end if;
    if not (old.created_by = v_uid or public.is_admin()) then
      raise exception using message = 'not_attachment_owner';
    end if;
    if public.gn_site_closed(old.site_id) then
      raise exception using message = 'site_closed';
    end if;
    if old.report_id is not null and v_rstatus not in ('draft','rejected') then
      raise exception using message = 'report_locked';
    end if;
    if old.issue_id is not null and v_istatus = 'done' then
      raise exception using message = 'issue_done';
    end if;
    return old;
  end if;

  -- INSERT
  -- 同じ id の行がもうある（二度押し・再送）。アプリはこのとき実体を消さない
  if exists (select 1 from public.gn_attachments a where a.id = new.id) then
    raise exception using message = 'attachment_exists';
  end if;
  if new.report_id is not null then
    select r.site_id, r.status, r.report_date into v_site, v_rstatus, v_rdate
      from public.gn_daily_reports r where r.id = new.report_id;
    if v_site is null or (v_uid is not null and not public.gn_is_site_member(v_site)) then
      raise exception using message = 'report_not_found';
    end if;
  elsif new.issue_id is not null then
    select i.site_id, i.status, r.report_date into v_site, v_istatus, v_idate
      from public.gn_report_issues i
      join public.gn_daily_reports r on r.id = i.report_id
     where i.id = new.issue_id;
    if v_site is null or (v_uid is not null and not public.gn_is_site_member(v_site)) then
      raise exception using message = 'issue_not_found';
    end if;
  else
    -- 日報も件も無い行は check（gn_attachments_target_check）で止まる
    return new;
  end if;

  if v_uid is not null then
    if public.gn_site_closed(v_site) then
      raise exception using message = 'site_closed';
    end if;
    if new.report_id is not null and v_rstatus not in ('draft','rejected') then
      raise exception using message = 'report_locked';
    end if;
    if new.issue_id is not null and v_istatus = 'done' then
      raise exception using message = 'issue_done';
    end if;
    if new.kind = 'file' and not public.gn_is_employee_or_admin() then
      raise exception using message = 'file_not_allowed';
    end if;
    new.created_by := v_uid;
  end if;

  new.site_id := v_site;
  new.name    := btrim(new.name);
  new.caption := btrim(coalesce(new.caption, ''));
  if new.report_id is not null then
    new.attached_on := v_rdate;
  else
    if new.attached_on is null or new.attached_on < v_idate or new.attached_on > greatest(v_today, v_idate) then
      new.attached_on := v_today;
    end if;
  end if;
  if new.kind in ('file','link') then
    new.client_visible := false;
  end if;
  new.created_at := now();
  new.created_by_name := coalesce(
    (select nullif(btrim(p.name), '') from public.profiles p where p.id = new.created_by), '');

  -- 写真・ファイル：パスは <site_id>/att/<id>.<拡張子>（写真は .jpg）。実体があり 10MB 以下であること。
  if new.kind in ('photo','file') then
    if new.storage_path is null
       or (new.kind = 'photo' and new.storage_path <> v_site::text || '/att/' || new.id::text || '.jpg')
       or (new.kind = 'file' and new.storage_path !~ ('^' || v_site::text || '/att/' || new.id::text || '\.[a-z0-9]{1,8}$')) then
      raise exception using message = 'invalid_storage_path';
    end if;
    -- 列の有無（owner・owner_id は Storage の版で違う）に頼らないよう jsonb で読む
    select to_jsonb(o) into v_obj
      from storage.objects o
     where o.bucket_id = new.storage_bucket and o.name = new.storage_path;
    if v_obj is null then
      raise exception using message = 'storage_object_missing';
    end if;
    -- 実体を置いたのが本人であること（他人が置いた実体を自分の添付にしない）
    if v_uid is not null
       and coalesce(nullif(v_obj->>'owner_id', ''), v_obj->>'owner') is distinct from v_uid::text then
      raise exception using message = 'storage_object_not_owned';
    end if;
    v_size := coalesce((v_obj->'metadata'->>'size')::bigint, 0);
    if v_size > 10485760 then
      raise exception using message = 'storage_object_too_large';
    end if;
    new.size_bytes := nullif(v_size, 0);
    new.mime := coalesce(nullif(v_obj->'metadata'->>'mimetype', ''), new.mime);
  end if;
  return new;
end;
$$;
drop trigger if exists gn_attachments_guard on public.gn_attachments;
create trigger gn_attachments_guard before insert or update or delete on public.gn_attachments
  for each row execute function public.gn_attachments_guard();

-- RLS：読む・付けるのは現場メンバー。ファイル（kind = 'file'）の行は社員・管理者だけ（協力会社には行ごと見えない）。
-- お客様用に載せるかの切り替えは、社員・管理者と付けた本人。消すのは付けた本人と管理者（状態の条件はガード）。
alter table public.gn_attachments enable row level security;
drop policy if exists gn_attachments_select on public.gn_attachments;
create policy gn_attachments_select on public.gn_attachments for select to authenticated
  using (public.gn_is_site_member(site_id) and (kind <> 'file' or public.gn_is_employee_or_admin()));
drop policy if exists gn_attachments_insert on public.gn_attachments;
create policy gn_attachments_insert on public.gn_attachments for insert to authenticated
  with check (
    public.gn_is_site_member(site_id)
    and created_by = auth.uid()
    and (kind <> 'file' or public.gn_is_employee_or_admin())
  );
drop policy if exists gn_attachments_update on public.gn_attachments;
create policy gn_attachments_update on public.gn_attachments for update to authenticated
  using (
    public.gn_is_site_member(site_id)
    and (kind <> 'file' or public.gn_is_employee_or_admin())
    and (public.gn_is_employee_or_admin() or created_by = auth.uid())
  )
  with check (
    public.gn_is_site_member(site_id)
    and (kind <> 'file' or public.gn_is_employee_or_admin())
    and (public.gn_is_employee_or_admin() or created_by = auth.uid())
  );
drop policy if exists gn_attachments_delete on public.gn_attachments;
create policy gn_attachments_delete on public.gn_attachments for delete to authenticated
  using (
    public.gn_is_site_member(site_id)
    and (kind <> 'file' or public.gn_is_employee_or_admin())
    and (created_by = auth.uid() or public.is_admin())
  );

-- 添付を置く 2 つのバケットは 1 つ 10MB まで、置ける種類も絞る（アプリ・ガードでも確かめる。gn-exports は変えない）。
--   gn-photos：縮めた写真（JPEG）とサイン（PNG）。gn-estimates：PDF・Excel・Word・JPEG・PNG。
update storage.buckets set file_size_limit = 10485760
 where id in ('gn-photos','gn-estimates') and file_size_limit is distinct from 10485760;
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png']
 where id = 'gn-photos' and allowed_mime_types is distinct from array['image/jpeg','image/png'];
update storage.buckets set allowed_mime_types = array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png']
 where id = 'gn-estimates' and allowed_mime_types is distinct from array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png'];

commit;

-- 確認（任意）：
-- select policyname from pg_policies where tablename = 'gn_attachments';
-- select id, file_size_limit from storage.buckets where id in ('gn-photos','gn-estimates');
-- select policyname, qual from pg_policies where schemaname = 'storage' and policyname like 'gn_estimates_%';
