# gn_ スキーマ 適用・RLS 検証手順

## 適用のしかた
1. Supabase ダッシュボードで対象プロジェクトを開き、左メニューの **SQL Editor** → **New query** を開く。
2. `supabase/schema_genba.sql` の中身を全部コピーして貼り付ける。
3. **Run** を押し、エラーなく終わることを確認する（何度実行しても安全。既存の業務報告アプリのテーブルは変更されない）。

> 以降の検証は、すべて SQL Editor に貼って実行する。結果は各チェックボックスに記録する（実行した人が入れる）。
> 「失敗するはず」のテストでエラーが出たあと、画面がエラー状態のままなら `rollback;` だけを単独で実行してから次へ進む。

---

## 0. 準備：テスト用アカウントの確認

既存アプリのアカウントから、管理者1名・担当者2名（A, B）を選ぶ。ID を調べる:

```sql
select id, name, email, is_admin from public.profiles order by is_admin desc, created_at;
```

以降のSQLの `<ADMIN_ID>` `<A_ID>` `<B_ID>` を、それぞれの `id`（uuid）に置き換える。
`<ADMIN_ID>` は `is_admin = true` のユーザーであること。

- [ ] 管理者・A・B の3人分の id を控えた

## 1. テスト用の現場とメンバーを作る

現場X（Aが `staff`）と現場Y（Bが `staff`）を作る。SQL Editor は管理者権限（RLS 対象外）で動くので、そのまま実行できる。

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

**Aとして読む（現場Xだけ見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] Aには「検証現場X」だけが見えた（Yは見えない）

**Bとして読む（現場Yだけ見えるはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
select id, name from public.gn_sites;
rollback;
```
- [ ] Bには「検証現場Y」だけが見えた（Xは見えない）

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

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<A_ID>","role":"authenticated"}', true);

select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-01","weather":"晴れ","supervisor":"検証太郎"}'::jsonb,
  '[{"kind":"labor","sort_order":1,"name":"山田","man_days":1,"amount":20000},
    {"kind":"work","sort_order":2,"name":"解体","amount":50000}]'::jsonb
);

select public.gn_save_report(
  '{"site_id":"00000000-0000-0000-0000-0000000000a1","report_date":"2026-11-01","weather":"曇り","supervisor":"検証太郎"}'::jsonb,
  '[{"kind":"labor","sort_order":1,"name":"鈴木","man_days":0.5,"amount":10000}]'::jsonb
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
- [ ] 合計が `output_total=0, cost_total=10000, man_days_total=0.5` になっている
- [ ] `gn_report_lines` が **1件だけ**（鈴木・0.5人工。1回目の明細は残っていない）

**BがXの日報を読もうとする（見えないはず）**
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<B_ID>","role":"authenticated"}', true);
select count(*) as reports from public.gn_daily_reports;
select count(*) as lines from public.gn_report_lines;
rollback;
```
- [ ] 両方 `0`

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

## 6. 後片付け

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
