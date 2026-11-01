# gn_ スキーマ 適用・RLS 検証手順

## 適用のしかた
1. Supabase ダッシュボードで対象プロジェクトを開き、左メニューの **SQL Editor** → **New query** を開く。
2. `supabase/schema_genba.sql` の中身を全部コピーして貼り付ける。
3. **Run** を押し、エラーなく終わることを確認する（何度実行しても安全。既存の業務報告アプリのテーブルは変更されない）。

> 以降の検証は、すべて SQL Editor に貼って実行する。結果は各チェックボックスに記録する（実行した人が入れる）。
> 「失敗するはず」のテストでエラーが出たあと、画面がエラー状態のままなら `rollback;` だけを単独で実行してから次へ進む。

---

## 0. 準備：テスト用アカウントの確認

権限のルール：**社員（`employee`）はすべての現場に入力できる／協力会社（`partner`）は割り当てられた現場だけ／管理者はすべて**。
「担当外の現場が見えない」ことを確かめるテスト（手順2・3・5）には、**協力会社のアカウント**を使う（社員は担当外でも見えるため、隔離の証明にならない）。

既存アプリのアカウントから、管理者1名・テスト担当者3名を選ぶ。

- A：現場Xの担当者になる。この検証の間だけ**協力会社**にする
- B：現場Yの担当者になる。この検証の間だけ**協力会社**にする
- C：**社員**で、どの現場にも割り当てない（担当外でも入力でき、承認はできないことを確かめる）

ID と現在の区分を調べる:

```sql
select id, name, email, is_admin, account_type from public.profiles order by is_admin desc, created_at;
```

以降のSQLの `<ADMIN_ID>` `<A_ID>` `<B_ID>` `<C_ID>` を、それぞれの `id`（uuid）に置き換える。
`<ADMIN_ID>` は `is_admin = true` のユーザーであること。**A・B・C の元の `account_type` を控えておく**（手順7で戻す）。

A と B を協力会社にする（SQL Editor からの変更は `fix_profiles_guard.sql` の対象外なので通る）。C は `employee` のままにする（違う場合は `employee` に直す）:

```sql
update public.profiles set account_type = 'partner' where id in ('<A_ID>', '<B_ID>');
update public.profiles set account_type = 'employee' where id = '<C_ID>';
```

- [ ] 管理者・A・B・C の4人分の id と、A・B・C の元の `account_type` を控えた
- [ ] A・B が `partner`、C が `employee` になった

## 1. テスト用の現場とメンバーを作る

現場X（Aが `staff`）と現場Y（Bが `staff`）を作る。C はどの現場にも割り当てない。SQL Editor は管理者権限（RLS 対象外）で動くので、そのまま実行できる。

```sql
insert into public.gn_sites (id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '検証現場X'),
  ('00000000-0000-0000-0000-0000000000b1', '検証現場Y')
on conflict (id) do nothing;

insert into public.gn_site_members (site_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '<A_ID>', 'staff'),
  ('00000000-0000-0000-0000-0000000000b1', '<B_ID>', 'staff')
on conflict (site_id, user_id) do nothing;
```

- [ ] 実行できた（エラーなし）

## 2. 現場の見え方（RLS）

「ユーザーとして実行」する書き方。`set local role` はそのトランザクション内だけ有効。

**Aとして読む（協力会社なので、割り当てられた現場Xだけ見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] Aには「検証現場X」だけが見えた（Yは見えない）

**Bとして読む（協力会社なので、割り当てられた現場Yだけ見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] Bには「検証現場Y」だけが見えた（Xは見えない）

**Cとして読む（社員なので、割り当てがなくても全現場が見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] Cには検証現場X・Yの両方が見えた（C は現場メンバーではない）

**管理者として読む（全現場が見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] 管理者には検証現場X・Yを含む全現場が見えた

**Aが現場を作ろうとする（拒否されるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_sites (name) values ('勝手に作った現場');
rollback;
```
- [ ] `new row violates row-level security policy` のエラーになった

## 3. gn_save_report を同じ日付で2回呼ぶ（Aとして・現場X）

1回目は明細2行、2回目は別内容の明細1行・天候も変更。最後に commit する。
明細の金額・人工はわざとでたらめな値（`amount: 999999` など）を送る。DB のトリガー（`gn_report_lines_compute`）が
入力値（時刻・日当・数量・単価）から計算し直すので、保存されるのは計算した値になる。

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);

select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-01","weather":"晴れ","supervisor":"検証太郎",
    "common_start":"08:00","common_end":"17:00","common_break_min":60,"common_gap_min":0}'::jsonb,
  '[{"kind":"labor","sort_order":1,"name":"山田","unit_price":20000,"man_days":9,"amount":999999},
    {"kind":"work","sort_order":2,"description":"解体","qty":1,"unit_price":50000,"amount":1}]'::jsonb
);

select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-01","weather":"曇り","supervisor":"検証太郎",
    "common_start":"08:00","common_end":"17:00","common_break_min":60,"common_gap_min":0}'::jsonb,
  '[{"kind":"labor","sort_order":1,"name":"鈴木","start_time":"08:00","end_time":"12:00","break_min":0,
     "unit_price":20000,"man_days":9,"amount":999999}]'::jsonb
);
commit;
```
- [ ] 2回とも同じ uuid が返った

結果の確認（管理者権限でそのまま実行）:
```sql
select id, report_date, weather, status, output_total, cost_total, man_days_total, created_by
  from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000a1';

select l.kind, l.sort_order, l.name, l.amount, l.man_days
  from public.gn_report_lines l
  join public.gn_daily_reports r on r.id = l.report_id
 where r.site_id = '00000000-0000-0000-0000-0000000000a1'
 order by l.sort_order;
```
- [ ] `gn_daily_reports` が **1件のまま**（weather=曇り、status=draft、created_by=A）
- [ ] 合計が `output_total=0, cost_total=10600, man_days_total=0.53` になっている（08:00〜12:00・休憩0 → 4H → 0.53人工 × 20000）
- [ ] `gn_report_lines` が **1件だけ**（鈴木・`man_days=0.53`・`amount=10600`。送った 999999 ではない。1回目の明細は残っていない）

**BがXの日報を読もうとする（Bは協力会社で現場Xの担当ではないので、見えないはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
select count(*) as reports from public.gn_daily_reports;
select count(*) as lines from public.gn_report_lines;
rollback;
```
- [ ] 両方 `0`

**3-2. 社員C（どの現場にも割り当てなし）が、現場Xの日報を読める**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C_ID>","role":"authenticated"}', true);
select report_date, weather from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000a1';
select count(*) as lines from public.gn_report_lines;
rollback;
```
- [ ] Cに現場Xの日報（2026-11-01・曇り）と、明細1件が見えた

**3-3. 社員Cが、割り当てのない現場Yに日報を作れる（入力できる）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000b1","report_date":"2026-11-06","weather":"晴れ","supervisor":"検証C"}'::jsonb,
  '[]'::jsonb
);
commit;
```
- [ ] エラーなく uuid が返った（現場Yの日報が作られた。手順7で消える）

**3-4. 社員Cは、その日報を承認できない（割り当てがないので `not_reviewer`）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set status = 'approved'
 where site_id = '00000000-0000-0000-0000-0000000000b1' and report_date = '2026-11-06';
rollback;
```
- [ ] エラーメッセージが `not_reviewer` だった（社員でも、確認者・承認者に割り当てられていなければ承認・差戻しはできない）
- [ ] （必要なら `rollback;` を単独実行した）

**3-5. 協力会社Aは、割り当てのない現場Yの日報を読めず、作れない**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select count(*) as reports_on_y from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000b1';
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000b1","report_date":"2026-11-07"}'::jsonb,
  '[]'::jsonb
);
rollback;
```
- [ ] 1つ目は `0`（現場Yの日報が見えない）
- [ ] 2つ目はエラー（権限なし）になった
- [ ] （必要なら `rollback;` を単独実行した）

## 4. 承認済みのロック

**4-1. Aが自分の現場の別の日報を承認しようとする（not_reviewer で失敗するはず）**

まずAとして別日付の日報を作る:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-02","weather":"雨"}'::jsonb,
  '[]'::jsonb
);
commit;
```
次にAが承認しようとする:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set status = 'approved'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
rollback;
```
- [ ] エラーメッセージが `not_reviewer` だった
- [ ] （必要なら `rollback;` を単独実行した）

**4-2. Aが `submitted` に変更するのは通る**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set status = 'submitted'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
select status from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
rollback;
```
- [ ] エラーなく `submitted` と表示された

**4-3. 管理者が 2026-11-01 の日報を承認する**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.gn_daily_reports
   set status = 'approved', approved_by = '<ADMIN_ID>', approved_at = now()
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-01';
commit;
```
- [ ] エラーなく更新できた

**4-4. Aが承認済み日報を更新しようとする（approved_report_locked で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set weather = '雨'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-01';
rollback;
```
- [ ] エラーメッセージが `approved_report_locked` だった

**4-5. Aが承認済み日報の明細を削除／追加しようとする（approved_report_locked で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
delete from public.gn_report_lines
 where report_id = (select id from public.gn_daily_reports
                     where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-01');
rollback;
```
- [ ] エラーメッセージが `approved_report_locked` だった

**4-6. Aが承認済み日報に `gn_save_report` を呼ぶ（approved_report_locked で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-01","weather":"雪"}'::jsonb,
  '[{"kind":"labor","sort_order":1,"name":"上書き","man_days":9,"amount":1}]'::jsonb
);
rollback;
```
- [ ] エラーメッセージが `approved_report_locked` だった

**4-7. 管理者は承認済みでも更新できる**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set notes_text = '管理者による修正'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-01';
rollback;
```
- [ ] エラーなく更新できた

## 5. Storage バケット

```sql
select id, public from storage.buckets where id in ('gn-photos','gn-estimates','gn-exports') order by id;
```
- [ ] 3件とも `public = false`

**現場メンバーは自分の現場のフォルダだけ見える（Storage ポリシー）**

オブジェクトは `<site_id>/...` のパスで保存する規約。ダミーの行を同じトランザクション内で作り、最後に `rollback` するので何も残らない（`storage.objects` の直接削除は禁止されているため、commit しないこと）。

```sql
begin;
insert into storage.objects (bucket_id, name, owner) values
  ('gn-photos', '00000000-0000-0000-0000-0000000000a1/test.txt', '<A_ID>'),
  ('gn-photos', '00000000-0000-0000-0000-0000000000b1/test.txt', '<B_ID>'),
  ('gn-photos', 'not-a-uuid/test.txt', '<A_ID>');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select name from storage.objects where bucket_id = 'gn-photos' order by name;
rollback;
```
- [ ] Aには `...a1/test.txt`（現場X）だけが見え、`...b1/test.txt`（現場Y）と `not-a-uuid/test.txt` は見えない

同じSQLの `<A_ID>`（`set_config` の行）を `<B_ID>` に変えて実行:
- [ ] Bには `...b1/test.txt` だけが見える

## 6. 承認ガードの追加検証（insert への適用・承認系の列・指摘事項の現場整合）

**6-1. Aが最初から `approved` の日報を insert する（not_reviewer で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_daily_reports (site_id, report_date, status, approved_by, approved_at)
values ('00000000-0000-0000-0000-0000000000a1', '2026-11-03', 'approved', '<A_ID>', now());
rollback;
```
- [ ] エラーメッセージが `not_reviewer` だった

**6-2. Aが draft の日報に `approved_by` だけを書き込む（status は変えない。not_reviewer で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set approved_by = '<A_ID>'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
rollback;
```
- [ ] エラーメッセージが `not_reviewer` だった（`reviewed_by` / `approved_at` / `rejected_reason` でも同様）

**6-3. Aが `created_by` を他人にして insert しても A に上書きされる**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_daily_reports (site_id, report_date, created_by)
values ('00000000-0000-0000-0000-0000000000a1', '2026-11-04', '<B_ID>')
returning report_date, created_by;
rollback;
```
- [ ] 返ってきた `created_by` が `<A_ID>`（Bではない）だった

**6-4. reviewer は承認できる（正のケース）**

管理者権限でBを現場Xの `reviewer` にする（Bは現場Yの staff のまま。画面からは協力会社に確認・承認を割り当てられないが、ここではDBのガードだけを確かめるので SQL で直接入れる）:
```sql
insert into public.gn_site_members (site_id, user_id, role) values ('00000000-0000-0000-0000-0000000000a1', '<B_ID>', 'reviewer')
on conflict (site_id, user_id) do nothing;
```
Bが 2026-11-02 の日報を承認する:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
update public.gn_daily_reports
   set status = 'approved', approved_by = '<B_ID>', approved_at = now(), reviewed_by = '<B_ID>'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02'
returning status, approved_by;
commit;
```
- [ ] エラーなく更新でき、`status = approved` が返った

**6-5. 管理者が承認を取り消すと、Aがまた編集できる**

管理者が差し戻し（承認系の列もクリア）:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.gn_daily_reports
   set status = 'submitted', approved_by = null, approved_at = null, reviewed_by = null
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
commit;
```
Aが編集:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set weather = '曇り'
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02'
returning weather, status;
rollback;
```
- [ ] エラーなく更新できた（`approved_report_locked` にならない）

**6-6. 他現場の日報に指摘事項を付けられない**

Bが現場Yで日報を作る（B は現場Yの staff）:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000b1","report_date":"2026-11-01"}'::jsonb, '[]'::jsonb);
commit;
```
Bの日報の id を調べて控える（管理者権限でそのまま実行）:
```sql
select id from public.gn_daily_reports where site_id = '00000000-0000-0000-0000-0000000000b1' and report_date = '2026-11-01';
```
AがそのidをBの日報として指定し、現場Xを名乗って指摘事項を追加しようとする（`<B_REPORT_ID>` を置き換える）:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_report_issues (site_id, report_id, body)
values ('00000000-0000-0000-0000-0000000000a1', '<B_REPORT_ID>', 'なりすまし指摘');
rollback;
```
- [ ] エラーメッセージが `report_not_found` だった（Aにはその日報が見えないため。指摘事項は作られない）

Aが自分の現場Xの日報に、site_id を現場Yと偽って追加する:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_report_issues (site_id, report_id, body)
select '00000000-0000-0000-0000-0000000000b1', id, '正しい現場に補正される' from public.gn_daily_reports
 where report_date = '2026-11-01' and site_id = '00000000-0000-0000-0000-0000000000a1'
returning site_id, body;
rollback;
```
- [ ] 返ってきた `site_id` が現場X（`...a1`）に補正されていた

**6-7. 通常の保存は引き続き通る**
- [ ] 手順3の `gn_save_report`（draft の日報への2回保存）が、ガード追加後も同じ結果で成功する（`gn_save_report` は承認系の4列と status を変更しないため）

**6-8. 合計3列は gn_save_report の外から変えられない（totals_locked で失敗するはず）**

Aが自分の現場の日報（2026-11-02、6-5 の後は submitted）の出来高合計を直接書き換えようとする:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.gn_daily_reports set output_total = 99999999
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02';
rollback;
```
- [ ] エラーメッセージが `totals_locked` だった

同じ update を `<ADMIN_ID>` で実行する:
- [ ] 管理者でも `totals_locked` だった（合計は gn_save_report の計算だけが書く）

Aが insert で合計を入れても 0 になる:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
insert into public.gn_daily_reports (site_id, report_date, output_total, cost_total, man_days_total)
values ('00000000-0000-0000-0000-0000000000a1', '2026-11-06', 1, 2, 3)
returning output_total, cost_total, man_days_total;
rollback;
```
- [ ] `0, 0, 0` が返った

**6-9. 楽観ロック（stale_report）**

Aが、古い版（`expected_updated_at`）を付けて 2026-11-02 を保存しようとする（stale_report で失敗するはず）:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-02","weather":"雪",
    "expected_updated_at":"2000-01-01T00:00:00+00:00"}'::jsonb,
  '[]'::jsonb
);
rollback;
```
- [ ] エラーメッセージが `stale_report` だった

いまの版を付ければ通る:
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  jsonb_build_object(
    'site_id', '00000000-0000-0000-0000-0000000000a1', 'report_date', '2026-11-02', 'weather', '雪',
    'expected_updated_at', (select updated_at from public.gn_daily_reports
                             where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-02')),
  '[]'::jsonb
);
rollback;
```
- [ ] エラーなく uuid が返った（`expected_updated_at` を付けない呼び出しは手順3のとおり比べずに通る）

**6-10. 作成者は下書きの日報を削除できる（明細も消える）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-05"}'::jsonb,
  '[{"kind":"cash","sort_order":1,"name":"テープ","qty":1,"unit_price":300}]'::jsonb
) as new_id;
-- 消す日報の id を控える（このトランザクションの中だけ）
select set_config('verify.rid', (select id::text from public.gn_daily_reports
  where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-05'), true);
delete from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date = '2026-11-05'
returning id, status;
-- 明細が残っていないかは管理者権限（RLS 対象外）で数える
reset role;
select count(*) as lines_left from public.gn_report_lines
 where report_id = current_setting('verify.rid')::uuid;
rollback;
```
- [ ] `delete` が1行（`status = draft`）を返した
- [ ] `lines_left` が `0`（明細も一緒に消えた）

**6-11. 承認済み・提出済みの日報は作成者でも削除できない**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
delete from public.gn_daily_reports
 where site_id = '00000000-0000-0000-0000-0000000000a1' and report_date in ('2026-11-01', '2026-11-02')
returning id;
rollback;
```
- [ ] 0行（2026-11-01 は承認済み、2026-11-02 は提出済み。RLS で対象にならないのでエラーは出ない）

同じ delete を `<ADMIN_ID>` で実行する（rollback で戻す）:
- [ ] 2行が返った（管理者はどの状態でも削除できる）

## 7. 後片付け

管理者として日報を削除してから、現場を削除する（日報があると現場は消せない）。

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
delete from public.gn_daily_reports
 where site_id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
commit;

delete from public.gn_sites
 where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
```
- [ ] テストデータを削除した（現場メンバーは現場と一緒に消える）

A・B・C の区分を、手順0で控えた元の値に戻す（例：全員 `employee` だった場合）。手順8の確認（A が `employee` であること）はこのあとに行う:
```sql
update public.profiles set account_type = 'employee' where id in ('<A_ID>', '<B_ID>', '<C_ID>');
```
- [ ] A・B・C の `account_type` を元に戻した

## 8. 既存 profiles の保護（`supabase/fix_profiles_guard.sql` を適用した後）

すべて rollback するので、profiles は変わらない。

**8-1. 管理者でない利用者が自分を管理者にしようとする（is_admin_locked で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.profiles set is_admin = true where id = '<A_ID>';
rollback;
```
- [ ] エラーメッセージが `is_admin_locked` だった

**8-2. 管理者でない利用者も、is_admin 以外の列は今までどおり更新できる**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.profiles set name = name where id = '<A_ID>' returning id, is_admin;
rollback;
```
- [ ] エラーなく1行が返った（`is_admin` は false のまま）

**8-3. 管理者は他人の is_admin を変えられる・SQL Editor からも変えられる**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.profiles set is_admin = true where id = '<A_ID>' returning id, is_admin;
rollback;

begin;
update public.profiles set is_admin = true where id = '<A_ID>' returning id, is_admin;
rollback;
```
- [ ] どちらもエラーなく `is_admin = true` が返った（rollback で元に戻る）

**8-4. 管理者でない利用者が自分の区分・会社名を変えようとする（account_type_locked で失敗するはず）**
（`supabase/add_profile_account_type.sql` を適用済みであること。A は現在 `employee` とする）
```sql
-- (a) 社員 → 協力会社 に自分で変える
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.profiles set account_type = 'partner' where id = '<A_ID>';
rollback;

-- (b) 会社名を自分で付ける
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.profiles set company_name = 'テスト工業' where id = '<A_ID>';
rollback;

-- (c) 協力会社の本人が employee に書き換える（同じトランザクション内で、先に管理者が partner にしておく）
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.profiles set account_type = 'partner', company_name = 'テスト工業' where id = '<A_ID>';
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
update public.profiles set account_type = 'employee' where id = '<A_ID>';
rollback;
```
- [ ] (a)(b)(c) のすべてで、エラーメッセージが `account_type_locked` だった

**8-5. 管理者は他人の区分・会社名を変えられる**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
update public.profiles set account_type = 'partner', company_name = 'テスト工業' where id = '<A_ID>' returning id, account_type, company_name;
rollback;
```
- [ ] エラーなく `account_type = partner`、`company_name = テスト工業` が返った（rollback で元に戻る）

## 9. 現場の削除と完了現場（`supabase/update_2026-11-02_site_archive.sql` を適用した後）

新規環境では `schema_genba.sql` に同じ内容が含まれている。手順0の A（**協力会社**にする）・C（**社員**）と管理者を使う。
手順7で区分を戻した後に行う場合は、もう一度 A を協力会社にしてから始め、最後の 9-5 で戻す。

**9-0. 準備（検証現場Z＝進行中、検証現場W＝完了。A を両方の担当にする）**
```sql
update public.profiles set account_type = 'partner' where id = '<A_ID>';
update public.profiles set account_type = 'employee' where id = '<C_ID>';

insert into public.gn_sites (id, name, status) values
  ('00000000-0000-0000-0000-0000000000c1', '検証現場Z', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', '検証現場W', 'done')
on conflict (id) do nothing;

insert into public.gn_site_members (site_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000c1', '<A_ID>', 'staff'),
  ('00000000-0000-0000-0000-0000000000c2', '<A_ID>', 'staff')
on conflict (site_id, user_id) do nothing;
```
- [ ] 実行できた（エラーなし）

**9-1. 一般ユーザーは現場を削除できない（not_admin で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<C_ID>","role":"authenticated"}', true);
select public.gn_archive_site('00000000-0000-0000-0000-0000000000c1', '検証');
rollback;
```
- [ ] エラーメッセージが `not_admin` だった（`<A_ID>` に替えても同じ）
- [ ] 同じ利用者で `insert into public.gn_site_audit_log (site_name, action) values ('x', 'archive');` を実行すると権限エラーになった（ログは関数経由でしか書けない）

**9-2. 管理者が削除する（ログが残る）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
select public.gn_archive_site('00000000-0000-0000-0000-0000000000c1', '検証のため');
commit;

select id, deleted_at is not null as deleted, deleted_by from public.gn_sites
 where id = '00000000-0000-0000-0000-0000000000c1';
select site_name, action, actor_id, actor_email, reason from public.gn_site_audit_log
 where site_id = '00000000-0000-0000-0000-0000000000c1' order by id desc;
```
- [ ] `deleted = true`、`deleted_by` が管理者の id
- [ ] ログに `検証現場Z / archive / <ADMIN_ID> / 管理者のメール / 検証のため` の1行がある

**9-3. 削除済みの現場は協力会社・社員の select から消える（管理者には見える）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites where id = '00000000-0000-0000-0000-0000000000c1';
rollback;
```
- [ ] A（協力会社・担当者）で 0行
- [ ] `<C_ID>`（社員）に替えても 0行
- [ ] `<ADMIN_ID>` に替えると 1行（アプリ側で `deleted_at` を見て一覧から除く）
- [ ] `<C_ID>` で `select count(*) from public.gn_site_audit_log;` が `0`（ログは管理者だけが読める）

**9-4. 完了現場では日報を保存できない（site_closed で失敗するはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000c2","report_date":"2026-11-02","weather":"晴れ","supervisor":"検証太郎",
    "common_start":"08:00","common_end":"17:00","common_break_min":60,"common_gap_min":0}'::jsonb,
  '[]'::jsonb
);
rollback;
```
- [ ] エラーメッセージに `site_closed` が含まれた（`<ADMIN_ID>` でも同じ。管理者も完了現場には書けない）
- [ ] 現場Z（削除済み、`...c1`）に替えて `<ADMIN_ID>` で実行しても `site_closed` だった

**9-5. 復元と後片付け**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<ADMIN_ID>","role":"authenticated"}', true);
select public.gn_restore_site('00000000-0000-0000-0000-0000000000c1');
commit;

select action, reason from public.gn_site_audit_log
 where site_id = '00000000-0000-0000-0000-0000000000c1' order by id;
```
- [ ] `archive` → `restore` の2行になった（9-3 の A の select をもう一度実行すると 1行に戻る）

検証用の行を消し、A・C の区分を元に戻す（SQL Editor から実行。ログは authenticated からは消せないが、SQL Editor からは消せる）:
```sql
delete from public.gn_site_audit_log
 where site_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
delete from public.gn_sites
 where id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2');
update public.profiles set account_type = 'employee' where id in ('<A_ID>', '<C_ID>');
```
- [ ] テストデータを削除し、A・C の `account_type` を手順0で控えた元の値に戻した
