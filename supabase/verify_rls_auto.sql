-- gn_ スキーマの権限・ガードの自動検証（verify_rls.md の手順 0〜9 を 1 本にまとめたもの。10 は客先確認のガード例外［update_2026-11-04c］）
--
-- 使い方：Supabase の SQL Editor に全部貼って Run する。
-- 結果は「ERROR: VERIFY_RLS ...」として表示される（わざと例外で終わらせることで、
-- 途中で作った検証用の現場・日報・ログ・区分の変更をすべて取り消すため）。
-- メッセージの中の各行が PASS / FAIL。FAIL が 0 行なら合格。本番データは一切変わらない。
--
-- 前提：管理者（is_admin = true）が 1 人以上、管理者でない社員が 3 人以上いること。
-- 役割は自動で選ぶ：A・B＝検証の間だけ協力会社にする（取り消される）、C＝社員（割り当てなし）。

create function pg_temp.as_user(u uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;

create function pg_temp.as_editor() returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid;
  x  uuid := '00000000-0000-0000-0000-0000000000a1';
  y  uuid := '00000000-0000-0000-0000-0000000000b1';
  z  uuid := '00000000-0000-0000-0000-0000000000c1';
  w  uuid := '00000000-0000-0000-0000-0000000000c2';
  rep text := '';
  fails int := 0;
  n int; n2 int; t text; t2 text; u uuid; rid uuid; rid2 uuid; ts timestamptz; num numeric; num2 numeric;
  procedure_dummy int;

  -- 結果行を足す
  -- （plpgsql に手続きのローカル定義は無いので、同じ書き方を繰り返す）
begin
  -- ===== 0. 役割を選ぶ =====
  select id into v_admin from public.profiles where is_admin = true order by created_at limit 1;
  if v_admin is null then raise exception using message = 'VERIFY_RLS: 管理者がいません'; end if;
  select id into v_a from public.profiles where is_admin = false and id <> v_admin order by created_at limit 1;
  select id into v_b from public.profiles where is_admin = false and id not in (v_admin, v_a) order by created_at limit 1;
  select id into v_c from public.profiles where is_admin = false and id not in (v_admin, v_a, v_b) order by created_at limit 1;
  if v_c is null then raise exception using message = 'VERIFY_RLS: 管理者でない社員が 3 人必要です'; end if;
  rep := rep || format(E'役割: admin=%s A=%s B=%s C=%s\n', v_admin, v_a, v_b, v_c);

  -- SQL Editor（所有者）として準備。すべて最後に取り消される。
  update public.profiles set account_type = 'partner'  where id in (v_a, v_b);
  update public.profiles set account_type = 'employee' where id = v_c;
  insert into public.gn_sites (id, name) values (x, '検証現場X'), (y, '検証現場Y');
  insert into public.gn_site_members (site_id, user_id, role) values (x, v_a, 'staff'), (y, v_b, 'staff');

  -- ===== 2. 現場の見え方 =====
  perform pg_temp.as_user(v_a);
  select count(*), string_agg(name, ',') into n, t from public.gn_sites where id in (x, y);
  perform pg_temp.as_editor();
  if n = 1 and t = '検証現場X' then rep := rep || E'PASS 2-1 協力会社Aには現場Xだけ見える\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 2-1 Aに見える現場: %s (%s)\n', n, t); end if;

  perform pg_temp.as_user(v_b);
  select count(*), string_agg(name, ',') into n, t from public.gn_sites where id in (x, y);
  perform pg_temp.as_editor();
  if n = 1 and t = '検証現場Y' then rep := rep || E'PASS 2-2 協力会社Bには現場Yだけ見える\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 2-2 Bに見える現場: %s (%s)\n', n, t); end if;

  perform pg_temp.as_user(v_c);
  select count(*) into n from public.gn_sites where id in (x, y);
  perform pg_temp.as_editor();
  if n = 2 then rep := rep || E'PASS 2-3 社員Cには割り当てがなくても両方見える\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 2-3 Cに見える現場: %s\n', n); end if;

  perform pg_temp.as_user(v_admin);
  select count(*) into n from public.gn_sites where id in (x, y);
  perform pg_temp.as_editor();
  if n = 2 then rep := rep || E'PASS 2-4 管理者には両方見える\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 2-4 管理者に見える現場: %s\n', n); end if;

  begin
    perform pg_temp.as_user(v_a);
    insert into public.gn_sites (name) values ('勝手に作った現場');
    perform pg_temp.as_editor();
    fails := fails + 1; rep := rep || E'FAIL 2-5 Aが現場を作れてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlstate = '42501' then rep := rep || E'PASS 2-5 Aは現場を作れない（RLS）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 2-5 想定外のエラー: %s\n', sqlerrm); end if;
  end;

  -- ===== 3. gn_save_report（Aとして・現場X） =====
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(
      jsonb_build_object('site_id', x, 'report_date', '2026-11-01', 'weather', '晴れ', 'supervisor', '検証太郎',
        'common_start', '08:00', 'common_end', '17:00', 'common_break_min', 60, 'common_gap_min', 0),
      '[{"kind":"labor","sort_order":1,"name":"山田","unit_price":20000,"man_days":9,"amount":999999},
        {"kind":"work","sort_order":2,"description":"解体","qty":1,"unit_price":50000,"amount":1}]'::jsonb) into rid;
    select public.gn_save_report(
      jsonb_build_object('site_id', x, 'report_date', '2026-11-01', 'weather', '曇り', 'supervisor', '検証太郎',
        'common_start', '08:00', 'common_end', '17:00', 'common_break_min', 60, 'common_gap_min', 0),
      '[{"kind":"labor","sort_order":1,"name":"鈴木","start_time":"08:00","end_time":"12:00","break_min":0,
         "unit_price":20000,"man_days":9,"amount":999999}]'::jsonb) into rid2;
    perform pg_temp.as_editor();
    if rid = rid2 then rep := rep || E'PASS 3-1 同じ日付の2回保存は同じ日報になる\n';
    else fails := fails + 1; rep := rep || E'FAIL 3-1 2回目の保存で別の日報ができた\n'; end if;
    select count(*) into n from public.gn_daily_reports where site_id = x;
    select weather, status, created_by into t, t2, u from public.gn_daily_reports where id = rid;
    select cost_total, man_days_total into num, num2 from public.gn_daily_reports where id = rid;
    select count(*) into n2 from public.gn_report_lines where report_id = rid;
    if n = 1 and t = '曇り' and t2 = 'draft' and u = v_a and num = 10600 and num2 = 0.53 and n2 = 1 then
      rep := rep || E'PASS 3-2 日報1件・曇り・draft・created_by=A・労務費10600・0.53人工・明細1件（DBが計算し直す）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 3-2 件数=%s weather=%s status=%s created_by=A?%s cost=%s man=%s lines=%s\n', n, t, t2, (u = v_a), num, num2, n2); end if;
  exception when others then
    perform pg_temp.as_editor();
    fails := fails + 1; rep := rep || format(E'FAIL 3 保存でエラー: %s\n', sqlerrm);
  end;

  perform pg_temp.as_user(v_b);
  select count(*) into n from public.gn_daily_reports where site_id = x;
  select count(*) into n2 from public.gn_report_lines l join public.gn_daily_reports r on r.id = l.report_id where r.site_id = x;
  perform pg_temp.as_editor();
  if n = 0 and n2 = 0 then rep := rep || E'PASS 3-3 BにはXの日報も明細も見えない\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 3-3 Bに見えるXの日報=%s 明細=%s\n', n, n2); end if;

  perform pg_temp.as_user(v_c);
  select count(*) into n from public.gn_daily_reports where site_id = x;
  perform pg_temp.as_editor();
  if n = 1 then rep := rep || E'PASS 3-4 社員CにはXの日報が見える\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 3-4 Cに見えるXの日報=%s\n', n); end if;

  begin
    perform pg_temp.as_user(v_c);
    select public.gn_save_report(jsonb_build_object('site_id', y, 'report_date', '2026-11-06', 'weather', '晴れ', 'supervisor', '検証C'), '[]'::jsonb) into rid2;
    perform pg_temp.as_editor();
    rep := rep || E'PASS 3-5 社員Cは割り当てのない現場Yに日報を作れる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 3-5 Cの保存でエラー: %s\n', sqlerrm);
  end;

  begin
    perform pg_temp.as_user(v_c);
    update public.gn_daily_reports set status = 'approved' where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 3-6 社員Cが承認できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_reviewer%' then rep := rep || E'PASS 3-6 社員Cは割り当てがないので承認できない（not_reviewer）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 3-6 想定外: %s\n', sqlerrm); end if;
  end;

  perform pg_temp.as_user(v_a);
  select count(*) into n from public.gn_daily_reports where site_id = y;
  perform pg_temp.as_editor();
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_save_report(jsonb_build_object('site_id', y, 'report_date', '2026-11-07'), '[]'::jsonb);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 3-7 協力会社Aが現場Yに日報を作れてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 3-7 協力会社AはYの日報を読めず作れない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 3-7 AにYの日報が %s 件見える\n', n); end if;
  end;

  -- ===== 4. 承認済みのロック =====
  perform pg_temp.as_user(v_a);
  select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-02', 'weather', '雨'), '[]'::jsonb) into rid2;
  perform pg_temp.as_editor();
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set status = 'approved' where id = rid2;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 4-1 Aが自分の日報を承認できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_reviewer%' then rep := rep || E'PASS 4-1 担当Aは承認できない（not_reviewer）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 4-1 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set status = 'submitted' where id = rid2;
    select status into t from public.gn_daily_reports where id = rid2;
    perform pg_temp.as_editor();
    if t = 'submitted' then rep := rep || E'PASS 4-2 Aは提出（submitted）できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 4-2 status=%s\n', t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 4-2 提出でエラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set status = 'approved', approved_by = v_admin, approved_at = now() where id = rid;
    perform pg_temp.as_editor(); rep := rep || E'PASS 4-3 管理者は承認できる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 4-3 管理者の承認でエラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set weather = '雨' where id = rid;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 4-4 承認済みをAが更新できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 4-4 承認済みはAが更新できない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 4-4 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    delete from public.gn_report_lines where report_id = rid;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 4-5 承認済みの明細をAが消せてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 4-5 承認済みの明細はAが消せない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 4-5 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-01', 'weather', '雪'),
      '[{"kind":"labor","sort_order":1,"name":"上書き","man_days":9,"amount":1}]'::jsonb);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 4-6 承認済みにAが保存できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 4-6 承認済みへの保存はAはできない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 4-6 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set notes_text = '管理者による修正' where id = rid;
    perform pg_temp.as_editor(); rep := rep || E'PASS 4-7 管理者は承認済みでも更新できる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 4-7 管理者の更新でエラー: %s\n', sqlerrm);
  end;

  -- ===== 5. Storage =====
  select count(*) into n from storage.buckets where id in ('gn-photos','gn-estimates','gn-exports') and public = false;
  if n = 3 then rep := rep || E'PASS 5-1 バケット3件はすべて非公開\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 5-1 非公開のバケット=%s/3\n', n); end if;
  begin
    insert into storage.objects (bucket_id, name, owner) values
      ('gn-photos', x::text || '/test.txt', v_a), ('gn-photos', y::text || '/test.txt', v_b), ('gn-photos', 'not-a-uuid/test.txt', v_a);
    perform pg_temp.as_user(v_a);
    select count(*), string_agg(name, ',') into n, t from storage.objects where bucket_id = 'gn-photos' and name like '%/test.txt';
    perform pg_temp.as_editor();
    if n = 1 and t = x::text || '/test.txt' then rep := rep || E'PASS 5-2 Aには自分の現場Xのフォルダだけ見える\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 5-2 Aに見えるファイル: %s (%s)\n', n, t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 5-2 Storage の検証でエラー: %s\n', sqlerrm);
  end;

  -- ===== 6. 承認ガードの追加検証 =====
  begin
    perform pg_temp.as_user(v_a);
    insert into public.gn_daily_reports (site_id, report_date, status, approved_by, approved_at) values (x, '2026-11-03', 'approved', v_a, now());
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-1 Aが承認済みの日報を作れてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_reviewer%' then rep := rep || E'PASS 6-1 最初から承認済みの insert は拒否\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-1 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set approved_by = v_a where id = rid2;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-2 Aが approved_by を書けてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_reviewer%' then rep := rep || E'PASS 6-2 担当は承認系の列を書けない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-2 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    insert into public.gn_daily_reports (site_id, report_date, created_by) values (x, '2026-11-04', v_b) returning created_by into u;
    perform pg_temp.as_editor();
    if u = v_a then rep := rep || E'PASS 6-3 created_by は本人に上書きされる\n';
    else fails := fails + 1; rep := rep || E'FAIL 6-3 created_by が他人のまま\n'; end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-3 エラー: %s\n', sqlerrm);
  end;
  insert into public.gn_site_members (site_id, user_id, role) values (x, v_b, 'reviewer');
  begin
    perform pg_temp.as_user(v_b);
    update public.gn_daily_reports set status = 'approved', approved_by = v_b, approved_at = now() where id = rid2;
    select status into t from public.gn_daily_reports where id = rid2;
    perform pg_temp.as_editor();
    if t = 'approved' then rep := rep || E'PASS 6-4 確認者Bは承認できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-4 status=%s\n', t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-4 Bの承認でエラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null where id = rid2;
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set weather = '曇り' where id = rid2;
    perform pg_temp.as_editor(); rep := rep || E'PASS 6-5 管理者が承認を取り消すとAがまた編集できる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-5 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_b);
    select public.gn_save_report(jsonb_build_object('site_id', y, 'report_date', '2026-11-01'), '[]'::jsonb) into u;
    perform pg_temp.as_user(v_a);
    insert into public.gn_report_issues (site_id, report_id, body) values (y, u, '他現場への指摘');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-6 Aが他現場の日報に指摘を付けられた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%report_not_found%' or sqlstate = '42501' then rep := rep || E'PASS 6-6 他現場の日報には指摘を付けられない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-6 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    insert into public.gn_report_issues (site_id, report_id, body) values (y, rid2, '正しい現場に補正される') returning site_id into u;
    perform pg_temp.as_editor();
    if u = x then rep := rep || E'PASS 6-6b 指摘の現場は日報の現場に補正される\n';
    else fails := fails + 1; rep := rep || E'FAIL 6-6b site_id が補正されない\n'; end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-6b エラー: %s\n', sqlerrm);
  end;
  -- 件の精算の項目（update_2026-11-05b のガード）：6-6b の件（X の 11-02 の日報）を使う
  select id into u from public.gn_report_issues where report_id = rid2 and body = '正しい現場に補正される';
  begin
    perform pg_temp.as_user(v_a);  -- A は協力会社・X の担当
    update public.gn_report_issues set settlement_method = 'lump_sum', fixed_amount = 50000 where id = u;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-6c 協力会社Aが件の精算の方法を変えられた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_employee%' then rep := rep || E'PASS 6-6c 協力会社は担当現場でも件の精算の項目を変えられない（not_employee）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-6c 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);  -- C は社員（X の割り当てなし）
    update public.gn_report_issues set settlement_method = 'lump_sum', fixed_amount = 50000, fixed_on = '2026-11-05' where id = u;
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    select settlement_method, fixed_amount into t, num from public.gn_report_issues where id = u;
    if n = 1 and t = 'lump_sum' and num = 50000 then rep := rep || E'PASS 6-6d 社員は件の精算の項目を変えられる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-6d 更新件数=%s method=%s amount=%s\n', n, t, num); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-6d エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);  -- A は協力会社・X の担当
    insert into public.gn_report_issues (site_id, report_id, body, settlement_method, fixed_amount)
      values (x, rid2, '協力会社が一式で追加', 'lump_sum', 50000);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-6e 協力会社Aが精算の列つきの件を追加できた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_employee%' then rep := rep || E'PASS 6-6e 協力会社は精算の列つきの件を追加できない（not_employee）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-6e 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    insert into public.gn_report_issues (site_id, report_id, body) values (x, rid2, '協力会社の普通の件') returning settlement_method into t;
    perform pg_temp.as_editor();
    if t = 'undecided' then rep := rep || E'PASS 6-6f 協力会社も精算の列の無い件は追加できる（未定）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-6f method=%s\n', t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-6f エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set output_total = 99999999 where id = rid2;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-8 Aが合計を直接書けた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%totals_locked%' then rep := rep || E'PASS 6-8 合計列は直接書けない（A）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-8 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set output_total = 99999999 where id = rid2;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-8b 管理者が合計を直接書けた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%totals_locked%' then rep := rep || E'PASS 6-8b 合計列は管理者も直接書けない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-8b 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-02', 'weather', '雪', 'expected_updated_at', '2000-01-01T00:00:00Z'), '[]'::jsonb);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 6-9 古い updated_at で保存できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%stale_report%' then rep := rep || E'PASS 6-9 他端末で更新済みなら保存を止める（stale_report）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-9 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-05'),
      '[{"kind":"labor","sort_order":1,"name":"削除用","start_time":"08:00","end_time":"12:00","break_min":0,"unit_price":10000}]'::jsonb) into u;
    delete from public.gn_daily_reports where id = u;
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    select count(*) into n2 from public.gn_report_lines where report_id = u;
    if n = 1 and n2 = 0 then rep := rep || E'PASS 6-10 作成者は下書きを削除でき、明細も消える\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-10 deleted=%s lines_left=%s\n', n, n2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-10 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);
    delete from public.gn_daily_reports where id = rid; -- 承認済み
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 6-11 承認済みは作成者でも削除できない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 6-11 承認済みが %s 件消えた\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 6-11 エラー: %s\n', sqlerrm);
  end;

  -- ===== 8. profiles の保護 =====
  begin
    perform pg_temp.as_user(v_a);
    update public.profiles set is_admin = true where id = v_a;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 8-1 Aが自分を管理者にできた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%is_admin_locked%' then rep := rep || E'PASS 8-1 自分を管理者にはできない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 8-1 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.profiles set name = name where id = v_a;
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    if n = 1 then rep := rep || E'PASS 8-2 自分の他の列は更新できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 8-2 更新件数=%s\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 8-2 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);  -- A は今 partner
    update public.profiles set account_type = 'employee' where id = v_a;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 8-4 協力会社が自分を社員に変えられた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%account_type_locked%' then rep := rep || E'PASS 8-4 自分の区分は変えられない（account_type_locked）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 8-4 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    update public.profiles set company_name = 'テスト工業' where id = v_c;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 8-4b 自分の会社名を付けられた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%account_type_locked%' then rep := rep || E'PASS 8-4b 自分の会社名は変えられない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 8-4b 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.profiles set account_type = 'partner', company_name = 'テスト工業' where id = v_c returning account_type into t;
    perform pg_temp.as_editor();
    if t = 'partner' then rep := rep || E'PASS 8-5 管理者は他人の区分を変えられる\n';
    else fails := fails + 1; rep := rep || E'FAIL 8-5 区分が変わらない\n'; end if;
    update public.profiles set account_type = 'employee', company_name = null where id = v_c; -- 戻す（最後に全部取り消されるが念のため）
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 8-5 エラー: %s\n', sqlerrm);
  end;

  -- ===== 9. 現場の削除と完了現場 =====
  insert into public.gn_sites (id, name, status) values (z, '検証現場Z', 'active'), (w, '検証現場W', 'done');
  insert into public.gn_site_members (site_id, user_id, role) values (z, v_a, 'staff'), (w, v_a, 'staff');
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_archive_site(z, '検証');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 9-1 社員Cが現場を削除できた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%not_admin%' then rep := rep || E'PASS 9-1 管理者以外は削除できない（not_admin）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-1 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_audit_log (site_name, action) values ('x', 'archive');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 9-1b 一般ユーザーがログを直接書けた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlstate = '42501' then rep := rep || E'PASS 9-1b ログは直接書けない（関数経由のみ）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-1b 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_admin);
    perform public.gn_archive_site(z, '検証のため');
    perform pg_temp.as_editor();
    select (deleted_at is not null) into t from public.gn_sites where id = z;
    select count(*) into n from public.gn_site_audit_log where site_id = z and action = 'archive' and actor_id = v_admin and reason = '検証のため';
    if t = 'true' and n = 1 then rep := rep || E'PASS 9-2 管理者の削除で deleted_at とログ（誰が・理由）が残る\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-2 deleted=%s log=%s\n', t, n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 9-2 エラー: %s\n', sqlerrm);
  end;
  perform pg_temp.as_user(v_a);
  select count(*) into n from public.gn_sites where id = z;
  perform pg_temp.as_user(v_c);
  select count(*) into n2 from public.gn_sites where id = z;
  perform pg_temp.as_editor();
  if n = 0 and n2 = 0 then rep := rep || E'PASS 9-3 削除済みの現場は担当Aにも社員Cにも見えない\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 9-3 A=%s C=%s\n', n, n2); end if;
  perform pg_temp.as_user(v_admin);
  select count(*) into n from public.gn_sites where id = z;
  select count(*) into n2 from public.gn_site_audit_log where site_id = z;
  perform pg_temp.as_user(v_c);
  select count(*) into procedure_dummy from public.gn_site_audit_log;
  perform pg_temp.as_editor();
  if n = 1 and n2 = 1 and procedure_dummy = 0 then rep := rep || E'PASS 9-4 管理者には削除済みとログが見え、社員にはログが見えない\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 9-4 admin site=%s log=%s / C log=%s\n', n, n2, procedure_dummy); end if;
  begin
    perform pg_temp.as_user(v_admin);
    perform public.gn_restore_site(z);
    perform pg_temp.as_user(v_a);
    select count(*) into n from public.gn_sites where id = z;
    perform pg_temp.as_editor();
    select count(*) into n2 from public.gn_site_audit_log where site_id = z and action = 'restore';
    if n = 1 and n2 = 1 then rep := rep || E'PASS 9-5 復元するとまた見え、復元のログも残る\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-5 A sees=%s restore log=%s\n', n, n2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 9-5 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_save_report(jsonb_build_object('site_id', w, 'report_date', '2026-11-08'), '[]'::jsonb);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 9-6 完了現場に日報を作れてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%site_closed%' then rep := rep || E'PASS 9-6 完了現場には日報を作れない（site_closed）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-6 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    -- 完了現場でも承認はできる：Y を完了にし、C が作った 11-06 を C が提出 → B（Yの担当。確認者に昇格）が承認
    perform pg_temp.as_user(v_c);
    update public.gn_daily_reports set status = 'submitted' where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor();
    update public.gn_sites set status = 'done' where id = y;
    update public.gn_site_members set role = 'reviewer' where site_id = y and user_id = v_b;
    perform pg_temp.as_user(v_b);
    update public.gn_daily_reports set status = 'approved', approved_by = v_b, approved_at = now() where site_id = y and report_date = '2026-11-06';
    select status into t from public.gn_daily_reports where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor();
    if t = 'approved' then rep := rep || E'PASS 9-7 完了現場でも承認はできる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-7 status=%s\n', t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 9-7 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set weather = '雹' where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 9-8 完了現場の日報を管理者が編集できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%site_closed%' then rep := rep || E'PASS 9-8 完了現場の内容は管理者でも変更できない（進行中に戻す必要）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 9-8 想定外: %s\n', sqlerrm); end if;
  end;

  -- ===== 10. 客先確認の3列だけの更新（update_2026-11-04c のガード例外） =====
  -- Y は 9-7 で完了・11-06 は承認済み。C を Y の担当（staff）にする。X の rid（11-01）は承認済み・X は進行中・A は担当。
  insert into public.gn_site_members (site_id, user_id, role) values (y, v_c, 'staff');
  begin
    perform pg_temp.as_user(v_c);
    update public.gn_daily_reports
       set client_confirmed_by = '施主 検証様', client_confirmed_at = '2026-11-06T15:00:00+09:00', client_confirmed_note = '現地で確認'
     where site_id = y and report_date = '2026-11-06';
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    select client_confirmed_by, status into t, t2 from public.gn_daily_reports where site_id = y and report_date = '2026-11-06';
    if n = 1 and t = '施主 検証様' and t2 = 'approved' then rep := rep || E'PASS 10-1 担当は完了現場の承認済み日報にも客先確認だけは記録できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-1 更新件数=%s by=%s status=%s\n', n, t, t2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 10-1 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_c);
    update public.gn_daily_reports
       set client_confirmed_by = '施主 別人様', client_confirmed_at = now(), client_confirmed_note = null, weather = '雹'
     where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 10-2 客先確認と一緒に天気を変えられた（完了現場）\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%site_closed%' then rep := rep || E'PASS 10-2 客先確認と一緒に他の列は変えられない（完了現場は site_closed）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-2 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    update public.gn_daily_reports
       set client_confirmed_by = '施主 検証様', client_confirmed_at = '2026-11-06T15:00:00+09:00', client_confirmed_note = '現地で確認'
     where site_id = y and report_date = '2026-11-06';
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 10-3 同じ値の更新（何も変えない）が承認済み・完了現場で通った\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%site_closed%' or sqlerrm like '%approved_report_locked%' then
      rep := rep || E'PASS 10-3 何も変えない更新は例外に入らず拒否される\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-3 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);  -- A は協力会社・X の担当
    update public.gn_daily_reports
       set client_confirmed_by = '元請 検証様', client_confirmed_at = '2026-11-01T17:00:00+09:00', client_confirmed_note = null
     where id = rid;
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    select client_confirmed_by, status into t, t2 from public.gn_daily_reports where id = rid;
    if n = 1 and t = '元請 検証様' and t2 = 'approved' then rep := rep || E'PASS 10-4 協力会社の担当も割り当て現場の承認済み日報に客先確認を記録できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-4 更新件数=%s by=%s status=%s\n', n, t, t2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 10-4 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set client_confirmed_note = 'メモ追記', weather = '雪' where id = rid;
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 10-5 客先確認と一緒に承認済みの天気を変えられた\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 10-5 客先確認と一緒に他の列は変えられない（進行中の現場は approved_report_locked）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-5 想定外: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);  -- A は Y の担当ではない（協力会社）
    update public.gn_daily_reports set client_confirmed_note = '担当外から' where site_id = y and report_date = '2026-11-06';
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    select client_confirmed_note into t from public.gn_daily_reports where site_id = y and report_date = '2026-11-06';
    if n = 0 and t = '現地で確認' then rep := rep || E'PASS 10-6 担当外の協力会社は客先確認を記録できない（RLS）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 10-6 更新件数=%s note=%s\n', n, t); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 10-6 エラー: %s\n', sqlerrm);
  end;

  -- ===== 終わり：すべて取り消す =====
  raise exception using message = format(E'VERIFY_RLS 結果: FAIL %s 件\n%s', fails, rep);
end $$;
