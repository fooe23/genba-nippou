-- gn_ スキーマの権限・ガードの自動検証（verify_rls.md の手順 0〜9 を 1 本にまとめたもの。10 は客先確認のガード例外［update_2026-11-04c］、11 は作業員の所属・現場の協力会社［update_2026-11-07］、12 は現場からの協力会社の作業員の登録［update_2026-11-07b］、13 は件の見積中・承認解除・修正申請［update_2026-11-08］、14 は日報・件の添付［update_2026-11-09］）
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

  -- ===== 11. 作業員の所属・現場の協力会社・協力会社アカウントの会社（update_2026-11-07） =====
  -- X は進行中（A＝協力会社の担当）、Y は完了（C＝社員の担当）。B は X の担当ではない協力会社。
  insert into public.gn_suppliers (id, name) values ('00000000-0000-0000-0000-0000000000d1', '検証協力会社');
  insert into public.gn_workers (id, name, affiliation, supplier_id) values
    ('00000000-0000-0000-0000-0000000000e1', '検証 自社作業員', 'own', null),
    ('00000000-0000-0000-0000-0000000000e2', '検証 協力作業員', 'partner', '00000000-0000-0000-0000-0000000000d1');
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_partners (site_id, supplier_id, amount, note) values (x, '00000000-0000-0000-0000-0000000000d1', 500000, '検証');
    perform pg_temp.as_editor();
    rep := rep || E'PASS 11-1 社員は進行中の現場に協力会社を追加できる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 11-1 エラー: %s\n', sqlerrm);
  end;
  perform pg_temp.as_user(v_a);
  select count(*) into n from public.gn_site_partners where site_id = x;
  perform pg_temp.as_editor();
  perform pg_temp.as_user(v_c);
  select count(*) into n2 from public.gn_site_partners where site_id = x;
  perform pg_temp.as_editor();
  if n = 0 and n2 = 1 then rep := rep || E'PASS 11-2 現場の協力会社（請負金額）は社員が読め、担当の協力会社には見えない（0 行）\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 11-2 協力会社A=%s 社員C=%s\n', n, n2); end if;
  begin
    perform pg_temp.as_user(v_a);
    update public.gn_site_partners set amount = 1 where site_id = x;
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 11-3 協力会社は現場の協力会社を変えられない（RLS）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 11-3 更新件数=%s\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); rep := rep || E'PASS 11-3 協力会社は現場の協力会社を変えられない（RLS）\n';
  end;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_partners (site_id, supplier_id) values (y, '00000000-0000-0000-0000-0000000000d1');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 11-4 完了現場に協力会社を追加できてしまった\n';
  exception when others then
    perform pg_temp.as_editor(); rep := rep || E'PASS 11-4 完了現場には協力会社を追加できない（RLS）\n';
  end;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_workers (site_id, worker_id) values (x, '00000000-0000-0000-0000-0000000000e2');
    perform pg_temp.as_editor();
    rep := rep || E'PASS 11-5 社員は協力会社の作業員を現場に登録できる\n';
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 11-5 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_workers (site_id, worker_id) values (x, '00000000-0000-0000-0000-0000000000e1');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 11-6 社員が自社の作業員の選択を変えられた\n';
  exception when others then
    perform pg_temp.as_editor(); rep := rep || E'PASS 11-6 自社の作業員の選択は管理者だけ（社員は RLS で拒否）\n';
  end;
  begin
    perform pg_temp.as_user(v_a);
    delete from public.gn_site_workers where site_id = x and worker_id = '00000000-0000-0000-0000-0000000000e2';
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 11-7 協力会社は作業員の登録を外せない（RLS）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 11-7 削除件数=%s\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 11-7 エラー: %s\n', sqlerrm);
  end;
  insert into public.gn_site_workers (site_id, worker_id) values (x, '00000000-0000-0000-0000-0000000000e1');
  begin
    perform pg_temp.as_user(v_c);
    delete from public.gn_site_workers where site_id = x and worker_id = '00000000-0000-0000-0000-0000000000e1';
    get diagnostics n = row_count;
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 11-7b 社員は自社の作業員の選択を外せない（RLS）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 11-7b 削除件数=%s\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 11-7b エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_site_workers (site_id, worker_id) values (y, '00000000-0000-0000-0000-0000000000e2');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 11-7c 完了現場に協力会社の作業員を登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor(); rep := rep || E'PASS 11-7c 完了現場には協力会社の作業員を登録できない（RLS）\n';
  end;
  insert into public.gn_partner_accounts (user_id, supplier_id) values (v_a, '00000000-0000-0000-0000-0000000000d1');
  perform pg_temp.as_user(v_a);
  select count(*) into n from public.gn_partner_accounts where user_id = v_a;
  perform pg_temp.as_editor();
  perform pg_temp.as_user(v_b);
  select count(*) into n2 from public.gn_partner_accounts where user_id = v_a;
  perform pg_temp.as_editor();
  perform pg_temp.as_user(v_c);
  select count(*) into procedure_dummy from public.gn_partner_accounts where user_id = v_a;
  perform pg_temp.as_editor();
  if n = 1 and n2 = 0 and procedure_dummy = 1 then rep := rep || E'PASS 11-8 協力会社アカウントの会社は本人と社員だけ読める\n';
  else fails := fails + 1; rep := rep || format(E'FAIL 11-8 本人=%s 他の協力会社=%s 社員=%s\n', n, n2, procedure_dummy); end if;
  begin
    perform pg_temp.as_user(v_c);
    insert into public.gn_partner_accounts (user_id, supplier_id) values (v_b, '00000000-0000-0000-0000-0000000000d1');
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 11-9 社員が協力会社アカウントの会社を設定できた\n';
  exception when others then
    perform pg_temp.as_editor(); rep := rep || E'PASS 11-9 協力会社アカウントの会社は管理者だけ設定できる\n';
  end;
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_save_report(
      jsonb_build_object('site_id', x, 'report_date', '2026-11-10', 'common_start', '08:00', 'common_end', '17:00', 'common_break_min', 60),
      jsonb_build_array(
        jsonb_build_object('kind', 'labor', 'sort_order', 0, 'ref_id', '00000000-0000-0000-0000-0000000000e2', 'name', '検証 協力作業員',
                           'unit_price', 18000, 'labor_contract', 'ukeoi', 'affiliation', 'partner', 'supplier_id', '00000000-0000-0000-0000-0000000000d1'),
        jsonb_build_object('kind', 'cash', 'sort_order', 1, 'name', 'テープ', 'qty', 1, 'unit_price', 100,
                           'labor_contract', 'ukeoi', 'affiliation', 'own', 'supplier_id', '00000000-0000-0000-0000-0000000000d1')));
    select count(*) filter (where l.kind = 'labor' and l.labor_contract = 'ukeoi' and l.affiliation = 'partner' and l.supplier_id = '00000000-0000-0000-0000-0000000000d1'),
           count(*) filter (where l.kind = 'cash' and l.labor_contract is null and l.affiliation is null and l.supplier_id is null)
      into n, n2
      from public.gn_report_lines l join public.gn_daily_reports r on r.id = l.report_id
     where r.site_id = x and r.report_date = '2026-11-10';
    perform pg_temp.as_editor();
    if n = 1 and n2 = 1 then rep := rep || E'PASS 11-10 gn_save_report は労務の行の常用・請負と所属を保存し、他の行は null\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 11-10 労務=%s 現金=%s\n', n, n2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 11-10 エラー: %s\n', sqlerrm);
  end;

  -- ===== 12. 現場から協力会社の作業員を新しく登録する（update_2026-11-07b） =====
  -- d1 は X の協力会社（11-1 で追加済み）。d2 は協力会社だが X に入っていない。Y は完了。
  update public.gn_suppliers set is_partner = true where id = '00000000-0000-0000-0000-0000000000d1';
  insert into public.gn_suppliers (id, name, is_partner) values ('00000000-0000-0000-0000-0000000000d2', '検証協力会社2', true);
  insert into public.gn_site_partners (site_id, supplier_id) values (y, '00000000-0000-0000-0000-0000000000d1')
    on conflict (site_id, supplier_id) do nothing;
  begin
    perform pg_temp.as_user(v_c);
    u := public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d1', ' 検証 新規作業員 ', '鳶', 20000, null);
    perform pg_temp.as_editor();
    select count(*) into n from public.gn_workers w
     where w.id = u and w.name = '検証 新規作業員' and w.trade = '鳶' and w.affiliation = 'partner'
       and w.supplier_id = '00000000-0000-0000-0000-0000000000d1' and w.active and w.updated_by = v_c;
    -- 適用開始日＝着工日（無ければ今日の 31 日前）・最初の日報・今日（日本時間）の早い日
    select count(*) into n2 from public.gn_worker_rates r
     where r.worker_id = u and r.amount = 20000
       and r.effective_from = (
         select least(coalesce(st.start_date, (now() at time zone 'Asia/Tokyo')::date - 31),
                      coalesce((select min(report_date) from public.gn_daily_reports where site_id = x), (now() at time zone 'Asia/Tokyo')::date),
                      (now() at time zone 'Asia/Tokyo')::date)
           from public.gn_sites st where st.id = x);
    select count(*) into procedure_dummy from public.gn_site_workers sw
     where sw.site_id = x and sw.worker_id = u
       and sw.sort_order = (select max(sort_order) from public.gn_site_workers where site_id = x);
    if n = 1 and n2 = 1 and procedure_dummy = 1 then rep := rep || E'PASS 12-1 社員は現場の協力会社の作業員を新しく登録できる（マスター・日当と適用開始日・現場の登録・更新者）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-1 作業員=%s 日当=%s 現場の登録=%s\n', n, n2, procedure_dummy); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 12-1 エラー: %s\n', sqlerrm);
  end;
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d2', '検証 他社作業員', null, 20000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-2 現場に入っていない協力会社の作業員を登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'not_site_partner' then rep := rep || E'PASS 12-2 現場に入っていない協力会社では登録できない（not_site_partner）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-2 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(y, '00000000-0000-0000-0000-0000000000d1', '検証 完了現場', null, 20000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-3 完了現場で作業員を登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'site_closed' then rep := rep || E'PASS 12-3 完了現場では登録できない（site_closed）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-3 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_a);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d1', '検証 協力会社から', null, 20000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-4 協力会社のアカウントが作業員を登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'not_employee' then rep := rep || E'PASS 12-4 協力会社のアカウントは登録できない（not_employee）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-4 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d1', '   ', null, -1, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-5 名前が空・日当が負でも登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'invalid_input' then rep := rep || E'PASS 12-5 名前が空・日当が負は登録できない（invalid_input）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-5 エラー: %s\n', sqlerrm); end if;
  end;

  -- 12-6〜12-9：協力会社の印の無い会社・無効の会社・同じ名前・管理者
  insert into public.gn_suppliers (id, name, is_vendor, is_partner, active) values
    ('00000000-0000-0000-0000-0000000000d3', '検証 取引先だけ', true, false, true),
    ('00000000-0000-0000-0000-0000000000d4', '検証 無効の協力会社', false, true, false);
  insert into public.gn_site_partners (site_id, supplier_id) values
    (x, '00000000-0000-0000-0000-0000000000d3'), (x, '00000000-0000-0000-0000-0000000000d4');
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d3', '検証 取引先の人', null, 20000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-6 協力会社の印の無い会社で登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'not_site_partner' then rep := rep || E'PASS 12-6 協力会社の印の無い会社では登録できない（not_site_partner）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-6 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d4', '検証 無効会社の人', null, 20000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-7 無効の協力会社で登録できてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'not_site_partner' then rep := rep || E'PASS 12-7 無効の協力会社では登録できない（not_site_partner）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-7 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_c);
    perform public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d1', '検証 新規作業員', null, 18000, null);
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 12-8 同じ会社に同じ名前の作業員を重ねて作れてしまった\n';
  exception when others then
    perform pg_temp.as_editor();
    if sqlerrm = 'duplicate_worker' then rep := rep || E'PASS 12-8 同じ会社に同じ名前の有効な作業員がいれば作らない（duplicate_worker）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-8 エラー: %s\n', sqlerrm); end if;
  end;
  begin
    perform pg_temp.as_user(v_admin);
    u := public.gn_add_site_partner_worker(x, '00000000-0000-0000-0000-0000000000d1', '検証 管理者が登録', null, 21000, 3000);
    perform pg_temp.as_editor();
    select count(*) into n from public.gn_workers w
     where w.id = u and w.affiliation = 'partner' and w.supplier_id = '00000000-0000-0000-0000-0000000000d1'
       and w.overtime_rate = 3000 and w.updated_by = v_admin;
    select count(*) into n2 from public.gn_site_workers where site_id = x and worker_id = u;
    if n = 1 and n2 = 1 then rep := rep || E'PASS 12-9 管理者も現場の協力会社の作業員を新しく登録できる\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 12-9 作業員=%s 現場の登録=%s\n', n, n2); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 12-9 エラー: %s\n', sqlerrm);
  end;

  -- ===== 13. 件の見積中・確認者・承認者の承認解除・修正申請（update_2026-11-08） =====
  -- X は進行中：A＝協力会社の担当（staff）、B＝協力会社の確認者（6 で reviewer）。C＝社員（X の割り当てなし）。
  -- A が 11-20 の日報を作って提出し、管理者が承認する。C が 11-21 の日報を作って提出する。
  declare
    r13 uuid; r13c uuid; fr uuid;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-20', 'weather', '晴れ'), '[]'::jsonb) into r13;
    update public.gn_daily_reports set status = 'submitted' where id = r13;
    perform pg_temp.as_user(v_c);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-21', 'weather', '晴れ'), '[]'::jsonb) into r13c;
    update public.gn_daily_reports set status = 'submitted' where id = r13c;
    perform pg_temp.as_user(v_admin);
    update public.gn_daily_reports set status = 'approved', approved_by = v_admin, approved_at = now(), reviewed_by = v_admin where id = r13;
    perform pg_temp.as_editor();

    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, status) values (x, r13c, '見積を出す件', 'estimating') returning status into t;
      perform pg_temp.as_editor();
      if t = 'estimating' then rep := rep || E'PASS 13-1 見積中の件を作れる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-1 status=%s\n', t); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-1 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, status) values (x, r13c, '状態が変', 'pending');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-2 見積中・対応中・完了以外の状態で件を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '23514' then rep := rep || E'PASS 13-2 件の状態は見積中・対応中・完了だけ（check）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-2 想定外: %s\n', sqlerrm); end if;
    end;

    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_fix_requests (report_id, reason) values (r13, '写真を付け忘れた') returning id into fr;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_fix_requests
       where id = fr and site_id = x and requested_by = v_a and resolved_at is null and reason = '写真を付け忘れた';
      if n = 1 then rep := rep || E'PASS 13-3 協力会社Aは自分の承認済みの日報に修正申請を出せる（現場・申請者は DB が入れる）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-3 申請の行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-3 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_fix_requests (report_id, reason) values (r13c, '他人の日報');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-4 協力会社Aが他人の日報に修正申請を出せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_report_owner%' or sqlstate = '42501' then rep := rep || E'PASS 13-4 協力会社は他人の日報には修正申請を出せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-4 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_report_fix_requests (report_id, reason) values (r13c, 'ファイルを足したい');
      perform pg_temp.as_editor();
      rep := rep || E'PASS 13-5 社員Cは提出済みの日報に修正申請を出せる\n';
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-5 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_report_fix_requests (report_id, reason) values (r13c, '重ねて申請');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-5b 未解決の申請がある日報に、もう一つ修正申請を出せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '23505' then rep := rep || E'PASS 13-5b 未解決の修正申請は 1 つの日報に 1 つまで（一意索引）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-5b 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_fix_requests set resolved_at = now() where id = fr;
      get diagnostics n = row_count;
      delete from public.gn_report_fix_requests where id = fr;
      get diagnostics n2 = row_count;
      perform pg_temp.as_editor();
      if n = 0 and n2 = 0 then rep := rep || E'PASS 13-6 修正申請は変えられない・消せない（ポリシーなし）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-6 更新=%s 削除=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-6 エラー: %s\n', sqlerrm);
    end;

    begin
      perform pg_temp.as_user(v_a);
      update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null, reviewed_by = null where id = r13;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-7 担当（staff）Aが承認を解除できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 13-7 担当（staff）は承認を解除できない（approved_report_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-7 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null, reviewed_by = null where id = r13;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-8 割り当てのない社員Cが承認を解除できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 13-8 確認者・承認者でない社員は承認を解除できない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-8 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null, reviewed_by = null, weather = '雨' where id = r13;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-9 確認者Bが承認解除と一緒に本文も変えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 13-9 承認解除と一緒にほかの列は変えられない（approved_report_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-9 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set weather = '雨' where id = r13;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-10 確認者Bが承認済みの本文を変えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 13-10 確認者も承認済みの本文は変えられない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-10 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null, reviewed_by = null where id = r13;
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      select status into t from public.gn_daily_reports where id = r13;
      select count(*) into n2 from public.gn_report_fix_requests where id = fr and resolved_at is not null;
      if n = 1 and t = 'draft' then rep := rep || E'PASS 13-11 確認者Bは承認を解除できる（下書きに戻る）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-11 更新=%s status=%s\n', n, t); end if;
      if n2 = 1 then rep := rep || E'PASS 13-12 下書きに戻すと修正申請が解決になる\n';
      else fails := fails + 1; rep := rep || E'FAIL 13-12 下書きに戻しても修正申請が未解決のまま\n'; end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-11 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_fix_requests (report_id, reason) values (r13, '下書きに申請');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 13-13 下書きの日報に修正申請を出せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%report_not_submitted%' or sqlstate = '42501' then rep := rep || E'PASS 13-13 下書きの日報には修正申請を出せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-13 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set status = 'rejected', reviewed_by = v_b, rejected_reason = '検証の差戻し' where id = r13c;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_fix_requests where report_id = r13c and resolved_at is null;
      if n = 0 then rep := rep || E'PASS 13-14 差戻しでも修正申請が解決になる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 13-14 未解決の申請=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13-14 エラー: %s\n', sqlerrm);
    end;
    perform pg_temp.as_user(v_b);
    select count(*) into n from public.gn_report_fix_requests where site_id = x;
    perform pg_temp.as_editor();
    if n = 2 then rep := rep || E'PASS 13-15 現場のメンバーは修正申請を読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 13-15 Bに見える申請=%s\n', n); end if;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 13 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 14. 日報・件の添付（update_2026-11-09） =====
  -- X は進行中：A＝協力会社の担当、B＝協力会社の確認者、C＝社員（割り当てなし）。
  -- A が 11-24 の日報（下書き）と、その日報の件（対応中・完了）を作る。Storage の実体は SQL Editor で置く（ガードが有無を見る）。
  declare
    r14 uuid; i14 uuid; i14d uuid; s14 uuid := '00000000-0000-0000-0000-0000000000d1'; r14s uuid;
    p1 uuid := '00000000-0000-0000-0000-0000000000e1';  -- A の日報の写真
    p2 uuid := '00000000-0000-0000-0000-0000000000e2';  -- A の件の写真（提出後）
    p3 uuid := '00000000-0000-0000-0000-0000000000e3';  -- 完了した件の写真（拒否）
    p4 uuid := '00000000-0000-0000-0000-0000000000e4';  -- 提出後の日報の写真（拒否）
    p5 uuid := '00000000-0000-0000-0000-0000000000e5';  -- C が置いた実体（A が自分の添付にしようとする）
    r14b uuid; i14b uuid;
    f1 uuid := '00000000-0000-0000-0000-0000000000f1';  -- C の件のファイル
    f2 uuid := '00000000-0000-0000-0000-0000000000f2';  -- A のファイル（拒否）
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-24', 'weather', '晴れ'), '[]'::jsonb) into r14;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r14, '追加の棚') returning id into i14;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r14, '終わった件') returning id into i14d;
    update public.gn_report_issues set status = 'done', done_at = '2026-11-24' where id = i14d;
    perform pg_temp.as_editor();
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('gn-photos',    x::text || '/att/' || p5::text || '.jpg', v_c, '{"size": 300000}'::jsonb),
      ('gn-photos',    x::text || '/att/' || p1::text || '.jpg', v_a, '{"size": 300000}'::jsonb),
      ('gn-photos',    x::text || '/att/' || p2::text || '.jpg', v_a, '{"size": 300000}'::jsonb),
      ('gn-photos',    x::text || '/att/' || p3::text || '.jpg', v_a, '{"size": 300000}'::jsonb),
      ('gn-photos',    x::text || '/att/' || p4::text || '.jpg', v_a, '{"size": 300000}'::jsonb),
      ('gn-estimates', x::text || '/att/' || f1::text || '.pdf', v_c, '{"size": 900000}'::jsonb),
      ('gn-estimates', x::text || '/att/' || f2::text || '.pdf', v_c, '{"size": 900000}'::jsonb);

    -- 14-1 協力会社は下書きの日報に写真を付けられる（付けた日＝日報の日付、付けた人・現場は DB が入れる）
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, report_id, kind, storage_bucket, storage_path, name, attached_on, created_by)
      values (p1, y, r14, 'photo', 'gn-photos', x::text || '/att/' || p1::text || '.jpg', 'IMG_0001.jpg', '2000-01-01', v_c);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_attachments
       where id = p1 and site_id = x and attached_on = '2026-11-24' and created_by = v_a and client_visible = false and size_bytes = 300000;
      if n = 1 then rep := rep || E'PASS 14-1 協力会社Aは下書きの日報に写真を付けられる（現場・付けた日・付けた人・大きさは DB が入れる）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-1 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-1 エラー: %s\n', sqlerrm);
    end;

    -- 14-2 協力会社はファイルを付けられない
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (f2, x, i14, 'file', 'gn-estimates', x::text || '/att/' || f2::text || '.pdf', '見積書.pdf', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-2 協力会社Aがファイルを付けられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%file_not_allowed%' then rep := rep || E'PASS 14-2 協力会社はファイルを付けられない（file_not_allowed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-2 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-3 社員は件にファイルを付けられる（付けた日は件の日報の日付〜今日の範囲ならアプリが送った日付のまま）
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, mime, attached_on, client_visible)
      values (f1, x, i14, 'file', 'gn-estimates', x::text || '/att/' || f1::text || '.pdf', '見積書.pdf', 'application/pdf', '2026-11-24', true);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_attachments where id = f1 and attached_on = '2026-11-24' and client_visible = false and created_by = v_c;
      if n = 1 then rep := rep || E'PASS 14-3 社員Cは件にファイルを付けられる（ファイルはお客様用に載らない）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-3 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-3 エラー: %s\n', sqlerrm);
    end;

    -- 14-4・14-5 協力会社はファイルの行も、gn-estimates の実体も読めない。社員は読める
    perform pg_temp.as_user(v_a);
    select count(*) into n from public.gn_attachments where site_id = x and kind = 'file';
    select count(*) into n2 from storage.objects where bucket_id = 'gn-estimates' and name like x::text || '/att/%';
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 14-4 協力会社Aにはファイルの行が見えない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 14-4 Aに見えるファイルの行=%s\n', n); end if;
    if n2 = 0 then rep := rep || E'PASS 14-5 協力会社Aは gn-estimates の実体を読めない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 14-5 Aに見える gn-estimates の実体=%s\n', n2); end if;
    perform pg_temp.as_user(v_c);
    select count(*) into n from public.gn_attachments where site_id = x and kind = 'file';
    select count(*) into n2 from storage.objects where bucket_id = 'gn-estimates' and name like x::text || '/att/%';
    perform pg_temp.as_editor();
    if n = 1 and n2 = 2 then rep := rep || E'PASS 14-6 社員Cはファイルの行と gn-estimates の実体を読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 14-6 Cに見える ファイルの行=%s 実体=%s\n', n, n2); end if;

    -- 14-7 協力会社は gn-estimates に置けない
    begin
      perform pg_temp.as_user(v_a);
      insert into storage.objects (bucket_id, name, owner) values ('gn-estimates', x::text || '/att/partner.pdf', v_a);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-7 協力会社Aが gn-estimates に置けた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '42501' and sqlerrm like '%row-level security%' then rep := rep || E'PASS 14-7 協力会社は gn-estimates に置けない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-7 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-8 提出した日報には足せないが、同じ日報の件には足せる
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set status = 'submitted' where id = r14;
    perform pg_temp.as_editor();
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, report_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p4, x, r14, 'photo', 'gn-photos', x::text || '/att/' || p4::text || '.jpg', '後から.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-8 提出した日報に写真を足せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%report_locked%' then rep := rep || E'PASS 14-8 提出した日報には添付を足せない（report_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-8 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on, client_visible)
      values (p2, x, i14, 'photo', 'gn-photos', x::text || '/att/' || p2::text || '.jpg', '棚.jpg', '2000-01-01', true);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_attachments
       where id = p2 and client_visible = true and attached_on = (now() at time zone 'Asia/Tokyo')::date;
      if n = 1 then rep := rep || E'PASS 14-9 提出した日報の件には写真を足せる（件の日報より前の付けた日は今日にそろえる）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-9 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-9 エラー: %s\n', sqlerrm);
    end;

    -- 14-10 完了した件には足せない
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p3, x, i14d, 'photo', 'gn-photos', x::text || '/att/' || p3::text || '.jpg', '完了後.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-10 完了した件に写真を足せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_done%' then rep := rep || E'PASS 14-10 完了した件には添付を足せない（issue_done）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-10 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-11 他人の添付は消せない（協力会社B が A の写真を消す → 0 行）
    begin
      perform pg_temp.as_user(v_b);
      delete from public.gn_attachments where id = p2;
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      select count(*) into n2 from public.gn_attachments where id = p2;
      if n = 0 and n2 = 1 then rep := rep || E'PASS 14-11 他人の添付は消せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-11 削除=%s 残り=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_attachment_owner%' then rep := rep || E'PASS 14-11 他人の添付は消せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-11 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-12 提出した日報の添付は本人でも消せない
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_attachments where id = p1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-12 提出した日報の添付を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%report_locked%' then rep := rep || E'PASS 14-12 提出した日報の添付は消せない（report_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-12 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-13 お客様用に載せるかの切り替え：付けた本人でない協力会社 B は 0 行、付けた本人 A と社員 C はできる（提出後も）
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_attachments set client_visible = true where id = p1;
      get diagnostics n = row_count;
      perform pg_temp.as_user(v_a);
      update public.gn_attachments set client_visible = true where id = p1;
      get diagnostics n2 = row_count;
      perform pg_temp.as_editor();
      if n = 0 and n2 = 1 then rep := rep || E'PASS 14-13 お客様用の切り替えは付けた本人はできる・ほかの協力会社はできない（提出後も）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-13 B=%s A=%s\n', n, n2); end if;
      perform pg_temp.as_user(v_c);
      update public.gn_attachments set client_visible = false where id = p1;
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      if n = 1 then rep := rep || E'PASS 14-14 社員は他人の写真のお客様用を切り替えられる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-14 C=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-13 エラー: %s\n', sqlerrm);
    end;

    -- 14-15 お客様用以外の列は変えられない
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_attachments set name = '名前を変えた' where id = p1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-15 添付の名前を変えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%attachment_readonly%' then rep := rep || E'PASS 14-15 添付はお客様用に載せるかだけ変えられる（attachment_readonly）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-15 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-16 ファイルはお客様用に載せられない
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_attachments set client_visible = true where id = f1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-16 ファイルをお客様用に載せられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '23514' then rep := rep || E'PASS 14-16 ファイルはお客様用に載せられない（check）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-16 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-17 リンクは http/https だけ
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (site_id, issue_id, kind, url, name, attached_on) values (x, i14, 'link', 'javascript:alert(1)', '悪いリンク', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-17 http/https 以外のリンクを付けられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '23514' then rep := rep || E'PASS 14-17 リンクは http/https だけ（check）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-17 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (site_id, issue_id, kind, url, name, attached_on) values (x, i14, 'link', 'https://drive.google.com/x', 'G ドライブ', '2026-11-24');
      perform pg_temp.as_editor(); rep := rep || E'PASS 14-18 協力会社は件にリンクを付けられる\n';
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-18 エラー: %s\n', sqlerrm);
    end;

    -- 14-19 パスが規約と違う・実体が無いものは行を作れない
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p3, x, i14, 'photo', 'gn-photos', x::text || '/att/' || p1::text || '.jpg', '他の写真.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-19 規約と違うパスで行を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_storage_path%' then rep := rep || E'PASS 14-19 パスが規約と違えば拒否（invalid_storage_path）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-19 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      select x, i14, 'photo', 'gn-photos', x::text || '/att/' || g::text || '.jpg', '無い写真.jpg', '2026-11-24'
        from (select gen_random_uuid() as g) s;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-20 実体の無い写真の行を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      -- id は既定値（別の uuid）になるのでパスと合わず invalid_storage_path、合っても実体が無ければ storage_object_missing
      if sqlerrm like '%invalid_storage_path%' or sqlerrm like '%storage_object_missing%' then
        rep := rep || E'PASS 14-20 実体の無い写真の行は作れない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-20 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values ('00000000-0000-0000-0000-0000000000e9', x, i14, 'photo', 'gn-photos', x::text || '/att/00000000-0000-0000-0000-0000000000e9.jpg', '無い写真.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-21 実体の無い写真の行を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%storage_object_missing%' then rep := rep || E'PASS 14-21 実体が無ければ拒否（storage_object_missing）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-21 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-22 本人は件（完了前）の添付を消せる。件が完了すると消せない
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set status = 'done', done_at = '2026-11-26' where id = i14;
      perform pg_temp.as_user(v_c);
      delete from public.gn_attachments where id = f1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-22 完了した件の添付を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_done%' then rep := rep || E'PASS 14-22 完了した件の添付は消せない（issue_done）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-22 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set status = 'open', done_at = null where id = i14;
      perform pg_temp.as_user(v_a);
      delete from public.gn_attachments where id = p2;
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      if n = 1 then rep := rep || E'PASS 14-23 付けた本人は完了前の件の添付を消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-23 削除=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-23 エラー: %s\n', sqlerrm);
    end;

    -- 14-24 完了した現場には付けられない（管理者も）
    begin
      insert into public.gn_sites (id, name) values (s14, '検証現場S14');
      insert into public.gn_daily_reports (site_id, report_date) values (s14, '2026-11-24') returning id into r14s;
      update public.gn_sites set status = 'done' where id = s14;
      perform pg_temp.as_user(v_admin);
      insert into public.gn_attachments (site_id, report_id, kind, url, name, attached_on) values (s14, r14s, 'link', 'https://example.com', 'リンク', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-24 完了した現場に添付を付けられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%site_closed%' then rep := rep || E'PASS 14-24 完了した現場には付けられない（site_closed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-24 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-25 協力会社も gn-photos の <現場>/att/ と <現場>/sign/ には置ける
    begin
      perform pg_temp.as_user(v_a);
      insert into storage.objects (bucket_id, name, owner) values
        ('gn-photos', x::text || '/att/' || gen_random_uuid()::text || '.jpg', v_a),
        ('gn-photos', x::text || '/sign/' || gen_random_uuid()::text || '.png', v_a);
      perform pg_temp.as_editor(); rep := rep || E'PASS 14-25 協力会社Aは gn-photos の att・sign に置ける\n';
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-25 エラー: %s\n', sqlerrm);
    end;

    -- 14-26 att・sign 以外の場所には、現場メンバーでも置けない（社員も）
    begin
      perform pg_temp.as_user(v_c);
      insert into storage.objects (bucket_id, name, owner) values ('gn-photos', x::text || '/other/x.png', v_c);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-26 gn-photos の <現場>/other/ に置けた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '42501' and sqlerrm like '%row-level security%' then rep := rep || E'PASS 14-26 gn-photos の att・sign 以外には置けない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-26 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-27 ほかの現場の場所：置けない・その場所のパスで行を作れない
    begin
      perform pg_temp.as_user(v_a);
      insert into storage.objects (bucket_id, name, owner) values ('gn-photos', y::text || '/att/' || gen_random_uuid()::text || '.jpg', v_a);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-27 協力会社Aがほかの現場Yに置けた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '42501' and sqlerrm like '%row-level security%' then rep := rep || E'PASS 14-27 ほかの現場の場所には置けない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-27 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p3, x, i14, 'photo', 'gn-photos', y::text || '/att/' || p3::text || '.jpg', '別の現場.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-28 ほかの現場のパスで行を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_storage_path%' then rep := rep || E'PASS 14-28 ほかの現場のパスでは行を作れない（invalid_storage_path）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-28 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-29 他人が置いた実体は自分の添付にできない
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p5, x, i14, 'photo', 'gn-photos', x::text || '/att/' || p5::text || '.jpg', '他人の写真.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-29 他人が置いた実体を自分の添付にできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%storage_object_not_owned%' then rep := rep || E'PASS 14-29 他人が置いた実体は付けられない（storage_object_not_owned）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-29 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-30 同じ id でもう一度付ける（二度押し）と attachment_exists
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (id, site_id, issue_id, kind, storage_bucket, storage_path, name, attached_on)
      values (p1, x, i14, 'photo', 'gn-photos', x::text || '/att/' || p1::text || '.jpg', 'IMG_0001.jpg', '2026-11-24');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 14-30 同じ id の添付をもう一度作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%attachment_exists%' then rep := rep || E'PASS 14-30 同じ id はもう一度付けられない（attachment_exists）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-30 想定外: %s\n', sqlerrm); end if;
    end;

    -- 14-31 日報を消すと、他人の添付・件の添付も一緒に消える（連鎖削除はガードで止めない）
    begin
      perform pg_temp.as_user(v_a);
      select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-27', 'weather', '晴れ'), '[]'::jsonb) into r14b;
      insert into public.gn_report_issues (site_id, report_id, body) values (x, r14b, '消す日報の件') returning id into i14b;
      insert into public.gn_attachments (site_id, report_id, kind, url, name, attached_on) values (x, r14b, 'link', 'https://a.example', 'A のリンク', '2026-11-27');
      insert into public.gn_attachments (site_id, issue_id, kind, url, name, attached_on) values (x, i14b, 'link', 'https://b.example', '件のリンク', '2026-11-27');
      perform pg_temp.as_user(v_c);
      insert into public.gn_attachments (site_id, report_id, kind, url, name, attached_on) values (x, r14b, 'link', 'https://c.example', 'C のリンク', '2026-11-27');
      perform pg_temp.as_user(v_a);
      delete from public.gn_daily_reports where id = r14b;
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      select count(*) into n2 from public.gn_attachments where report_id = r14b or issue_id = i14b;
      if n = 1 and n2 = 0 then rep := rep || E'PASS 14-31 日報を消すと他人の添付・件の添付も一緒に消える\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 14-31 日報の削除=%s 残った添付=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14-31 エラー: %s\n', sqlerrm);
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 14 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 終わり：すべて取り消す =====
  raise exception using message = format(E'VERIFY_RLS 結果: FAIL %s 件\n%s', fails, rep);
end $$;
