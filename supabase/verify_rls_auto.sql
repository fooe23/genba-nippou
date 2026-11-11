-- gn_ スキーマの権限・ガードの自動検証（verify_rls.md の手順 0〜9 を 1 本にまとめたもの。10 は客先確認のガード例外［update_2026-11-04c］、11 は作業員の所属・現場の協力会社［update_2026-11-07］、12 は現場からの協力会社の作業員の登録［update_2026-11-07b］、13 は件の見積中・承認解除・修正申請［update_2026-11-08］、14 は日報・件の添付［update_2026-11-09］、15 はお客様のサイン［update_2026-11-10］、16 は現場判断の件・指示なし、17 は件の直し・削除［update_2026-11-11］、18 は件ごとのお客様確認［update_2026-11-13］、19 は件の見積提出の記録［update_2026-11-14］、20 は積算連携の工種・元請けの内訳・実行予算・読み替え表・進み具合［update_2026-11-15］、21 は現場のお金の列［update_2026-11-16］、22 は外注の買掛・行の根拠の件・請負の会社の一覧［update_2026-11-17］、23 は名前なし（会社と人数）の作業員の行［update_2026-11-19］、24 は件の見積書［update_2026-11-20］）
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

  -- ===== 15. お客様のサイン（update_2026-11-10） =====
  -- X は進行中：A＝協力会社の担当、B＝協力会社の確認者（reviewer）、C＝社員。A が 11-28 の日報を作って提出する。
  -- サインの画像と PDF の実体は SQL Editor で置く（関数が有無・置いた人を見る）。
  declare
    r15 uuid; r15s uuid; s15 uuid := '00000000-0000-0000-0000-0000000000d2';
    g1 text; g2 text; g3 text; pdf1 text; pdf2 text; pdf3 text; ts2 timestamptz;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-28', 'weather', '晴れ'), '[]'::jsonb) into r15;
    update public.gn_daily_reports set status = 'submitted' where id = r15;
    perform pg_temp.as_editor();
    g1 := x::text || '/sign/' || gen_random_uuid()::text || '.png';   -- A が置いたサイン
    g2 := x::text || '/sign/' || gen_random_uuid()::text || '.png';   -- C が置いたサイン（A は使えない）
    pdf1 := x::text || '/signed/' || r15::text || '-1793930338000.pdf';
    pdf2 := x::text || '/signed/' || r15::text || '-1793930339000.pdf';
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('gn-photos',  g1,   v_a, '{"size": 20000}'::jsonb),
      ('gn-photos',  g2,   v_c, '{"size": 20000}'::jsonb),
      ('gn-exports', pdf1, v_a, '{"size": 300000}'::jsonb),
      ('gn-exports', pdf2, v_c, '{"size": 300000}'::jsonb);

    -- 15-1 他人が置いた画像・PDF、ほかの現場のパスではサインを保存できない
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r15, '佐藤様', '', now(), g2, pdf1);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-1 他人が置いたサインの画像で保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%storage_object_not_owned%' then rep := rep || E'PASS 15-1 他人が置いたサインの画像では保存できない（storage_object_not_owned）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-1 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r15, '佐藤様', '', now(), y::text || '/sign/' || gen_random_uuid()::text || '.png', pdf1);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-2 ほかの現場のパスで保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_storage_path%' then rep := rep || E'PASS 15-2 ほかの現場のパスでは保存できない（invalid_storage_path）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-2 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-3 協力会社の担当 A は提出済みの日報にサインを保存できる（確認者・日時・メモも入る）
    begin
      perform pg_temp.as_user(v_a);
      select public.gn_save_client_signature(r15, ' 施主 佐藤様 ', '手すり位置OK', now(), g1, pdf1) into ts2;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports
       where id = r15 and client_signature_path = g1 and client_signed_pdf_path = pdf1 and client_signed_by = v_a
         and client_confirmed_by = '施主 佐藤様' and client_confirmed_note = '手すり位置OK'
         and client_confirmed_at = client_signed_at and updated_at = ts2;
      if n = 1 then rep := rep || E'PASS 15-3 現場メンバーはサインを保存できる（確認者・日時・メモも固定）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-3 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-3 エラー: %s\n', sqlerrm);
    end;

    -- 15-4 サインは 1 回だけ
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_client_signature(r15, '別の人', '', now(), g2, pdf2);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-4 2 回目のサインを保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%signature_exists%' then rep := rep || E'PASS 15-4 サインは 1 回だけ（signature_exists）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-4 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-5 サインの列は直接変えられない（管理者も）
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_daily_reports set client_signature_path = null where id = r15;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-5 管理者がサインの列を直接消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%signature_locked%' then rep := rep || E'PASS 15-5 サインの列は直接変えられない（signature_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-5 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-6 サインがある間は客先確認を変えられない（担当者も管理者も）
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_daily_reports set client_confirmed_by = null, client_confirmed_at = null, client_confirmed_note = null where id = r15;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-6 サインがあるのに担当者が客先確認を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%signature_locked%' then rep := rep || E'PASS 15-6 サインがある間は担当者は客先確認を消せない（signature_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-6 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_daily_reports set client_confirmed_by = '書き換え' where id = r15;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-7 サインがあるのに管理者が確認者を書き換えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%signature_locked%' then rep := rep || E'PASS 15-7 サインがある間は管理者も確認者を書き換えられない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-7 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-8 承認・承認解除・差戻しでサインは消えない
    begin
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set status = 'approved', approved_by = v_b, approved_at = now(), reviewed_by = v_b where id = r15;
      update public.gn_daily_reports set status = 'draft', approved_by = null, approved_at = null where id = r15;
      perform pg_temp.as_user(v_a);
      update public.gn_daily_reports set status = 'submitted' where id = r15;
      perform pg_temp.as_user(v_b);
      update public.gn_daily_reports set status = 'rejected', rejected_reason = '写真を足す', reviewed_by = v_b where id = r15;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports
       where id = r15 and status = 'rejected' and client_signature_path = g1 and client_signed_pdf_path = pdf1 and client_confirmed_by = '施主 佐藤様';
      if n = 1 then rep := rep || E'PASS 15-8 承認・承認解除・差戻しでサインと客先確認は残る\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-8 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-8 エラー: %s\n', sqlerrm);
    end;

    -- 15-9 日報の保存（gn_save_report）でもサインは残る
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-11-28', 'weather', '曇り'), '[]'::jsonb);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports where id = r15 and weather = '曇り' and client_signature_path = g1;
      if n = 1 then rep := rep || E'PASS 15-9 日報を保存し直してもサインは残る\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-9 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-9 エラー: %s\n', sqlerrm);
    end;

    -- 15-10 サインのある日報は消せない（管理者も）
    begin
      perform pg_temp.as_user(v_admin);
      delete from public.gn_daily_reports where id = r15;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-10 サインのある日報を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%report_signed%' then rep := rep || E'PASS 15-10 サインのある日報は消せない（report_signed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-10 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-11 サインの画像・サインした時点の PDF は置いた本人も消せない
    begin
      perform pg_temp.as_user(v_a);
      delete from storage.objects where bucket_id = 'gn-photos' and name = g1;
      get diagnostics n = row_count;
      delete from storage.objects where bucket_id = 'gn-exports' and name = pdf1;
      get diagnostics n2 = row_count;
      perform pg_temp.as_editor();
      if n = 0 and n2 = 0 then rep := rep || E'PASS 15-11 サインの画像・PDF は置いた本人も消せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-11 画像=%s PDF=%s\n', n, n2); end if;
    exception when others then
      -- Storage の版によっては SQL からの直接の削除そのものをトリガーが止める。そのときはポリシーの条件で確かめる
      perform pg_temp.as_editor();
      select count(*) into n from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('gn_photos_delete','gn_exports_delete') and qual like '%/sign%';
      if n = 2 then rep := rep || format(E'PASS 15-11 サインの画像・PDF の削除はポリシーで止めている（直接の削除は %s）\n', sqlerrm);
      else fails := fails + 1; rep := rep || format(E'FAIL 15-11 エラー: %s ポリシー=%s\n', sqlerrm, n); end if;
    end;

    -- 15-12 取り消しは管理者だけ、理由必須
    begin
      perform pg_temp.as_user(v_b);
      perform public.gn_revoke_client_signature(r15, '確認者の間違い');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-12 確認者（管理者でない）がサインを取り消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_admin%' then rep := rep || E'PASS 15-12 管理者でなければ取り消せない（not_admin）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-12 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_admin);
      perform public.gn_revoke_client_signature(r15, '   ');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-13 理由なしで取り消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_revoke_reason%' then rep := rep || E'PASS 15-13 取り消しは理由必須（invalid_revoke_reason）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-13 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-14 管理者は理由付きで取り消せる。PDF のパスは記録に残り、客先確認も残る（取り消した後は変えられる）
    begin
      perform pg_temp.as_user(v_admin);
      perform public.gn_revoke_client_signature(r15, '確認者の名前の間違い');
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports
       where id = r15 and client_signature_path is null and client_signed_pdf_path is null
         and client_signature_revoked_by = v_admin and client_signature_revoke_reason = '確認者の名前の間違い'
         and jsonb_array_length(client_signature_history) = 1
         and client_signature_history->0->>'pdf_path' = pdf1 and client_signature_history->0->>'path' = g1
         and client_signature_history->0->>'reason' = '確認者の名前の間違い'
         and client_confirmed_by = '施主 佐藤様';
      perform pg_temp.as_user(v_a);
      update public.gn_daily_reports set client_confirmed_by = '施主 佐藤 様' where id = r15;
      get diagnostics n2 = row_count;
      perform pg_temp.as_editor();
      if n = 1 and n2 = 1 then rep := rep || E'PASS 15-14 管理者は理由付きで取り消せる（PDF は記録に残る・その後は客先確認を直せる）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-14 行=%s 直し=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-14 エラー: %s\n', sqlerrm);
    end;

    -- 15-15 取り消したサインの画像・PDF はもう一度使えない。新しい画像なら取り直せる
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r15, '佐藤様', '', now(), g1, pdf1);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-15 取り消したサインの画像をもう一度使えた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_storage_path%' then rep := rep || E'PASS 15-15 取り消したサインの画像・PDF はもう一度使えない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-15 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      g3 := x::text || '/sign/' || gen_random_uuid()::text || '.png';
      pdf3 := x::text || '/signed/' || r15::text || '-1793930340000.pdf';
      insert into storage.objects (bucket_id, name, owner, metadata) values
        ('gn-photos', g3, v_c, '{"size": 20000}'::jsonb), ('gn-exports', pdf3, v_c, '{"size": 300000}'::jsonb);
      perform pg_temp.as_user(v_c);
      perform public.gn_save_client_signature(r15, '施主 佐藤 様', '', now(), g3, pdf3);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports where id = r15 and client_signature_path = g3 and jsonb_array_length(client_signature_history) = 1;
      if n = 1 then rep := rep || E'PASS 15-16 取り消した後は新しいサインを取り直せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-16 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-16 エラー: %s\n', sqlerrm);
    end;

    -- 15-17 承認済み・完了した現場の日報にもサインできる（社員 C）
    begin
      insert into public.gn_sites (id, name) values (s15, '検証現場S15');
      insert into public.gn_daily_reports (site_id, report_date, client_signature_path) values (s15, '2026-11-28', 'x') returning id into r15s;
      select count(*) into n from public.gn_daily_reports where id = r15s and client_signature_path is null;
      perform pg_temp.as_user(v_admin);
      update public.gn_daily_reports set status = 'approved', approved_by = v_admin, approved_at = now() where id = r15s;
      perform pg_temp.as_editor();
      update public.gn_sites set status = 'done' where id = s15;
      insert into storage.objects (bucket_id, name, owner, metadata) values
        ('gn-photos', s15::text || '/sign/00000000-0000-0000-0000-0000000000f9.png', v_c, '{"size": 20000}'::jsonb),
        ('gn-exports', s15::text || '/signed/' || r15s::text || '-1.pdf', v_c, '{"size": 300000}'::jsonb);
      perform pg_temp.as_user(v_c);
      perform public.gn_save_client_signature(r15s, '施主様', '', now(),
        s15::text || '/sign/00000000-0000-0000-0000-0000000000f9.png', s15::text || '/signed/' || r15s::text || '-1.pdf');
      perform pg_temp.as_editor();
      select count(*) into n2 from public.gn_daily_reports where id = r15s and client_signature_path is not null and status = 'approved';
      if n = 1 and n2 = 1 then rep := rep || E'PASS 15-17 承認済み・完了した現場の日報にもサインできる（insert ではサインの列は空になる）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-17 insert=%s サイン=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-17 エラー: %s\n', sqlerrm);
    end;

    -- 15-18 協力会社はほかの現場（Y）の日報にはサインできない
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r15s, '施主様', '', now(), g1, pdf1);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 15-18 割り当ての無い現場の日報にサインできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%report_not_found%' then rep := rep || E'PASS 15-18 割り当ての無い現場の日報にはサインできない（report_not_found）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-18 想定外: %s\n', sqlerrm); end if;
    end;

    -- 15-19 協力会社は gn-exports の台帳の出力（xlsm など）を読めない。サインした時点の PDF（signed/）は自分の現場なら読める。社員は台帳を読める
    begin
      insert into storage.objects (bucket_id, name, owner, metadata) values
        ('gn-exports', x::text || '/2026-11/daicho_v34_2026-11.xlsm', v_c, '{"size": 500000}'::jsonb);
      perform pg_temp.as_user(v_a);
      select count(*) into n from storage.objects where bucket_id = 'gn-exports' and name = x::text || '/2026-11/daicho_v34_2026-11.xlsm';
      select count(*) into n2 from storage.objects where bucket_id = 'gn-exports' and name = pdf1;
      perform pg_temp.as_user(v_c);
      select count(*) into num from storage.objects where bucket_id = 'gn-exports' and name = x::text || '/2026-11/daicho_v34_2026-11.xlsm';
      perform pg_temp.as_editor();
      if n = 0 and n2 = 1 and num = 1 then rep := rep || E'PASS 15-19 協力会社は台帳の出力を読めず、サインした時点の PDF は読める（社員は台帳を読める）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-19 A の台帳=%s A の PDF=%s C の台帳=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-19 エラー: %s\n', sqlerrm);
    end;

    -- 15-20 協力会社 A は割り当ての無い現場（S15）のサインした時点の PDF を読めない
    begin
      perform pg_temp.as_user(v_a);
      select count(*) into n from storage.objects where bucket_id = 'gn-exports' and name like s15::text || '/signed/%';
      perform pg_temp.as_editor();
      if n = 0 then rep := rep || E'PASS 15-20 協力会社は割り当ての無い現場のサインした時点の PDF を読めない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 15-20 読めた=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15-20 エラー: %s\n', sqlerrm);
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 15 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 16. 現場判断（要協議）の件・指示なし（現場判断）（update_2026-11-11） =====
  -- A（現場 X の担当）が 12-15 の日報を作り、種別 site_judgment・指示方法 site の件と、指示方法 site の作業内容の行を保存する。
  declare
    r16 uuid; i16 uuid;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-15', 'weather', '晴れ'), '[]'::jsonb) into r16;
    perform pg_temp.as_editor();

    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, kind, instruction_method)
        values (x, r16, '下地が傷んでいたので補修', 'site_judgment', 'site') returning id into i16;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i16 and kind = 'site_judgment' and instruction_method = 'site' and instructed_by is null;
      if n = 1 then rep := rep || E'PASS 16-1 種別「現場判断（要協議）」・指示方法「指示なし」（指示者なし）の件を作れる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 16-1 件の行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 16-1 エラー: %s\n', sqlerrm);
    end;

    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(
        jsonb_build_object('site_id', x, 'report_date', '2026-12-15', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object(
          'kind', 'work', 'sort_order', 0, 'trade', '大工', 'description', '下地の補修', 'qty', 1, 'unit', '式',
          'unit_price', 10000, 'man_days', 0.5, 'source', 'extra',
          'change_kind', 'extra', 'instruction_method', 'site', 'issue_id', i16)));
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_lines where report_id = r16 and kind = 'work' and instruction_method = 'site' and issue_id = i16;
      if n = 1 then rep := rep || E'PASS 16-2 作業内容の行に指示方法「指示なし」と現場判断の件を付けて保存できる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 16-2 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 16-2 エラー: %s\n', sqlerrm);
    end;

    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, kind) values (x, r16, '種別が変', 'judgment');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 16-3 決まりに無い種別で件を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '23514' then rep := rep || E'PASS 16-3 決まりに無い種別は check で断る\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 16-3 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 16 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 17. 件の直し・削除（update_2026-11-11） =====
  -- A（協力会社・現場 X の担当）が 12-16 の日報（下書き）と件 a〜d を、C（社員）が 12-17 の日報と件 e を作る。
  declare
    r17 uuid; r17c uuid; i17a uuid; i17b uuid; i17c uuid; i17d uuid; i17e uuid;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-16', 'weather', '晴れ'), '[]'::jsonb) into r17;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r17, '棚を 2 台') returning id into i17a;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r17, '行が使う件') returning id into i17b;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r17, '添付のある件') returning id into i17c;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r17, '消す件') returning id into i17d;
    perform pg_temp.as_user(v_c);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-17', 'weather', '晴れ'), '[]'::jsonb) into r17c;
    insert into public.gn_report_issues (site_id, report_id, body) values (x, r17c, '社員の日報の件') returning id into i17e;
    perform pg_temp.as_editor();

    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set body = '棚を 3 台に', kind = 'increase', instructed_by = '施主', instruction_method = 'oral', amount_estimate = 30000 where id = i17a;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i17a and body = '棚を 3 台に' and kind = 'increase' and amount_estimate = 30000;
      if n = 1 then rep := rep || E'PASS 17-1 下書きの日報の件は、内容・種別・指示・金額見込みを直せる（協力会社が自分の日報で）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-1 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17-1 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_issues where id = i17d;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i17d;
      if n = 0 then rep := rep || E'PASS 17-2 下書きの日報の件は消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-2 残った=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17-2 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(
        jsonb_build_object('site_id', x, 'report_date', '2026-12-16', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'work', 'sort_order', 0, 'trade', '大工', 'description', '棚', 'qty', 1, 'unit', '台',
          'unit_price', 10000, 'man_days', 0.5, 'source', 'extra', 'change_kind', 'extra', 'issue_id', i17b)));
      delete from public.gn_report_issues where id = i17b;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-3 作業内容の行が根拠の件にしている件の削除が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_in_use%' then rep := rep || E'PASS 17-3 作業内容の行が根拠の件にしている件の削除は断る（issue_in_use）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-3 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_attachments (site_id, issue_id, kind, url, name, attached_on) values (x, i17c, 'link', 'https://example.com/a', '図面', '2026-12-16');
      delete from public.gn_report_issues where id = i17c;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-4 写真・資料が付いている件の削除が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_has_attachments%' then rep := rep || E'PASS 17-4 写真・資料が付いている件の削除は断る（issue_has_attachments）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-4 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set body = '書き換え' where id = i17e;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-5 協力会社が、ほかの人が作った日報の件を直すのが通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_not_own%' then rep := rep || E'PASS 17-5 協力会社が、ほかの人が作った日報の件を直すのは断る（issue_not_own）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-5 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_issues where id = i17e;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-6 協力会社が、ほかの人が作った日報の件を消すのが通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_not_own%' then rep := rep || E'PASS 17-6 協力会社が、ほかの人が作った日報の件を消すのは断る（issue_not_own）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-6 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set body = '社員が直す' where id = i17e;
      delete from public.gn_report_issues where id = i17e;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i17e;
      if n = 0 then rep := rep || E'PASS 17-7 社員は、ほかの人が作った下書きの日報の件も直せる・消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-7 残った=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17-7 エラー: %s\n', sqlerrm);
    end;
    perform pg_temp.as_user(v_a);
    update public.gn_daily_reports set status = 'submitted' where id = r17;
    perform pg_temp.as_editor();
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set body = '提出後に書き換え' where id = i17a;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-8 提出済みの日報の件の内容の変更が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_locked%' then rep := rep || E'PASS 17-8 提出済みの日報の件の内容の変更は断る（issue_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-8 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_issues where id = i17a;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-9 提出済みの日報の件の削除が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_locked%' then rep := rep || E'PASS 17-9 提出済みの日報の件の削除は断る（issue_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-9 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set status = 'estimating' where id = i17a;
      perform pg_temp.as_editor();
      select status into t from public.gn_report_issues where id = i17a;
      if t = 'estimating' then rep := rep || E'PASS 17-10 提出済みの日報の件でも、状態は今までどおり変えられる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-10 status=%s\n', t); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17-10 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_daily_reports set status = 'rejected', reviewed_by = v_admin, rejected_reason = '件を直して' where id = r17;
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set body = '差戻し後に直す' where id = i17a;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i17a and body = '差戻し後に直す';
      if n = 1 then rep := rep || E'PASS 17-11 差戻しの日報の件は、また直せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-11 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17-11 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set report_id = gen_random_uuid() where id = i17a;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 17-12 件の日報の付け替えが通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_report_fixed%' then rep := rep || E'PASS 17-12 件の日報（report_id）は付け替えられない（issue_report_fixed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 17-12 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 17 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 18. 件ごとのお客様確認（update_2026-11-13） =====
  -- A（現場 X の協力会社の担当）が 12-19・12-20 の日報と件を作る。管理者が A の割り当ての無い現場 S18 の日報と件を作る。
  -- サインの画像と PDF の実体は SQL Editor で置く（関数が有無・置いた人を見る）。
  declare
    s18 uuid := '00000000-0000-0000-0000-0000000000d3';
    r18 uuid; r18p uuid; r18y uuid; i18a uuid; i18r uuid; i18p uuid; i18y uuid;
    r18c uuid; r18d uuid; i18c uuid;
    g18 text; g18b text; pdf18 text; pdf18b text; ts18 timestamptz;
    g18c text; pdf18p text; g18d text; pdf18d text;
  begin
    insert into public.gn_sites (id, name) values (s18, '検証現場S18');
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-19', 'weather', '晴れ'), '[]'::jsonb) into r18p;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (x, r18p, '前の日の対応中の件', 'change') returning id into i18p;
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-20', 'weather', '晴れ'), '[]'::jsonb) into r18;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (x, r18, '棚を追加', 'extra') returning id into i18a;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (x, r18, '自社の手直し', 'rework') returning id into i18r;
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-22', 'weather', '晴れ'), '[]'::jsonb) into r18c;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (x, r18c, '前の日の見積の件', 'extra') returning id into i18c;
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-23', 'weather', '晴れ'), '[]'::jsonb) into r18d;
    perform pg_temp.as_user(v_admin);
    select public.gn_save_report(jsonb_build_object('site_id', s18, 'report_date', '2026-12-20', 'weather', '晴れ'), '[]'::jsonb) into r18y;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (s18, r18y, 'ほかの現場の件', 'extra') returning id into i18y;
    perform pg_temp.as_editor();
    g18 := x::text || '/sign/' || gen_random_uuid()::text || '.png';
    g18b := x::text || '/sign/' || gen_random_uuid()::text || '.png';
    pdf18 := x::text || '/signed/' || r18::text || '-1796000000000.pdf';
    pdf18b := x::text || '/signed/' || r18::text || '-1796000001000.pdf';
    g18c := x::text || '/sign/' || gen_random_uuid()::text || '.png';
    g18d := x::text || '/sign/' || gen_random_uuid()::text || '.png';
    pdf18p := x::text || '/signed/' || r18p::text || '-1796000002000.pdf';
    pdf18d := x::text || '/signed/' || r18d::text || '-1796000003000.pdf';
    insert into storage.objects (bucket_id, name, owner, metadata) values
      ('gn-photos',  g18,    v_a, '{"size": 20000}'::jsonb),
      ('gn-photos',  g18b,   v_a, '{"size": 20000}'::jsonb),
      ('gn-exports', pdf18,  v_a, '{"size": 300000}'::jsonb),
      ('gn-exports', pdf18b, v_a, '{"size": 300000}'::jsonb),
      ('gn-photos',  g18c,   v_a, '{"size": 20000}'::jsonb),
      ('gn-photos',  g18d,   v_a, '{"size": 20000}'::jsonb),
      ('gn-exports', pdf18p, v_a, '{"size": 300000}'::jsonb),
      ('gn-exports', pdf18d, v_a, '{"size": 300000}'::jsonb),
      ('gn-photos',  s18::text || '/sign/00000000-0000-0000-0000-0000000000f8.png', v_admin, '{"size": 20000}'::jsonb),
      ('gn-exports', s18::text || '/signed/' || r18y::text || '-1.pdf', v_admin, '{"size": 300000}'::jsonb);

    -- 18-1 ほかの現場の件・やり直しの件・無い件・null を含む一覧ではサインを保存できない（サインも入らない）
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18, '施主様', '', now(), g18, pdf18, null, array[i18a, i18y]);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-1 ほかの現場の件で確認を記録できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_issue%' then rep := rep || E'PASS 18-1 ほかの現場の件は記録できない（invalid_issue）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-1 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18, '施主様', '', now(), g18, pdf18, null, array[i18r]);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-2 やり直しの件で確認を記録できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_issue%' then rep := rep || E'PASS 18-2 やり直しの件は記録できない（invalid_issue）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-2 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18, '施主様', '', now(), g18, pdf18, null, array[i18a, gen_random_uuid()]);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-3 無い件で確認を記録できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%invalid_issue%' then rep := rep || E'PASS 18-3 無い件は記録できない（invalid_issue）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-3 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18, '施主様', '', now(), g18, pdf18, null, array[i18a, null]::uuid[]);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-4 null を含む一覧で記録できた\n';
    exception when others then
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_daily_reports where id = r18 and client_signature_path is null;
      if sqlerrm like '%invalid_issue%' and n = 1 then rep := rep || E'PASS 18-4 null を含む一覧は記録できない（invalid_issue）。断ったときはサインも入らない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-4 想定外: %s サインなし=%s\n', sqlerrm, n); end if;
    end;

    -- 18-5 協力会社の担当 A は、その日報の件と前の日の件の確認を記録できる（重複は 1 行）
    begin
      perform pg_temp.as_user(v_a);
      select public.gn_save_client_signature(r18, ' 施主 佐藤様 ', '', now(), g18, pdf18, null, array[i18a, i18p, i18a, i18p]) into ts18;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_issue_client_confirmations
       where report_id = r18 and site_id = x and issue_id in (i18a, i18p) and confirmed_on = '2026-12-20'
         and confirmed_by = '施主 佐藤様' and created_by = v_a and revoked_at is null and revoked_by is null
         and signed_at = (select client_signed_at from public.gn_daily_reports where id = r18);
      select count(*) into n2 from public.gn_issue_client_confirmations where report_id = r18;
      select count(*) into num from public.gn_report_signature_issue_sets
       where report_id = r18 and cardinality(issue_ids) = 2 and issue_ids @> array[i18a, i18p]
         and signed_at = (select client_signed_at from public.gn_daily_reports where id = r18);
      if n = 2 and n2 = 2 and num = 1 then rep := rep || E'PASS 18-5 サインと一緒に件ごとの確認と、サインの件の一覧（重複なし）が入る\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-5 行=%s 全部=%s 件の一覧=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-5 エラー: %s\n', sqlerrm);
    end;

    -- 18-6 確認の行は直接は入れられない・変えられない・消せない（管理者も）
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_issue_client_confirmations (issue_id, report_id, site_id, confirmed_on, confirmed_by, signed_at)
      values (i18p, r18p, x, '2026-12-19', '偽の確認', now());
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-6 確認の行を直接入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then rep := rep || E'PASS 18-6 確認の行は直接入れられない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-6 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_issue_client_confirmations set revoked_at = now(), revoked_by = v_admin where report_id = r18;
      get diagnostics n = row_count;
      delete from public.gn_issue_client_confirmations where report_id = r18;
      get diagnostics n2 = row_count;
      perform pg_temp.as_editor();
      if n = 0 and n2 = 0 then rep := rep || E'PASS 18-7 確認の行は管理者も直接変えられない・消せない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-7 変えた=%s 消した=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%permission denied%' then rep := rep || E'PASS 18-7 確認の行は管理者も直接変えられない・消せない（permission denied）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-7 想定外: %s\n', sqlerrm); end if;
    end;

    -- 18-8 協力会社も自分の現場の確認は読める。割り当ての無い現場（S18。管理者がサインした）の確認は読めない
    begin
      perform pg_temp.as_user(v_admin);
      perform public.gn_save_client_signature(r18y, '施主様', '', now(),
        s18::text || '/sign/00000000-0000-0000-0000-0000000000f8.png', s18::text || '/signed/' || r18y::text || '-1.pdf', null, array[i18y]);
      perform pg_temp.as_user(v_a);
      select count(*) into n from public.gn_issue_client_confirmations where report_id = r18;
      select count(*) into n2 from public.gn_issue_client_confirmations where site_id = s18;
      perform pg_temp.as_editor();
      select count(*) into num from public.gn_issue_client_confirmations where site_id = s18;
      if n = 2 and n2 = 0 and num = 1 then rep := rep || E'PASS 18-8 協力会社は自分の現場の件の確認を読める（割り当ての無い現場の確認は読めない）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-8 A の現場=%s A から S18=%s S18 の行=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-8 エラー: %s\n', sqlerrm);
    end;

    -- 18-9 管理者がサインを取り消すと、そのサインでの件の確認は消さずに「取り消し」になる（記録に件の id も残る）
    begin
      perform pg_temp.as_user(v_admin);
      perform public.gn_revoke_client_signature(r18, '確認者の間違い');
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_issue_client_confirmations
       where report_id = r18 and revoked_at is not null and revoked_by = v_admin;
      select count(*) into n2 from public.gn_daily_reports
       where id = r18 and jsonb_array_length(client_signature_history->0->'issue_ids') = 2;
      select count(*) into num from public.gn_report_signature_issue_sets where report_id = r18;
      if n = 2 and n2 = 1 and num = 0 then rep := rep || E'PASS 18-9 取り消しで件の確認は revoked になる（行は残る・記録に件の id）。サインの件の一覧は消える\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-9 取り消し=%s 記録=%s 件の一覧=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-9 エラー: %s\n', sqlerrm);
    end;

    -- 18-10 取り消した後にサインを取り直すと、選んだ件だけ確認し直しになる（選ばなかった件は取り消しのまま）
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18, '施主 佐藤 様', '', now(), g18b, pdf18b, null, array[i18a]);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_issue_client_confirmations
       where report_id = r18 and issue_id = i18a and revoked_at is null and revoked_by is null and confirmed_by = '施主 佐藤 様';
      select count(*) into n2 from public.gn_issue_client_confirmations
       where report_id = r18 and issue_id = i18p and revoked_at is not null;
      select count(*) into num from public.gn_report_signature_issue_sets where report_id = r18 and issue_ids = array[i18a];
      if n = 1 and n2 = 1 and num = 1 then rep := rep || E'PASS 18-10 取り直したサインで選んだ件は確認し直し、選ばなかった件は取り消しのまま（件の一覧も取り直し）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-10 確認し直し=%s 取り消しのまま=%s 件の一覧=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-10 エラー: %s\n', sqlerrm);
    end;

    -- 18-11 件の一覧を渡さない呼び出し（名前付きの引数 7 つ。今までの呼び方）も通り、空の件の一覧が記録される。関数は 1 つだけ
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(
        p_report_id => r18p, p_confirmed_by => '施主様', p_note => '', p_signed_at => now(),
        p_signature_path => g18c, p_pdf_path => pdf18p, p_expected_updated_at => null);
      perform pg_temp.as_editor();
      select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'gn_save_client_signature';
      select count(*) into n2 from public.gn_report_signature_issue_sets where report_id = r18p and cardinality(issue_ids) = 0;
      select count(*) into num from public.gn_daily_reports where id = r18p and client_signature_path = g18c;
      if n = 1 and n2 = 1 and num = 1 then rep := rep || E'PASS 18-11 件を渡さない呼び出しも通り、空の件の一覧が記録される（関数は 1 つだけ）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-11 関数の数=%s 空の一覧=%s サイン=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-11 エラー: %s\n', sqlerrm);
    end;

    -- 18-12 お客様の確認を受けた件（取り消されていない確認がある件）は、下書きの日報でも消せない
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_issues where id = i18a;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-12 お客様の確認を受けた件の削除が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_confirmed%' then rep := rep || E'PASS 18-12 お客様の確認を受けた件の削除は断る（issue_confirmed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-12 想定外: %s\n', sqlerrm); end if;
    end;

    -- 18-13 確認が取り消しだけの件は消せる（取り消した確認の行も一緒に消える）
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_issues where id = i18p;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i18p;
      select count(*) into n2 from public.gn_issue_client_confirmations where issue_id = i18p;
      if n = 0 and n2 = 0 then rep := rep || E'PASS 18-13 確認が取り消しだけの件は消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-13 件=%s 確認の行=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-13 エラー: %s\n', sqlerrm);
    end;

    -- 18-14 前の日（12-22）の件を 12-23 のサインで確認してもらうと、12-22 の下書きの日報は消せない
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_client_signature(r18d, '施主様', '', now(), g18d, pdf18d, null, array[i18c]);
      perform pg_temp.as_editor();
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-14 準備（12-23 のサイン）でエラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_daily_reports where id = r18c;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-14 確認を受けた件のある日報の削除が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_issue_client_confirmations where issue_id = i18c and revoked_at is null;
      if sqlerrm like '%report_has_confirmed_issue%' and n = 1 then
        rep := rep || E'PASS 18-14 お客様の確認を受けた件のある日報の削除は断る（report_has_confirmed_issue。確認は残る）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-14 想定外: %s 確認=%s\n', sqlerrm, n); end if;
    end;

    -- 18-15 第 4 段階より前のサイン（件の一覧の行が無いサイン）を見分けられる：サインがあって件の一覧の行が無い日報だけ
    begin
      perform pg_temp.as_user(v_a);
      select count(*) into n from public.gn_daily_reports r
       where r.site_id = x and r.client_signature_path is not null
         and not exists (select 1 from public.gn_report_signature_issue_sets t where t.report_id = r.id);
      select count(*) into n2 from public.gn_report_signature_issue_sets where report_id in (r18, r18p, r18d);
      perform pg_temp.as_editor();
      if n = 0 and n2 = 3 then rep := rep || E'PASS 18-15 この SQL の後のサインには必ず件の一覧の行がある（協力会社も読める）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-15 行の無いサイン=%s 読める一覧=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-15 エラー: %s\n', sqlerrm);
    end;

    -- 18-16 件の一覧の行は直接は入れられない・消せない。サインを取り消すと、確認を受けた件のある日報も消せるようになる
    begin
      perform pg_temp.as_user(v_admin);
      delete from public.gn_report_signature_issue_sets where report_id = r18d;
      get diagnostics n = row_count;
      perform public.gn_revoke_client_signature(r18d, '確認者の間違い');
      perform pg_temp.as_user(v_a);
      delete from public.gn_daily_reports where id = r18c;
      perform pg_temp.as_editor();
      select count(*) into n2 from public.gn_daily_reports where id = r18c;
      select count(*) into num from public.gn_report_signature_issue_sets where report_id = r18d;
      if n = 0 and n2 = 0 and num = 0 then rep := rep || E'PASS 18-16 件の一覧は直接消せない。取り消した後は日報を消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-16 直接消した=%s 日報=%s 一覧=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18-16 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_signature_issue_sets (report_id, issue_ids, signed_at) values (r18d, '{}', now());
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 18-17 件の一覧の行を直接入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' or sqlerrm like '%permission denied%' then
        rep := rep || E'PASS 18-17 件の一覧の行は直接入れられない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 18-17 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 18 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 19. 件の見積提出の記録（update_2026-11-14） =====
  -- A（現場 X の協力会社の担当）が 12-26 の日報と件を作って提出する。C（社員）が見積提出を記録・取り消す。
  declare
    r19 uuid; i19 uuid;
  begin
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-26', 'weather', '晴れ'), '[]'::jsonb) into r19;
    insert into public.gn_report_issues (site_id, report_id, body, status) values (x, r19, '見積を出す件', 'estimating') returning id into i19;
    update public.gn_daily_reports set status = 'submitted' where id = r19;
    perform pg_temp.as_editor();

    -- 19-1 社員は提出済みの日報の件にも見積提出を記録できる。記録した人は本人になる（ほかの人の名前は入らない）
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_submitted_on = '2026-12-26', estimate_submitted_by = v_admin where id = i19;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues
       where id = i19 and estimate_submitted_on = '2026-12-26' and estimate_submitted_by = v_c;
      if n = 1 then rep := rep || E'PASS 19-1 社員は提出済みの日報の件に見積提出を記録できる（記録した人は本人）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 19-1 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 19-1 エラー: %s\n', sqlerrm);
    end;

    -- 19-2 協力会社は見積提出を変えられない（not_employee）
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set estimate_submitted_on = '2026-12-27' where id = i19;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 19-2 協力会社の見積提出の変更が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_employee%' then rep := rep || E'PASS 19-2 協力会社の見積提出の変更は断る（not_employee）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 19-2 想定外: %s\n', sqlerrm); end if;
    end;

    -- 19-3 協力会社は見積提出を付けて件を作れない（not_employee）
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(jsonb_build_object('site_id', x, 'report_date', '2026-12-27', 'weather', '晴れ'), '[]'::jsonb);
      insert into public.gn_report_issues (site_id, report_id, body, estimate_submitted_on)
        select x, r.id, '見積提出付きの件', '2026-12-27' from public.gn_daily_reports r where r.site_id = x and r.report_date = '2026-12-27';
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 19-3 協力会社が見積提出付きの件を作れた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_employee%' then rep := rep || E'PASS 19-3 協力会社は見積提出付きの件を作れない（not_employee）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 19-3 想定外: %s\n', sqlerrm); end if;
    end;

    -- 19-4 社員は取り消せる（提出日と記録した人が一緒に消える）。記録した人だけを入れても入らない
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_submitted_on = null where id = i19;
      update public.gn_report_issues set estimate_submitted_by = v_c where id = i19;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues
       where id = i19 and estimate_submitted_on is null and estimate_submitted_by is null;
      if n = 1 then rep := rep || E'PASS 19-4 見積提出の取り消しで提出日と記録した人が一緒に消える\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 19-4 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 19-4 エラー: %s\n', sqlerrm);
    end;

    -- 19-5 見積提出を変えても、件の中身の鍵（issue_locked）は今までどおり（提出済みの日報の件の内容は直せない）
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_submitted_on = '2026-12-26', body = '書き換え' where id = i19;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 19-5 見積提出と一緒に件の内容を直すのが通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_locked%' then rep := rep || E'PASS 19-5 見積提出と一緒でも、提出済みの日報の件の内容は直せない（issue_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 19-5 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 19 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 20. 積算連携の工種・元請けの内訳・実行予算・読み替え表・進み具合（update_2026-11-15） =====
  -- 現場 S20（進行中）：A＝協力会社の担当（staff）、B＝協力会社の確認者（reviewer）、C＝社員（初めは割り当てなし）。
  -- 現場 D20 は完了。会社 P20 は協力会社の印あり、V20 は取引先だけ。
  declare
    s20  uuid := '00000000-0000-0000-0000-000000002001';
    d20  uuid := '00000000-0000-0000-0000-000000002002';
    p20  uuid := '00000000-0000-0000-0000-000000002011';
    v20  uuid := '00000000-0000-0000-0000-000000002012';
    tr1 uuid; tr2 uuid; tr3 uuid; tr4 uuid; tr5 uuid; trd uuid; r20 uuid; j jsonb; k int; m int;
  begin
    insert into public.gn_sites (id, name, status) values (s20, '検証現場S20', 'active'), (d20, '検証現場D20', 'done');
    insert into public.gn_site_members (site_id, user_id, role) values (s20, v_a, 'staff'), (s20, v_b, 'reviewer'), (d20, v_a, 'staff');
    insert into public.gn_suppliers (id, name, is_vendor, is_partner) values (p20, '検証協力会社P20', false, true), (v20, '検証取引先V20', true, false);
    -- 完了現場の工種（SQL Editor から。RLS の外）
    insert into public.gn_site_trades (site_id, name) values (d20, '完了現場の工種') returning id into trd;

    -- 20-1 社員は工種をまとめて保存できる（名前の前後の空白は落ちる・並びは配列の順）
    begin
      perform pg_temp.as_user(v_c);
      select public.gn_save_site_trades(s20, '[{"id":null,"name":" 鉄骨工 "},{"id":null,"name":"塗装工"},{"id":null,"name":"足場工"}]'::jsonb) into j;
      perform pg_temp.as_editor();
      select id into tr1 from public.gn_site_trades where site_id = s20 and name = '鉄骨工';
      select id into tr2 from public.gn_site_trades where site_id = s20 and name = '塗装工';
      select id into tr3 from public.gn_site_trades where site_id = s20 and name = '足場工';
      if jsonb_array_length(j) = 3 and tr1 is not null and tr2 is not null and tr3 is not null
         and (select sort_order from public.gn_site_trades where id = tr3) = 2 then
        rep := rep || E'PASS 20-1 社員は工種をまとめて保存できる（空白は落ちる・並びは配列の順）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-1 結果=%s\n', j); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-1 エラー: %s\n', sqlerrm);
    end;

    -- 20-2 協力会社は工種を変えられない（not_employee・直接の insert も RLS）
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_site_trades(s20, '[{"id":null,"name":"勝手な工種"}]'::jsonb);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-2 協力会社が工種を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_employee%' then rep := rep || E'PASS 20-2 協力会社は工種を保存できない（not_employee）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-2 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_site_trades (site_id, name) values (s20, '勝手な工種');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-2b 協力会社が工種を直接入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-2b 協力会社は工種を直接入れられない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-2b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 20-3 社員は読み替え表・実行予算・元請けの内訳を入れられる（金額は round(数量 × 単価)）
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_trade_aliases (site_id, trade_text, trade_id) values (s20, ' ブラスト工 ', tr2);
      perform public.gn_replace_budget_lines(s20, jsonb_build_array(
        jsonb_build_object('trade_id', tr1, 'performer', 'own', 'item', 'labor', 'qty', 10, 'unit', '人工', 'unit_price', 25000),
        jsonb_build_object('trade_id', tr1, 'performer', 'partner', 'supplier_id', p20, 'item', 'jouyou', 'qty', 2.5, 'unit', '人工', 'unit_price', 20001),
        jsonb_build_object('trade_id', null, 'performer', 'own', 'item', 'material', 'note', '鋼材', 'qty', 1, 'unit', '式', 'unit_price', 300000)));
      perform public.gn_replace_contract_items(s20, jsonb_build_array(
        jsonb_build_object('section', 'initial', 'name', '鉄骨建方', 'qty', 12.5, 'unit', 't', 'unit_price', 1001, 'trade_id', tr1, 'category', 'trade'),
        jsonb_build_object('section', 'initial', 'name', '諸経費', 'qty', 1, 'unit', '式', 'unit_price', 50000, 'category', 'expense')), 'replace');
      perform public.gn_replace_contract_items(s20, jsonb_build_array(
        jsonb_build_object('section', 'initial', 'name', '鉄骨建方 増', 'qty', 2, 'unit', 't', 'unit_price', 1001, 'trade_id', tr1, 'category', 'trade')), 'appendChange');
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_trade_aliases where site_id = s20 and trade_text = 'ブラスト工';
      select count(*), sum(amount) into n2, num from public.gn_budget_lines where site_id = s20;
      select count(*), sum(amount) into m, num2 from public.gn_contract_items where site_id = s20;
      select count(*) into k from public.gn_contract_items where site_id = s20 and name = '鉄骨建方 増' and section = 'change' and sort_order = 2;
      if n = 1 and n2 = 3 and num = 250000 + 50003 + 300000 and m = 3 and num2 = 12513 + 50000 + 2002 and k = 1 then
        rep := rep || E'PASS 20-3 社員は読み替え表・実行予算・元請けの内訳（入れ替え・変更として足す）を入れられ、金額は round(数量 × 単価)\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-3 読み替え=%s 予算=%s/%s 内訳=%s/%s 変更=%s\n', n, n2, num, m, num2, k); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-3 エラー: %s\n', sqlerrm);
    end;

    -- 20-4 請負・常用の会社は協力会社の印のある会社だけ（not_partner）。組み合わせの違う行は入らない（材料に工種）
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_replace_budget_lines(s20, jsonb_build_array(
        jsonb_build_object('trade_id', tr1, 'performer', 'partner', 'supplier_id', v20, 'item', 'subcontract', 'qty', 1, 'unit', '式', 'unit_price', 1)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-4 取引先だけの会社を請負に入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_partner%' then rep := rep || E'PASS 20-4 請負・常用の会社は協力会社だけ（not_partner）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-4 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_replace_budget_lines(s20, jsonb_build_array(
        jsonb_build_object('trade_id', tr1, 'performer', 'own', 'item', 'material', 'qty', 1, 'unit', '式', 'unit_price', 1)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-4b 材料を工種に入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_budget_lines_combo_ck%' then rep := rep || E'PASS 20-4b 材料は現場全体だけ（gn_budget_lines_combo_ck）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-4b 想定外: %s\n', sqlerrm); end if;
    end;
    select count(*) into n from public.gn_budget_lines where site_id = s20;
    if n = 3 then rep := rep || E'PASS 20-4c 入れ替えに失敗しても前の実行予算が残る\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 20-4c 予算の行=%s\n', n); end if;

    -- 20-5 協力会社は内訳・実行予算・進み具合を読めない（0 行）。工種と読み替え表は読める
    insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr1, 40);
    perform pg_temp.as_user(v_a);
    select count(*) into n from public.gn_contract_items where site_id = s20;
    select count(*) into n2 from public.gn_budget_lines where site_id = s20;
    select count(*) into num from public.gn_trade_progress where site_id = s20;
    select count(*) into num2 from public.gn_site_trades where site_id = s20;
    select count(*) into k from public.gn_trade_aliases where site_id = s20;
    perform pg_temp.as_editor();
    if n = 0 and n2 = 0 and num = 0 and num2 = 3 and k = 1 then
      rep := rep || E'PASS 20-5 協力会社は内訳・予算・進み具合を読めず、工種と読み替え表は読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 20-5 内訳=%s 予算=%s 進み具合=%s 工種=%s 読み替え=%s\n', n, n2, num, num2, k); end if;
    perform pg_temp.as_user(v_c);
    select count(*) into n from public.gn_contract_items where site_id = s20;
    select count(*) into n2 from public.gn_trade_progress where site_id = s20;
    perform pg_temp.as_editor();
    if n = 3 and n2 = 1 then rep := rep || E'PASS 20-5b 社員は内訳・進み具合を読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 20-5b 内訳=%s 進み具合=%s\n', n, n2); end if;
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_contract_items (site_id, name, qty, unit_price) values (s20, '勝手な内訳', 1, 1);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-5c 協力会社が内訳を入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-5c 協力会社は内訳を入れられない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-5c 想定外: %s\n', sqlerrm); end if;
    end;

    -- 20-6 進み具合の上書き：割り当てのない社員・担当（staff）の社員・協力会社の確認者は不可。社員の確認者・管理者はできる
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr1, 50);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-6 割り当てのない社員が進み具合を上書きできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-6 割り当てのない社員は進み具合を上書きできない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-6 想定外: %s\n', sqlerrm); end if;
    end;
    insert into public.gn_site_members (site_id, user_id, role) values (s20, v_c, 'staff');
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr1, 50);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-6b 担当（staff）が進み具合を上書きできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-6b 担当（staff）は進み具合を上書きできない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-6b 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_b);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr1, 50);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-6c 協力会社の確認者が進み具合を上書きできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-6c 協力会社の確認者は進み具合を上書きできない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-6c 想定外: %s\n', sqlerrm); end if;
    end;
    update public.gn_site_members set role = 'reviewer' where site_id = s20 and user_id = v_c;
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_trade_progress (site_id, trade_id, percent, set_by) values (s20, tr1, 55, v_admin);
      perform pg_temp.as_user(v_admin);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr2, null);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_trade_progress where trade_id = tr1 and percent = 55 and set_by = v_c;
      select count(*) into n2 from public.gn_trade_progress where trade_id = tr2 and percent is null and set_by = v_admin;
      if n = 1 and n2 = 1 then rep := rep || E'PASS 20-6d 社員の確認者と管理者は進み具合を上書き・消せる（入れた人は本人）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-6d 確認者=%s 管理者=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-6d エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr1, 101);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-6e 100 を超える % が入った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_trade_progress_percent_check%' then rep := rep || E'PASS 20-6e % は 0〜100 だけ（gn_trade_progress_percent_check）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-6e 想定外: %s\n', sqlerrm); end if;
    end;

    -- 20-7 日報の作業内容の行に工種を保存できる（協力会社の担当も）。作業内容以外の行は null。ほかの現場の工種は断る
    begin
      perform pg_temp.as_user(v_a);
      select public.gn_save_report(jsonb_build_object('site_id', s20, 'report_date', '2027-01-10', 'weather', '晴れ'),
        jsonb_build_array(
          jsonb_build_object('kind', 'labor', 'sort_order', 1, 'name', '山田', 'unit_price', 20000, 'site_trade_id', tr3),
          jsonb_build_object('kind', 'work', 'sort_order', 2, 'trade', '鉄骨工', 'description', '建方', 'qty', 3, 'unit', 't', 'site_trade_id', tr1))) into r20;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_lines where report_id = r20 and kind = 'work' and site_trade_id = tr1;
      select count(*) into n2 from public.gn_report_lines where report_id = r20 and kind = 'labor' and site_trade_id is null;
      if n = 1 and n2 = 1 then rep := rep || E'PASS 20-7 日報の作業内容の行に工種が残る（作業員の行は null）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-7 作業内容=%s 作業員=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-7 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(jsonb_build_object('site_id', s20, 'report_date', '2027-01-11', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'work', 'sort_order', 1, 'description', '他現場', 'site_trade_id', trd)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-7b ほかの現場の工種を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%trade_not_in_site%' then rep := rep || E'PASS 20-7b ほかの現場の工種は保存できない（trade_not_in_site）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-7b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 20-8 使われている工種は消せない（日報の行・読み替え表・実行予算＝trade_in_use）。使われていない工種は消せる
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_site_trades(s20, jsonb_build_array(jsonb_build_object('id', tr2, 'name', '塗装工'), jsonb_build_object('id', tr3, 'name', '足場工')));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-8 日報・予算で使っている工種を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%trade_in_use%' then rep := rep || E'PASS 20-8 日報・予算で使っている工種は消せない（trade_in_use）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-8 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      delete from public.gn_site_trades where id = tr2;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-8b 読み替え表で使っている工種を消せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%trade_in_use%' then rep := rep || E'PASS 20-8b 読み替え表で使っている工種は消せない（trade_in_use）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-8b 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      select public.gn_save_site_trades(s20, jsonb_build_array(
        jsonb_build_object('id', tr2, 'name', '塗装工'), jsonb_build_object('id', tr1, 'name', '鉄骨建方工'))) into j;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_site_trades where id = tr3;
      select count(*) into n2 from public.gn_site_trades where id = tr1 and name = '鉄骨建方工' and sort_order = 1;
      if jsonb_array_length(j) = 2 and n = 0 and n2 = 1 then rep := rep || E'PASS 20-8c 使われていない工種は消せ、名前と並びを直せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-8c 消えた?=%s 直った?=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-8c エラー: %s\n', sqlerrm);
    end;

    -- 20-8d 元請けの内訳の識別・進み具合の履歴で使っている工種も消せない（trade_in_use）
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_site_trades (site_id, name, sort_order) values (s20, '内訳だけの工種', 10) returning id into tr4;
      insert into public.gn_site_trades (site_id, name, sort_order) values (s20, '履歴だけの工種', 11) returning id into tr5;
      perform public.gn_replace_contract_items(s20, jsonb_build_array(
        jsonb_build_object('section', 'change', 'name', '識別の行', 'qty', 1, 'unit', '式', 'unit_price', 1, 'trade_id', tr4, 'category', 'trade')), 'appendChange');
      perform pg_temp.as_user(v_admin);
      insert into public.gn_trade_progress (site_id, trade_id, percent) values (s20, tr5, null);
      perform pg_temp.as_user(v_c);
      begin
        delete from public.gn_site_trades where id = tr4;
        fails := fails + 1; rep := rep || E'FAIL 20-8d 内訳の識別で使っている工種を消せた\n';
      exception when others then
        if sqlerrm like '%trade_in_use%' then rep := rep || E'PASS 20-8d 内訳の識別で使っている工種は消せない（trade_in_use）\n';
        else fails := fails + 1; rep := rep || format(E'FAIL 20-8d 想定外: %s\n', sqlerrm); end if;
      end;
      begin
        delete from public.gn_site_trades where id = tr5;
        fails := fails + 1; rep := rep || E'FAIL 20-8e 進み具合の履歴がある工種を消せた\n';
      exception when others then
        if sqlerrm like '%trade_in_use%' then rep := rep || E'PASS 20-8e 進み具合の履歴がある工種は消せない（trade_in_use）\n';
        else fails := fails + 1; rep := rep || format(E'FAIL 20-8e 想定外: %s\n', sqlerrm); end if;
      end;
      perform pg_temp.as_editor();
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20-8d エラー: %s\n', sqlerrm);
    end;
    -- 20-8f 同じ名前の工種は関数の中で断る（遅延の一意をその場で確かめる）
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_site_trades(s20, jsonb_build_array(
        jsonb_build_object('id', null, 'name', '同じ名前'), jsonb_build_object('id', null, 'name', '同じ名前')));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-8f 同じ名前の工種を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_site_trades_site_id_name_key%' then rep := rep || E'PASS 20-8f 同じ名前の工種は関数の中で断る（gn_site_trades_site_id_name_key）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-8f 想定外: %s\n', sqlerrm); end if;
    end;

    -- 20-9 完了現場には書けない（関数は site_closed・直接は RLS）
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_site_trades(d20, '[{"id":null,"name":"完了後の工種"}]'::jsonb);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-9 完了現場に工種を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%site_closed%' then rep := rep || E'PASS 20-9 完了現場には工種を保存できない（site_closed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-9 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_admin);
      insert into public.gn_trade_aliases (site_id, trade_text, trade_id) values (d20, '完了後', trd);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-9b 管理者が完了現場の読み替え表を変えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 20-9b 完了現場の読み替え表は管理者も変えられない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-9b 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_admin);
      perform public.gn_replace_budget_lines(d20, '[]'::jsonb);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 20-9c 完了現場の実行予算を入れ替えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%site_closed%' then rep := rep || E'PASS 20-9c 完了現場の実行予算は入れ替えられない（site_closed）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 20-9c 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 20 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 21. 現場のお金の列（update_2026-11-16） =====
  -- 現場X：Aは協力会社のメンバー、Cは割り当てのない社員。
  begin
    update public.gn_sites set contract_amount = 1234567, estimated_amount = 1000000, default_daily_rate = 25000 where id = x;
    begin
      perform pg_temp.as_user(v_a);
      select count(*) into n from (select contract_amount from public.gn_sites where id = x) q;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 21-1 協力会社Aが請負金額の列を読めた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '42501' then rep := rep || E'PASS 21-1 協力会社Aは請負金額の列を読めない（列の権限）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 21-1 想定外: %s\n', sqlerrm); end if;
    end;
    perform pg_temp.as_user(v_a);
    select count(*) into n from public.gn_site_money(array[x, y]);
    select count(*), string_agg(name, ',') into n2, t from public.gn_sites where id in (x, y);
    perform pg_temp.as_editor();
    if n = 0 then rep := rep || E'PASS 21-2 協力会社Aには gn_site_money が何も返さない\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 21-2 Aに gn_site_money が %s 行返った\n', n); end if;
    if n2 = 1 and t = '検証現場X' then rep := rep || E'PASS 21-3 協力会社Aはお金以外の列（現場名）は今まで通り読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 21-3 Aに見える現場: %s (%s)\n', n2, t); end if;
    perform pg_temp.as_user(v_c);
    select s.contract_amount, s.default_daily_rate into num, num2 from public.gn_site_money(array[x]) s;
    select count(*) into n from public.gn_site_money(array[x, y]);
    perform pg_temp.as_editor();
    if num = 1234567 and num2 = 25000 and n = 2 then rep := rep || E'PASS 21-4 社員Cは gn_site_money で請負金額を読める\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 21-4 Cの gn_site_money: %s / %s / %s 行\n', num, num2, n); end if;
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_sites set contract_amount = 2000000, estimated_amount = null, default_daily_rate = 30000
       where id = x and deleted_at is null returning id into u;
      select s.contract_amount into num from public.gn_site_money(array[x]) s;
      perform pg_temp.as_editor();
      if u = x and num = 2000000 then rep := rep || E'PASS 21-5 管理者は現場の金額を更新でき、gn_site_money で読める\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 21-5 管理者の更新: %s / %s\n', u, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 21-5 管理者の更新でエラー: %s\n', sqlerrm);
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 21 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 22. 外注の買掛・行の根拠の件・請負の会社の一覧（update_2026-11-17） =====
  -- 現場 S22（進行中）：A＝協力会社の担当（staff）、C＝社員（割り当てなし）。現場 O22 はほかの現場（A・C とも割り当てなし）。
  -- 会社 P22 は協力会社の印あり。工種 tr22 は S22、tro22 は O22 のもの。
  declare
    s22  uuid := '00000000-0000-0000-0000-000000002201';
    o22  uuid := '00000000-0000-0000-0000-000000002202';
    p22  uuid := '00000000-0000-0000-0000-000000002211';
    tr22 uuid; tro22 uuid; r22 uuid; ro22 uuid; i22 uuid; io22 uuid; lines22 jsonb;
  begin
    insert into public.gn_sites (id, name, status) values (s22, '検証現場S22', 'active'), (o22, '検証現場O22', 'active');
    insert into public.gn_site_members (site_id, user_id, role) values (s22, v_a, 'staff');
    insert into public.gn_suppliers (id, name, is_vendor, is_partner) values (p22, '検証協力会社P22', false, true);
    insert into public.gn_site_trades (site_id, name) values (s22, 'タイル') returning id into tr22;
    insert into public.gn_site_trades (site_id, name) values (o22, 'ほかの現場の工種') returning id into tro22;
    insert into public.gn_budget_lines (site_id, trade_id, performer, supplier_id, item, qty, unit, unit_price)
      values (s22, tr22, 'partner', p22, 'subcontract', 1, '式', 270000);
    insert into public.gn_daily_reports (site_id, report_date) values (o22, '2027-02-01') returning id into ro22;
    insert into public.gn_report_issues (site_id, report_id, body, kind) values (o22, ro22, 'ほかの現場の件', 'extra') returning id into io22;
    -- 協力会社 A にも見える行（現金 ¥1,000・仕入の買掛 ¥18,000）
    lines22 := jsonb_build_array(
      jsonb_build_object('kind', 'cash', 'sort_order', 1, 'name', '釘', 'qty', 1, 'unit_price', 1000),
      jsonb_build_object('kind', 'credit', 'sort_order', 2, 'name', 'タイル 200角', 'qty', 2, 'unit_price', 9000,
                         'purchase_kind', 'material', 'site_trade_id', tr22));

    -- 22-1 社員は外注の買掛（工種つき）を保存できる。仕入の買掛の工種は null。cost_total は外注を除く
    begin
      perform pg_temp.as_user(v_c);
      select public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-01', 'weather', '晴れ'),
        lines22 || jsonb_build_array(
          jsonb_build_object('kind', 'credit', 'sort_order', 3, 'name', 'タイル工事', 'qty', 1, 'unit_price', 100000,
                             'ref_id', p22, 'purchase_kind', 'subcontract', 'site_trade_id', tr22))) into r22;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_lines where report_id = r22 and kind = 'credit' and purchase_kind = 'subcontract' and site_trade_id = tr22;
      select count(*) into n2 from public.gn_report_lines where report_id = r22 and kind = 'credit' and purchase_kind = 'material' and site_trade_id is null;
      select cost_total into num from public.gn_daily_reports where id = r22;
      if n = 1 and n2 = 1 and num = 19000 then
        rep := rep || E'PASS 22-1 社員は外注の買掛を工種つきで保存できる（仕入の買掛の工種は null・cost_total は外注を除く）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-1 外注=%s 仕入=%s cost_total=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 22-1 エラー: %s\n', sqlerrm);
    end;

    -- 22-2 協力会社 A は外注の買掛の行を読めない（ほかの行は読める）
    perform pg_temp.as_user(v_a);
    select count(*) into n from public.gn_report_lines where report_id = r22;
    select count(*) into n2 from public.gn_report_lines where report_id = r22 and purchase_kind = 'subcontract';
    perform pg_temp.as_editor();
    if n = 2 and n2 = 0 then rep := rep || E'PASS 22-2 協力会社Aは外注の買掛の行を読めない（ほかの行は読める）\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 22-2 Aに見える行=%s 外注=%s\n', n, n2); end if;

    -- 22-3 協力会社 A は外注の買掛の行を足せない（RLS）
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_lines (report_id, kind, sort_order, name, qty, unit_price, purchase_kind)
        values (r22, 'credit', 9, '勝手な外注', 1, 1, 'subcontract');
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-3 協力会社が外注の買掛の行を足せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 22-3 協力会社は外注の買掛の行を足せない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-3 想定外: %s\n', sqlerrm); end if;
    end;

    -- 22-4 協力会社 A が外注の買掛の行を消しても 0 行、仕入の行を外注に変えることもできない
    begin
      perform pg_temp.as_user(v_a);
      delete from public.gn_report_lines where report_id = r22 and purchase_kind = 'subcontract';
      get diagnostics n = row_count;
      perform pg_temp.as_editor();
      select count(*) into n2 from public.gn_report_lines where report_id = r22 and purchase_kind = 'subcontract';
      if n = 0 and n2 = 1 then rep := rep || E'PASS 22-4 協力会社Aが外注の買掛の行を消しても 0 行\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-4 消えた=%s 残り=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 22-4 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_lines set purchase_kind = 'subcontract' where report_id = r22 and kind = 'credit';
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-4b 協力会社が仕入の買掛を外注に変えられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%row-level security%' then rep := rep || E'PASS 22-4b 協力会社は仕入の買掛を外注に変えられない（RLS）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-4b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 22-5 協力会社 A が同じ日報を保存し直しても、外注の行は残り、cost_total は変わらない
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-01', 'weather', '曇り'), lines22);
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_lines where report_id = r22 and purchase_kind = 'subcontract';
      select count(*) into n2 from public.gn_report_lines where report_id = r22;
      select cost_total into num from public.gn_daily_reports where id = r22;
      if n = 1 and n2 = 3 and num = 19000 then
        rep := rep || E'PASS 22-5 協力会社が保存し直しても外注の行は残り、cost_total は同じ\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-5 外注=%s 行=%s cost_total=%s\n', n, n2, num); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 22-5 エラー: %s\n', sqlerrm);
    end;

    -- 22-6 外注の買掛にほかの現場の工種は入らない（trade_not_in_site）
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-02', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'credit', 'sort_order', 1, 'name', '外注', 'qty', 1, 'unit_price', 1,
                                             'purchase_kind', 'subcontract', 'site_trade_id', tro22)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-6 外注の買掛にほかの現場の工種を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%trade_not_in_site%' then rep := rep || E'PASS 22-6 外注の買掛にほかの現場の工種は入らない（trade_not_in_site）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-6 想定外: %s\n', sqlerrm); end if;
    end;

    -- 22-7 根拠の件：この現場の件は現金・リースの行に残り、作業員の行は null。ほかの現場の件は断る（issue_not_in_site）
    begin
      insert into public.gn_report_issues (site_id, report_id, body, kind) values (s22, r22, '門柱のタイル追加', 'extra') returning id into i22;
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-03', 'weather', '晴れ'),
        jsonb_build_array(
          jsonb_build_object('kind', 'cash', 'sort_order', 1, 'name', '目地材', 'qty', 1, 'unit_price', 500, 'issue_id', i22),
          jsonb_build_object('kind', 'lease', 'sort_order', 2, 'name', '足場', 'qty', 1, 'unit_price', 15000, 'issue_id', i22),
          jsonb_build_object('kind', 'labor', 'sort_order', 3, 'name', '山田', 'unit_price', 20000, 'issue_id', i22, 'jouyou_hours', 4)));
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_lines l join public.gn_daily_reports r on r.id = l.report_id
       where r.site_id = s22 and r.report_date = '2027-02-03' and l.kind in ('cash','lease') and l.issue_id = i22;
      select count(*) into n2 from public.gn_report_lines l join public.gn_daily_reports r on r.id = l.report_id
       where r.site_id = s22 and r.report_date = '2027-02-03' and l.kind = 'labor' and l.issue_id is null and l.jouyou_hours = 4;
      if n = 2 and n2 = 1 then rep := rep || E'PASS 22-7 根拠の件は現金・リースの行に残り、作業員の行は null（うち常用の時間は残る）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-7 根拠つき=%s 作業員=%s\n', n, n2); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 22-7 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-04', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'cash', 'sort_order', 1, 'name', '釘', 'qty', 1, 'unit_price', 1, 'issue_id', io22)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-7b ほかの現場の件を根拠にできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%issue_not_in_site%' then rep := rep || E'PASS 22-7b ほかの現場の件は根拠にできない（issue_not_in_site）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-7b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 22-8 区分・うち常用の時間の制約（gn_report_lines_purchase_kind_ck・gn_report_lines_jouyou_hours_ck）
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-05', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'credit', 'sort_order', 1, 'name', 'x', 'qty', 1, 'unit_price', 1, 'purchase_kind', 'other')));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-8 区分に想定外の値を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_report_lines_purchase_kind_ck%' then rep := rep || E'PASS 22-8 買掛の区分は仕入・外注だけ\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-8 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-05', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'labor', 'sort_order', 1, 'name', '山田', 'unit_price', 20000, 'jouyou_hours', 25)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-8b うち常用の時間に 25 を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_report_lines_jouyou_hours_ck%' then rep := rep || E'PASS 22-8b うち常用の時間は 0〜24\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-8b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 22-9 請負の会社の一覧：メンバーの協力会社 A には会社の id だけ、メンバーでない人（B）には 0 行
    perform pg_temp.as_user(v_a);
    select count(*), max(supplier_id::text) into n, t from public.gn_site_ukeoi_suppliers(s22);
    perform pg_temp.as_user(v_b);
    select count(*) into n2 from public.gn_site_ukeoi_suppliers(s22);
    perform pg_temp.as_editor();
    if n = 1 and t = p22::text and n2 = 0 then rep := rep || E'PASS 22-9 請負の会社の一覧はメンバーにだけ会社の id を返す\n';
    else fails := fails + 1; rep := rep || format(E'FAIL 22-9 A=%s (%s) B=%s\n', n, t, n2); end if;

    -- 22-10 承認済みの日報の行は今まで通り変えられない（approved_report_locked）
    begin
      perform pg_temp.as_user(v_admin);
      update public.gn_daily_reports set status = 'approved', approved_by = v_admin, approved_at = now() where id = r22;
      perform pg_temp.as_user(v_c);
      perform public.gn_save_report(jsonb_build_object('site_id', s22, 'report_date', '2027-02-01', 'weather', '雨'), lines22);
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 22-10 承認済みの日報を保存し直せた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%approved_report_locked%' then rep := rep || E'PASS 22-10 承認済みの日報は保存し直せない（approved_report_locked）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 22-10 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 22 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 23. 名前なし（会社と人数）の作業員の行（update_2026-11-19） =====
  -- 現場 S23（進行中）：A＝協力会社の担当（staff）。会社 P23 は協力会社の印あり。共通時間 8:00〜18:00・休憩 60 分（実働 9H）。
  declare
    s23 uuid := '00000000-0000-0000-0000-000000002301';
    p23 uuid := '00000000-0000-0000-0000-000000002311';
    r23 uuid;
    u_md numeric; u_ot numeric; u_amt numeric; u_h numeric; u_hc int;
    m_md numeric; m_ot numeric; m_amt numeric; m_h numeric; m_hc int;
    c_hc int;
  begin
    insert into public.gn_sites (id, name, status) values (s23, '検証現場S23', 'active');
    insert into public.gn_site_members (site_id, user_id, role) values (s23, v_a, 'staff');
    insert into public.gn_suppliers (id, name, is_vendor, is_partner) values (p23, '検証協力会社P23', false, true);

    -- 23-1 協力会社 A は名前なしの行を保存できる。人工・残業・労務費は名前のある行（1 人）の人数倍、実働は同じ。
    --      作業員以外の行の人数は null
    begin
      perform pg_temp.as_user(v_a);
      select public.gn_save_report(
        jsonb_build_object('site_id', s23, 'report_date', '2027-03-01', 'weather', '晴れ',
                           'common_start', '08:00', 'common_end', '18:00', 'common_break_min', 60),
        jsonb_build_array(
          jsonb_build_object('kind', 'labor', 'sort_order', 1, 'name', '検証協力会社P23（名前なし）', 'unit_price', 20000,
                             'headcount', 2, 'affiliation', 'partner', 'supplier_id', p23, 'labor_contract', 'ukeoi', 'jouyou_hours', 4),
          jsonb_build_object('kind', 'labor', 'sort_order', 2, 'name', '山田', 'unit_price', 20000),
          jsonb_build_object('kind', 'cash', 'sort_order', 3, 'name', '釘', 'qty', 1, 'unit_price', 100, 'headcount', 3))) into r23;
      perform pg_temp.as_editor();
      select man_days, overtime_hours, amount, hours, headcount into u_md, u_ot, u_amt, u_h, u_hc
        from public.gn_report_lines where report_id = r23 and sort_order = 1;
      select man_days, overtime_hours, amount, hours, headcount into m_md, m_ot, m_amt, m_h, m_hc
        from public.gn_report_lines where report_id = r23 and sort_order = 2;
      select headcount into c_hc from public.gn_report_lines where report_id = r23 and sort_order = 3;
      if u_hc = 2 and m_hc is null and c_hc is null and u_h = m_h and u_md = m_md * 2 and u_ot = m_ot * 2 and u_amt = m_amt * 2
         and m_md > 0 and (select man_days_total from public.gn_daily_reports where id = r23) = m_md * 3 then
        rep := rep || E'PASS 23-1 名前なしの行は人数分の人工・残業・労務費（実働は 1 人あたり。ほかの行の人数は null）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 23-1 名前なし=%s/%s/%s/%s/%s 名前あり=%s/%s/%s/%s/%s 現金=%s\n',
        u_hc, u_h, u_md, u_ot, u_amt, m_hc, m_h, m_md, m_ot, m_amt, c_hc); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 23-1 エラー: %s\n', sqlerrm);
    end;

    -- 23-2 人数は 1 以上（gn_report_lines_headcount_ck）
    begin
      perform pg_temp.as_user(v_a);
      perform public.gn_save_report(jsonb_build_object('site_id', s23, 'report_date', '2027-03-02', 'weather', '晴れ'),
        jsonb_build_array(jsonb_build_object('kind', 'labor', 'sort_order', 1, 'name', 'x（名前なし）', 'unit_price', 20000,
                                             'headcount', 0, 'affiliation', 'partner', 'supplier_id', p23)));
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 23-2 人数 0 を保存できた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_report_lines_headcount_ck%' then rep := rep || E'PASS 23-2 人数は 1 以上\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 23-2 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 23 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 24. 件の見積書と見積提出が必須の現場（update_2026-11-20） =====
  -- 現場 S24（必須オン）・S24B（必須オフ）：A＝協力会社の担当（staff）。C＝社員（割り当てなし）。
  -- 件は日報が下書きのうちに作り、24-6 で日報を承認済みにする（SQL Editor から）。
  declare
    s24  uuid := '00000000-0000-0000-0000-000000002401';
    s24b uuid := '00000000-0000-0000-0000-000000002402';
    r24 uuid; r24b uuid;
    i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; i6 uuid; i7 uuid; i8 uuid; i9 uuid;
    b1 boolean;
  begin
    insert into public.gn_sites (id, name, status, estimate_required) values (s24, '検証現場S24', 'active', true), (s24b, '検証現場S24B', 'active', false);
    insert into public.gn_site_members (site_id, user_id, role) values (s24, v_a, 'staff'), (s24b, v_a, 'staff');
    perform pg_temp.as_user(v_a);
    select public.gn_save_report(jsonb_build_object('site_id', s24, 'report_date', '2027-04-01', 'weather', '晴れ'), '[]'::jsonb) into r24;
    select public.gn_save_report(jsonb_build_object('site_id', s24b, 'report_date', '2027-04-01', 'weather', '晴れ'), '[]'::jsonb) into r24b;
    perform pg_temp.as_editor();

    -- 24-1 協力会社が必須の現場で件を作る（'none'・対応中を渡す）→ 要（先に出す）・見積中になる
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24, r24, '協力会社の件', 'extra', 'open', 'none') returning id into i1;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i1 and estimate_requirement = 'before' and status = 'estimating';
      if n = 1 then rep := rep || E'PASS 24-1 協力会社が必須の現場で作る件は要（先に出す）・見積中になる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-1 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-1 エラー: %s\n', sqlerrm);
    end;

    -- 24-2 協力会社は見積書の欄を変えられない（not_employee）
    begin
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set estimate_requirement = 'after' where id = i1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-2 協力会社の見積書の欄の変更が通った\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%not_employee%' then rep := rep || E'PASS 24-2 協力会社は見積書の欄を変えられない（not_employee）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-2 想定外: %s\n', sqlerrm); end if;
    end;

    -- 24-3 要（先に出す）・未提出の件は、社員でも対応中・完了にできない（estimate_required_first）
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set status = 'open' where id = i1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-3 未提出の必須の件を対応中にできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%estimate_required_first%' then rep := rep || E'PASS 24-3 未提出の必須の件は対応中にできない（estimate_required_first）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-3 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set status = 'done', done_at = '2027-04-01' where id = i1;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-3b 未提出の必須の件を完了にできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%estimate_required_first%' then rep := rep || E'PASS 24-3b 未提出の必須の件は完了にできない（estimate_required_first）\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-3b 想定外: %s\n', sqlerrm); end if;
    end;

    -- 24-4 社員が見積提出を記録してから、対応中・完了にできる
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_submitted_on = '2027-04-01' where id = i1;
      update public.gn_report_issues set status = 'open' where id = i1;
      update public.gn_report_issues set status = 'done', done_at = '2027-04-01' where id = i1;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i1 and status = 'done';
      if n = 1 then rep := rep || E'PASS 24-4 見積提出を記録すれば対応中・完了にできる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-4 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-4 エラー: %s\n', sqlerrm);
    end;

    -- 24-5 要（先に出す）の対応中の件の記録は取り消せない。後出しに変えてから取り消せる
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement, estimate_submitted_on)
        values (s24, r24, '記録してから対応中の件', 'extra', 'estimating', 'before', '2027-04-01') returning id into i2;
      update public.gn_report_issues set status = 'open' where id = i2;
      perform pg_temp.as_editor();
      begin
        perform pg_temp.as_user(v_c);
        update public.gn_report_issues set estimate_submitted_on = null where id = i2;
        perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-5 必須の対応中の件の記録を取り消せた\n';
      exception when others then
        perform pg_temp.as_editor();
        if sqlerrm like '%estimate_required_first%' then rep := rep || E'PASS 24-5 必須の対応中の件の記録は取り消せない（estimate_required_first）\n';
        else fails := fails + 1; rep := rep || format(E'FAIL 24-5 想定外: %s\n', sqlerrm); end if;
      end;
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_requirement = 'after' where id = i2;
      update public.gn_report_issues set estimate_submitted_on = null where id = i2;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i2 and estimate_requirement = 'after' and estimate_submitted_on is null;
      if n = 1 then rep := rep || E'PASS 24-5b 後出しに変えてから記録を取り消せる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-5b 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-5b エラー: %s\n', sqlerrm);
    end;

    -- 24-6 承認済みの日報の件：後出し・不要の件の状態は社員も協力会社も変えられる。要（先に出す）・記録ありの件も変えられる
    begin
      perform pg_temp.as_user(v_c);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24, r24, '後出しの件', 'extra', 'estimating', 'after') returning id into i3;
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24, r24, '不要の件', 'other', 'estimating', 'none') returning id into i4;
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24, r24, '対応中の不要の件', 'other', 'open', 'none') returning id into i7;
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24, r24, '見積中の不要の件', 'other', 'estimating', 'none') returning id into i8;
      perform pg_temp.as_editor();
      update public.gn_daily_reports set status = 'approved', approved_by = v_admin, approved_at = now() where id = r24;
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set status = 'open' where id = i3;
      update public.gn_report_issues set status = 'open' where id = i1;
      perform pg_temp.as_editor();
      perform pg_temp.as_user(v_a);
      update public.gn_report_issues set status = 'done', done_at = '2027-04-02' where id = i3;
      update public.gn_report_issues set status = 'open' where id = i4;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues
       where (id = i3 and status = 'done') or (id = i4 and status = 'open') or (id = i1 and status = 'open');
      if n = 3 then rep := rep || E'PASS 24-6 承認済みの日報の後出し・不要・記録ありの件の状態は今までどおり変えられる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-6 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-6 エラー: %s\n', sqlerrm);
    end;

    -- 24-7 対応中・未提出の件を要（先に出す）にできない。見積中なら変えられる（日報は承認済みのまま）
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_requirement = 'before' where id = i7;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-7 対応中・未提出の件を要（先に出す）にできた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%estimate_required_first%' then rep := rep || E'PASS 24-7 対応中・未提出の件は要（先に出す）にできない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-7 想定外: %s\n', sqlerrm); end if;
    end;
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_requirement = 'before' where id = i8;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues where id = i8 and estimate_requirement = 'before';
      if n = 1 then rep := rep || E'PASS 24-7b 見積中の件は承認済みの日報でも要（先に出す）に変えられる\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-7b 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-7b エラー: %s\n', sqlerrm);
    end;

    -- 24-8 必須オフの現場で協力会社が作る件は不要。必須の現場でも協力会社のやり直しの件は不要。社員が渡した後出しはそのまま
    begin
      perform pg_temp.as_user(v_a);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        values (s24b, r24b, 'オフの現場の件', 'extra', 'open', 'before') returning id into i5;
      perform public.gn_save_report(jsonb_build_object('site_id', s24, 'report_date', '2027-04-02', 'weather', '晴れ'), '[]'::jsonb);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status)
        select s24, r.id, 'やり直しの件', 'rework', 'open' from public.gn_daily_reports r where r.site_id = s24 and r.report_date = '2027-04-02'
        returning id into i6;
      perform pg_temp.as_editor();
      perform pg_temp.as_user(v_c);
      insert into public.gn_report_issues (site_id, report_id, body, kind, status, estimate_requirement)
        select s24, r.id, '社員の後出しの件', 'extra', 'open', 'after' from public.gn_daily_reports r where r.site_id = s24 and r.report_date = '2027-04-02'
        returning id into i9;
      perform pg_temp.as_editor();
      select count(*) into n from public.gn_report_issues
       where (id = i5 and estimate_requirement = 'none' and status = 'open')
          or (id = i6 and estimate_requirement = 'none' and status = 'open')
          or (id = i9 and estimate_requirement = 'after' and status = 'open');
      if n = 3 then rep := rep || E'PASS 24-8 オフの現場・やり直しは不要、社員の後出しはそのまま\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-8 行=%s\n', n); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-8 エラー: %s\n', sqlerrm);
    end;

    -- 24-9 見積書の値は 3 つだけ（gn_report_issues_estimate_requirement_ck）
    begin
      perform pg_temp.as_user(v_c);
      update public.gn_report_issues set estimate_requirement = 'later' where id = i4;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-9 見積書に later を入れられた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlerrm like '%gn_report_issues_estimate_requirement_ck%' then rep := rep || E'PASS 24-9 見積書の値は 3 つだけ\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-9 想定外: %s\n', sqlerrm); end if;
    end;

    -- 24-10 協力会社は現場の「見積提出が必須のお客様」を読める（請負金額は今までどおり読めない）
    begin
      perform pg_temp.as_user(v_a);
      select estimate_required into b1 from public.gn_sites where id = s24;
      perform pg_temp.as_editor();
      if b1 then rep := rep || E'PASS 24-10 協力会社は見積提出が必須の設定を読める\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-10 値=%s\n', b1); end if;
    exception when others then
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24-10 エラー: %s\n', sqlerrm);
    end;
    begin
      perform pg_temp.as_user(v_a);
      select count(*) into n from (select contract_amount from public.gn_sites where id = s24) q;
      perform pg_temp.as_editor(); fails := fails + 1; rep := rep || E'FAIL 24-10b 協力会社が請負金額の列を読めた\n';
    exception when others then
      perform pg_temp.as_editor();
      if sqlstate = '42501' then rep := rep || E'PASS 24-10b 協力会社は請負金額の列を今までどおり読めない\n';
      else fails := fails + 1; rep := rep || format(E'FAIL 24-10b 想定外: %s\n', sqlerrm); end if;
    end;
  exception when others then
    perform pg_temp.as_editor(); fails := fails + 1; rep := rep || format(E'FAIL 24 準備でエラー: %s\n', sqlerrm);
  end;

  -- ===== 終わり：すべて取り消す =====
  raise exception using message = format(E'VERIFY_RLS 結果: FAIL %s 件\n%s', fails, rep);
end $$;
