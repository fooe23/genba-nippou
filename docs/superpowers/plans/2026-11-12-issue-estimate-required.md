# 件の見積書（要［先に出す］・要［後出し］・不要）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現場の設定「見積提出が必須のお客様」と件の欄「見積書」（要［先に出す］・要［後出し］・不要）を足し、要（先に出す）で見積提出の記録が無い件を対応中・完了にさせない（画面と DB）。要の件で記録が無いあいだは赤い印を日報・件のバナー・現場の画面・追加・変更の一覧に出し続け、後出しの件を完了にするときはお客様のサイン（1 回だけ）を勧める。

**Architecture:** 2 段階。第 1 段階＝DB（SQL 差分 1 本）・純関数・読み書き・現場の設定・件の見積書の欄・状態の止め・赤い印。第 2 段階＝後出しの完了でサインを勧める・サインの候補に「その日に完了にした件」を足す・ガイド。SQL は第 1 段階の 1 本だけ。判定はすべて `src/lib/report/estimate-requirement.ts` の純関数にして、画面・Server Action・テストで同じものを使う（`estimate-submitted.ts`・`issue-status.ts` の流儀）。

**Tech Stack:** Next.js 16 App Router、React 19、Tailwind 4、Supabase（Postgres RLS・plpgsql）、Zod 4、Vitest（node 環境）。

**Spec:** `docs/superpowers/specs/2026-11-12-issue-estimate-required-design.md`（計画と食い違えば設計書が正）。見本：`.superpowers/brainstorm/24602-1794232833/content/issue-estimate-1.html`。

## 決めたこと（利用者 2026-11-12・問いへの答え。設計書の 7〜12）

1. 見積書の欄を変えられるのは社員・管理者だけ（協力会社は件を作れ、赤い印・止まる理由は見えるが、金額・日付・ファイルは見えない）。
2. 必須の現場の新しい件は、種別が「やり直し」（`rework`）なら「不要」、ほかは「要（先に出す）」。→ `defaultEstimateRequirement(siteRequired, kind)`（Task 1）、SQL の協力会社の insert も種別を見る（Task 2）、追加の欄・行の件の既定（Task 5）。
3. 社員が件に見積書のファイルを付けたら「見積提出も記録しますか？」（記録する／今はしない）。記録するは今日の日で `setEstimateSubmitted`。→ 第 1 段階の Task 5（`IssueAttachments`）。列の有無に関係なく出せる（見積提出の列は 11-14 から有る）。
4. 後出しの件のお客様用の確認画面とその PDF に「お見積りは後日お出しします」。→ 第 2 段階の Task 6。
5. 完了でサインを勧めるのは後出しの件だけ（今の計画のとおり）。
6. ホームの現場の一覧と管理者の現場の一覧に赤い字で「見積が未提出の件 N 件」（社員・管理者だけ。0 件は出さない）。→ Task 3（`countEstimatePendingBySite(siteIds)`。列が無ければ空）・Task 5（画面）。

ほかは計画のとおり：オフの現場は「不要」・既存の件は記録があるものだけ「要（先に出す）」・PDF を付けただけでは提出とみなさない・N 日は日報の日付から今日（日本時間）まで。

## Global Constraints

- 見積書の値：`'before'`＝要（先に出す）・`'after'`＝要（お客様の指示で先に対応・後出し）・`'none'`＝不要。型 `EstimateRequirement`（`src/lib/types.ts`）。表示名は `ESTIMATE_REQUIREMENT_LABELS`。
- 「未提出」＝見積書が `before` か `after` で、見積提出の日（`estimate_submitted_on`）が null。見積書の PDF の添付は提出とみなさない。
- 止める：`before` で未提出の件は対応中・完了にできない。対応中・完了で未提出の件を `before` にできない。`before` の対応中・完了の件の記録を取り消せない。DB の拒否は `estimate_required_first`。
- 見積書の欄を変えるのは社員・管理者だけ（協力会社が作る件は DB が現場の設定から決める）。日報の状態に関係なくいつでも（件の中身の鍵の対象外）。完了現場は不可（今の `site_closed`）。
- 協力会社：赤い印と止める理由は見える。見積書の中身・金額・ファイル・提出の日・「見積書あり／なし」「見積提出 MM/DD」は今までどおり見えない（`hideEstimateFromPartner` は提出の日を消すが、`estimatePending` は消さない）。
- **SQL の前でも動く**：列が無い（`42703`・`PGRST204`）ときは、見積書の欄・現場の設定・赤い印・止める判定を出さず、件・現場の読み書きは今までの列だけで行う。準備の判定は `issueEstimateColumnsReady()`（件）と、現場の読み直し（`estimate_required` 抜き）で行う。
- SQL：`supabase/update_2026-11-20_issue_estimate.sql`（`begin/commit`、何度実行しても安全）＋ `schema_genba.sql` に反映（新規環境の順番）＋ `verify_rls_auto.sql` に 24 番の検査。名前付き制約 `gn_report_issues_estimate_requirement_ck`（自動名 `gn_report_issues_estimate_requirement_check` と重ねない）。`gn_report_issues_guard` は `update_2026-11-14_estimate_submitted.sql` の定義をそのまま写して足すだけ（消す・変える行が無いことを diff で確かめる）。作り手は `npm run check:sql` だけ。SQL をデータベースに対して実行しない。利用者が SQL Editor で実行してからデプロイ。
- UI は日本語、375px、44px。`templates/` は触らない。コミットの末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の指示で。

## Review Focus

- `gn_report_issues_guard` の差し替えで、今までの確かめ（`issue_report_fixed`・`report_not_found`・`site_closed`・`not_employee`・見積提出の記録した人・`issue_locked`・`issue_not_own`）が 1 行も変わっていないこと（`diff` で消えた行が 0）。
- 承認済みの日報の件でも、不要・後出し・記録ありの件の状態は今までどおり変えられること（verify 24-6）。
- 協力会社のアカウントで、件の読み込みに提出の日が載らず、`estimatePending` だけが載ること（Task 3 のテスト）。
- SQL の前（列が無い）で、日報・現場・追加・変更の一覧・お客様用の確認画面が今までどおり開け、件を作れること（Task 3 の読み直しのテスト・手での確認）。
- 後出しの件を完了にしたとき、サインの確認画面の候補にその件が入っていること（前の日の件でも）。

---

## 第 1 段階：見積書の欄・止め・赤い印

### Task 1: 純関数（見積書の判定・印・文言）

**Files:**
- Create: `src/lib/report/estimate-requirement.ts`、`tests/report/estimate-requirement.test.ts`
- Modify: `src/lib/types.ts`（`EstimateRequirement`）、`src/lib/report/estimate-submitted.ts`（`estimateBadges` に `pendingBadge: boolean` を足し、赤い印が出る件では `missing` を出さない。`canRecordEstimateSubmitted` は完了した件でも見積書が要なら true）、`tests/report/estimate-submitted.test.ts`

**Interfaces（Produces）:**
- `ESTIMATE_REQUIREMENTS = ['before','after','none'] as const`、`ESTIMATE_REQUIREMENT_LABELS`（`before`：要（先に出す）／`after`：要（お客様の指示で先に対応・後出し）／`none`：不要）、`isEstimateRequirement(v): v is EstimateRequirement`、`estimateRequirementSchema`（zod）。
- `defaultEstimateRequirement(siteRequired: boolean, kind?: IssueKind | null): EstimateRequirement` → オンで種別が `rework` 以外は `before`、オンの `rework`・オフは `none`（決めたこと 2）。
- `isEstimatePending(i: { estimateRequirement; estimateSubmittedOn }): boolean`。
- `blockedStatusChange(i: { estimateRequirement; estimateSubmittedOn; status }, next: IssueStatus): 'estimate_required_first' | null` → `before`・未提出・next が `open`/`done` で理由、それ以外 null。
- `blockedRequirementChange(i: { status; estimateSubmittedOn }, next: EstimateRequirement): 'estimate_required_first' | null` → next が `before`・未提出・status が `open`/`done` で理由。
- `blockedEstimateClear(i: { estimateRequirement; status }): boolean` → `before` かつ status が `open`/`done`。
- `newIssueStatusFor(requirement, requested: 'estimating' | 'open' | undefined): 'estimating' | 'open'` → `before` なら常に `estimating`、それ以外は requested ?? `open`。
- `daysSinceRequest(reportDate: string, today: string): number`（日本時間の暦日の差。負は 0）。
- `estimatePendingBadge(i: { estimateRequirement; estimatePending: boolean; reportDate }, today): { tone: 'red'; label: string; days: number; daysLabel: string } | null` → `before`：「必須の見積書が未提出」、`after`：「見積書が未提出（後出し）」、`daysLabel`：「依頼から N 日」（0 は「依頼の当日」）。未提出でなければ null。
- `shouldOfferSignature(p: { requirement; next: IssueStatus; current: IssueStatus; kind: IssueKind; canSign: boolean }): 'offer' | 'later_only' | 'no'` → `after`・完了へ・やり直しでない → canSign なら `offer`、でなければ `later_only`。ほかは `no`。
- 文言：`ESTIMATE_REQUIRED_FIRST_MESSAGE`（「見積提出が必須の件です。見積提出を記録するまで、対応中・完了にはできません。お客様の指示で先に対応するときは、見積書を『要（お客様の指示で先に対応・後出し）』に変えてください。」）、`ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE`（「見積提出が必須の件です。社員が見積提出を記録するまで、対応中・完了にはできません。」）、`ESTIMATE_CLEAR_BLOCKED_MESSAGE`（「対応中・完了の件です。見積提出の記録を取り消すときは、先に見積書を『後出し』に変えてください。」）、`ESTIMATE_REQUIREMENT_STAFF_ONLY_MESSAGE`。
- `estimateRequirementErrorMessage(dbMessage: string, op: 'status' | 'requirement' | 'clear', isStaff: boolean): string | null`（`estimate_required_first` を op ごとの文言に）。

- [ ] **Step 1: テスト**：
  - 既定：オン → before（種別なし・追加など）、オンのやり直し → none、オフ → none。
  - 止め：before・未提出で 見積中→対応中／見積中→完了／対応中→完了 が止まる、見積中→見積中は止めない。before・提出済み・after・none は止めない。
  - 見積書の変更：対応中・未提出で before に変える → 止める、見積中なら止めない、提出済みなら止めない。
  - 取り消し：before の対応中・完了は止める、before の見積中・after の完了は止めない。
  - 新しい件の状態：before なら open を渡しても estimating、after・none は渡したまま（省略は open）。
  - 日数：同じ日 0「依頼の当日」、11/4 → 11/6 は 2「依頼から 2 日」、月・年をまたぐ、今日より後の依頼日は 0。
  - 印：before 未提出 →「必須の見積書が未提出」、after 未提出 →「見積書が未提出（後出し）」、none・提出済みは null、完了した after 未提出も印あり。
  - サイン：after・完了へ・canSign → offer、canSign false → later_only、before・none・やり直し・完了→完了 → no。
  - `estimateBadges`：赤い印が出る件（pendingBadge true）は見積中でも `missing` を出さない、`file` は出す。協力会社は今までどおり空。
  - `canRecordEstimateSubmitted`：完了した after の件 → true、完了した none の件 → false（今まで通り）。
- [ ] **Step 2: 失敗を確認**（`npx vitest run tests/report/estimate-requirement.test.ts tests/report/estimate-submitted.test.ts`）
- [ ] **Step 3: 実装** → **Step 4:** `npm test`・`npx tsc --noEmit`・`npm run lint`
- [ ] **Step 5: コミット** `feat(issue): 件の見積書（要・後出し・不要）の判定と印の純関数`

### Task 2: SQL（列・制約・件のガード）と verify

**Files:**
- Create: `supabase/update_2026-11-20_issue_estimate.sql`（下の全文）
- Modify: `supabase/schema_genba.sql`（`gn_sites` の列は `default_daily_rate` の後［**`revoke select on public.gn_sites`・列の grant の do ブロックより前**。新規環境では do ブロックが列を拾う］、`gn_report_issues.estimate_requirement` は `estimate_submitted_by` の後に `add column if not exists ... not null default 'none'` と名前付き制約の drop/add、`gn_report_issues_guard` は下と同じ定義に置き換え・前のコメントに 2026-11-20 を 1 行足す。既存の件を埋める do ブロックは schema には入れない［新規環境は件が無い］）、`supabase/verify_rls_auto.sql`（先頭のコメントに「24 は件の見積書［update_2026-11-20］」、24 番の検査）、README の SQL の一覧
- Test: `npm run check:sql`（構文だけ。実行しない）

**SQL 全文**（`update_2026-11-14_estimate_submitted.sql` の関数をそのまま写し、`v_staff`・`v_required` の宣言と「件の見積書」のかたまりだけを足したもの。作り手は `diff` で、前の定義から消えた行が無いことを確かめる）：

```sql
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
    if tg_op = 'INSERT' and not v_staff then
      select s.estimate_required into v_required from public.gn_sites s where s.id = v_site;
      new.estimate_requirement := case when coalesce(v_required, false) and new.kind is distinct from 'rework' then 'before' else 'none' end;
    elsif tg_op = 'UPDATE' and not v_staff and new.estimate_requirement is distinct from old.estimate_requirement then
      raise exception using message = 'not_employee';
    end if;
    -- 要（先に出す）で見積提出の記録が無い件は、見積中のまま。insert の対応中は見積中にし、完了は断る。
    -- update は状態・見積書の欄・見積提出の日のどれかが変わったときだけ確かめる。
    if new.estimate_requirement = 'before' and new.estimate_submitted_on is null and new.status in ('open','done') then
      if tg_op = 'INSERT' and new.status = 'open' then
        new.status := 'estimating';
        new.done_at := null;
      elsif tg_op = 'INSERT'
         or new.status is distinct from old.status
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
```

（計画を書いたときに、この全文を `npm run check:sql <ファイル>` で構文だけ確かめた：10 文・plpgsql 1 本 OK。前の定義との diff で消えた行は 0。）

**verify 24 番**（`verify_rls_auto.sql`。今の書き方［`pg_temp.as_user`・例外で PASS/FAIL を足す］どおり。現場は必須オンで作る）：
- 24-1 協力会社が必須の現場で件を作る（`estimate_requirement` に 'none'・status 'open' を渡す）→ 'before'・'estimating' になる。
- 24-2 協力会社が見積書の欄を変える → `not_employee`。
- 24-3 社員が before・未提出の件を対応中にする → `estimate_required_first`、完了も同じ。
- 24-4 社員が見積提出を記録（当日）してから対応中・完了にできる。
- 24-5 before の対応中の件の記録を取り消す → `estimate_required_first`。after に変えてから取り消せる。
- 24-6 承認済みの日報の after・none の件の状態は社員も協力会社も変えられる（今までどおり）。before・記録ありの件も変えられる。
- 24-7 対応中・未提出の件を before に変える → `estimate_required_first`。見積中なら変えられる。
- 24-8 必須オフの現場で協力会社が作る件は 'none'。必須の現場で協力会社が作るやり直しの件も 'none'。社員が作るとき渡した 'after' はそのまま。
- 24-9 制約：'later' を入れると check 違反（`gn_report_issues_estimate_requirement_ck`）。
- 24-10 協力会社は `gn_sites.estimate_required` を読める（列の SELECT）。`contract_amount` は今までどおり読めない。

- [ ] **Step 1:** SQL を書く → `npm run check:sql`（全部）。`diff` で `gn_report_issues_guard` の前の定義から消えた行が無いことを確かめる。
- [ ] **Step 2:** `schema_genba.sql` に反映 → `npm run check:sql`。
- [ ] **Step 3:** `verify_rls_auto.sql` に 24 番 → `npm run check:sql`。**データベースでは実行しない。**
- [ ] **Step 4: コミット** `feat(db): 件の見積書と見積提出が必須の現場（update_2026-11-20）`

### Task 3: 型・読み書き（件・現場）と SQL の前の読み直し

**Files:**
- Modify: `src/lib/db/reports.ts`（`Issue` に `estimateRequirement: EstimateRequirement` と `estimatePending: boolean`。`ISSUE_COLUMNS` に `estimate_requirement`。`toIssue` で `estimatePending` を決める［提出の日を消す前］。`hideEstimateFromPartner` は提出の日だけ消し、`estimatePending` は残す。`issueEstimateColumnsReady()` を足す［`subcontractColumnsReady` と同じ形、React の `cache` で 1 リクエスト 1 回］。列が無いときは `estimate_requirement` 抜きの列で読み、`estimateRequirement: 'none'`・`estimatePending: false`。完了した要の未提出の件を読む `listEstimatePendingDoneIssues(siteId)`［status 'done'・`estimate_requirement` が before/after・提出の日 null。列が無ければ空］、現場ごとの未提出の件の数 `countEstimatePendingBySite(siteIds)`［決めたこと 6。列が無ければ空］）、`src/lib/db/sites.ts`（`Site.estimateRequired: boolean | null`［null＝SQL の前］。`SITE_COLUMNS` に `estimate_required` を足して読み、`42703` なら抜いて読み直して null）、`src/lib/db/sites-schemas.ts`・`sites-actions.ts`（`estimateRequired` は省略可。省略なら変えない。列が無い［`PGRST204`/`42703`］ときは外して保存し直す。`settings-actions.ts` の率と同じやり方）、`src/lib/report/form-props.ts`（日報の画面に `estimateReady: boolean`・`siteEstimateRequired: boolean`・`today`）
- Test: `tests/report/issue-row.test.ts`（`toIssue` を純関数として export するか、`issueFromRow` に切り出して：列あり／列なしの行、協力会社の隠しで提出の日が null・`estimatePending` は残る）、`tests/sites/site-row.test.ts`（`estimate_required` の有無）

- [ ] **Step 1: テスト** → **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4:** test・tsc・lint
- [ ] **Step 5: コミット** `feat(issue): 件の見積書・現場の必須の設定の読み書き（SQL の前も動く）`

### Task 4: Server Action（件の作成・状態・見積書の欄・見積提出）

**Files:**
- Modify: `src/lib/db/reports-actions.ts`、`src/lib/db/issue-schemas.ts`
- Test: `tests/report/issue-schemas.test.ts`（なければ作る。新しい件の入力・見積書の入力の検証）

**Interfaces:**
- `addIssue(reportId, body, extra?: IssueExtraInput & { status?: NewIssueStatus; estimateRequirement?: EstimateRequirement })`：列があるとき、社員・管理者は渡した値（省略は現場の既定 `defaultEstimateRequirement(site.estimateRequired)`）を入れる。協力会社は値を送らない（DB が決める）。状態は `newIssueStatusFor(requirement, extra.status)`。列が無いときは今までどおり（見積書を送らない）。`newIssueStatusSchema` の既定（open）は残し、`newIssueStatusFor` で上書きする。
- `setIssueStatus`：DB の `estimate_required_first` を `estimateRequirementErrorMessage(..., 'status', isStaff)` に。先に読んで止めることはしない（DB が正。画面は Task 5 で先に止める）。
- 新しく `setEstimateRequirement(issueId, requirement): Promise<ReportStateResult>`：社員・管理者だけ（協力会社は `ESTIMATE_REQUIREMENT_STAFF_ONLY_MESSAGE`）。列が無ければ「まだ使えません（管理者に SQL の実行を頼んでください）」。DB の拒否は `estimateRequirementErrorMessage(..., 'requirement', true)`・`site_closed` は今の文言。`revalidatePath('/sites/' + siteId, 'layout')`。
- `setEstimateSubmitted`：取り消し（null）の拒否 `estimate_required_first` を `ESTIMATE_CLEAR_BLOCKED_MESSAGE` に。
- `issueErrorMessage` に `estimate_required_first` を足す（ほかの経路の保険）。

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装 → test・tsc・lint
- [ ] **Step 5: コミット** `feat(issue): 件の見積書の欄を変える・必須の件の状態の止めの文言`

### Task 5: 画面（現場の設定・件の見積書の欄・状態の止め・赤い印）

**Files:**
- Create: `src/components/report/IssueEstimateRequirement.tsx`（件の「見積書：〇〇 ▾」。社員・管理者は押すと 3 つのボタン［44px］、`blockedRequirementChange` が理由を返す選択肢は押せない［理由を小さく出す］。協力会社・完了現場・列なしは表示だけ／出さない）、`src/components/report/EstimatePendingBadge.tsx`（赤い丸い印＋「依頼から N 日」。`estimatePendingBadge` の結果を出す。協力会社にも出す）
- Modify:
  - `src/components/sites/SiteForm.tsx`（「見積提出が必須のお客様」のチェック［44px］と説明「オンにすると、この現場で新しく作る件の『見積書』が最初から『要（先に出す）』になります。件ごとに変えられます。」。`site.estimateRequired === null` なら出さない）、`src/app/(app)/admin/sites/[siteId]/page.tsx`（必要なら値を渡す）
  - `src/components/report/IssueStatusChip.tsx`（props に `estimate?: { requirement; submittedOn; pending; isStaff }`。`blockedStatusChange` が理由を返す状態のボタンは押せなくし、開いたときに赤い枠［`role="alert"` ではなく `role="note"`］で `ESTIMATE_REQUIRED_FIRST_MESSAGE`／協力会社は `..._PARTNER_MESSAGE` を出す。社員には枠の中に「見積書を後出しにする」ボタン［`setEstimateRequirement(id,'after')`］）
  - `src/components/report/ReportForm.tsx` の `IssueList`（件ごとに `EstimatePendingBadge`・`IssueEstimateRequirement`。追加の欄に「見積書」の選択［社員・管理者。既定は現場の設定］、協力会社は「見積書：要（先に出す）（現場の設定）」の表示だけ。見積書が before なら状態の選択は見積中だけ）
  - `src/components/report/tables/LineIssueCreator.tsx`（社員・管理者に見積書の選択。既定は現場の設定。行の件は工事が済んでいることが多いので、before のとき「先に工事をした件なら『後出し』にしてください」と 1 行）
  - `src/components/report/IssueBanner.tsx`（赤い印・見積書の欄。見積中・対応中の件に加えて、`listEstimatePendingDoneIssues` の完了した後出しの件も「見積書が未提出の完了した件」として出す。そこには「見積提出を記録」を出す）
  - `src/components/report/IssueEstimateSubmitted.tsx`（取り消しを `blockedEstimateClear` で押せなくし、理由を出す。完了した要の件でも「見積提出を記録」）
  - `src/components/attachments/IssueAttachments.tsx`（`estimateBadges` に `pendingBadge` を渡す。社員が見積書のファイルを付けて、まだ見積提出の記録が無ければ「見積提出も記録しますか？」［記録する／今はしない。44px］。記録するは今日の日で `setEstimateSubmitted`［決めたこと 3］）
  - `src/app/(app)/page.tsx`（ホーム）・`src/app/(app)/admin/sites/page.tsx`（管理者の現場の一覧）：社員・管理者に赤い字「見積が未提出の件 N 件」（`countEstimatePendingBySite`。0 件・協力会社は出さない［決めたこと 6］）
  - `src/components/site/SiteSummary.tsx`・`src/app/(app)/sites/[siteId]/page.tsx`（件ごとに赤い印。見出しの下に「見積書が未提出の完了した件（N 件）」の小さな一覧）
  - `src/components/changes/ChangesTable.tsx`（件の行に赤い印。完了した件にも）
  - `src/components/report/ClientConfirmView.tsx` は変えない（お客様に赤い印は出さない）。
- Test: 画面の純関数は Task 1 のもの。追加の欄の初めの値と状態の選択肢の純関数 `newIssueFormDefaults(siteRequired, isStaff, ready)`（Task 1 のファイルに足す）のテスト。

- [ ] **Step 1: テスト**（`newIssueFormDefaults`：列なし → 見積書を出さない・状態は見積中／対応中、オン・社員 → before・状態は見積中だけ、オフ・社員 → none、協力会社 → 選択なし・表示は現場の設定）
- [ ] **Step 2〜4:** 失敗を確認 → 実装（見本の ③⑤ のとおり。375px で印・札・ボタンが折り返して重ならない）→ test・tsc・lint・build
- [ ] **Step 5:** 手で確かめる（dev で：必須オンの現場で件を作る → 見積中・赤い印・対応中が押せない → 後出しにする → 対応中にできる → 記録すると印が消える。協力会社のアカウントで印と止める理由が見え、見積書あり／提出日・ボタンが見えない。SQL の前の DB［列なし］でも日報・現場・一覧が開く）
- [ ] **Step 6: コミット** `feat(issue): 見積提出が必須の現場・件の見積書の欄・未提出の赤い印`

**第 1 段階の区切り：** 最終レビュー（Review Focus）→ 利用者が `update_2026-11-20_issue_estimate.sql` と verify を SQL Editor で実行 → push。

---

## 第 2 段階：後出しの完了とサイン・ガイド

### Task 6: 後出しの完了でサインを勧める・サインの候補

**Files:**
- Modify:
  - `src/components/report/IssueStatusChip.tsx`（props に `signHref: string | null`・`kind`。`shouldOfferSignature` が `offer`／`later_only` のとき、完了を押すと小さな確認（`EditDialog` の流儀）：「この件を完了にします」「見積書：要（お客様の指示で先に対応・後出し）」「お客様に、完了の確認（サイン）をもらいますか？」［サインをもらう］［あとで］。どちらも先に `setIssueStatus(id,'done')`、サインをもらうは成功したら `router.push(signHref)`。`later_only` は［あとで］だけと理由（「日報を保存するとサインをもらえます」／「この日報にはもうサインがあります」）。確認を閉じたら完了にしない）
  - `src/components/report/ReportForm.tsx`（`IssueList`・`IssueBanner` に `signHref = canSign({reportId, signed}) && !p.review ? clientConfirmHref(siteId, date, issueId) : null` を渡す）
  - `src/components/site/SiteSummary.tsx`（現場の画面は日報が決まらないので `signHref` null → `later_only`。理由は「その日の日報の画面からサインをもらえます」）
  - お客様用の確認画面（`ClientConfirmView.tsx`）とその PDF：見積書が後出しで見積提出の記録が無い件に「お見積りは後日お出しします」（決めたこと 4。お客様には赤い印は出さない）
  - `src/lib/report/client-confirm.ts`（`clientConfirmCandidates(reportIssues, openIssues, doneOnDate: readonly T[] = [])`：その日に完了にした件も候補に。やり直しは今までどおり除く）
  - `src/lib/db/reports.ts`（`listIssuesDoneOn(siteId, date)`：status 'done'・`done_at = date`）、`src/app/(client)/sites/[siteId]/reports/[date]/client/page.tsx`（候補に渡す）
- Test: `tests/report/client-confirm.test.ts`（その日に完了にした前の日の件が候補に入る・印が付く［`initialSelection` の focus］・重複しない・やり直しは入らない）、Task 1 の `shouldOfferSignature`

- [ ] **Step 1〜4:** テスト → 失敗を確認 → 実装 → test・tsc・lint・build
- [ ] **Step 5:** 手で確かめる（当日の件：後出し → 完了 → サインをもらう → 確認画面でその件だけに印 → サイン → 件に「お客様の確認：確認済み」。その後に見積提出を記録しても、サインは求められない。前の日の件を今日完了 → 今日の確認画面の候補に出る）
- [ ] **Step 6: コミット** `feat(issue): 後出しの件の完了でお客様のサインを勧める`

### Task 7: ガイドと記録

**Files:**
- Modify: `src/content/guide/input.md`（「件の 3 つの状態」の後に「#### 件の見積書（要・後出し・不要）」。「見積提出の記録」の章に、完了した後出しの件にも記録できること・取り消せないとき）、`src/content/guide/sites.md`（現場の編集「見積提出が必須のお客様」）、`src/content/guide/changes.md`（一覧の赤い印）、`src/content/guide/approval.md`（サインの候補に「その日に完了にした件」）、`src/content/guide/photos.md`（協力会社のアカウント：赤い印は見える・見積書の中身と提出の日は見えない）、README（SQL の一覧・順番）、記録文書 `docs/superpowers/plans/2026-10-30-phase1-record.md`
- **例（ガイドにそのまま使える形で書く。日付・金額は見本と同じ）**：
  1. **必須のお客様・先に見積**：〇〇様邸（必須オン）。11/4 の日報で「軒先の修繕（木工事）」の件を作る → 見積書は「要（先に出す）」、状態は見積中、赤い印「必須の見積書が未提出（依頼の当日）」。11/6 に日報を開くと、上の黄色い枠に「必須の見積書が未提出（依頼から 2 日）」。対応中を押すと赤い枠で止まる。11/6 に見積を出し「見積提出を記録」（11/6）→ 印が消え、対応中にできる。
  2. **必須のお客様・その場で対応（後出し）**：11/12 に「雨漏れ箇所の応急処置」をお客様に頼まれ、その日にやる。件を作り、見積書を「要（お客様の指示で先に対応・後出し）」に変える → 対応中・完了にできる。完了を押す →「サインをもらう」→ お客様用の確認画面でサイン。件には「完了」「お客様の確認：確認済み 11/12」と赤い印「見積書が未提出（後出し）（依頼の当日）」。11/15 に見積を出して「見積提出を記録」→ 印が消える（2 回目のサインは要らない）。
  3. **必須のお客様・見積の要らない指示**：「養生の位置を変える」→ 見積書を「不要」→ 今までどおり自由に進める。印は出ない。
  4. **必須でないお客様**：新しい件は「不要」。見積を出すと決めた件だけ「要（先に出す）」を選ぶと、1 と同じく止まる。
  5. **協力会社の職長が件を作った**（必須の現場）：見積書は「要（先に出す）」で見積中になる。職長には赤い印と「社員が見積提出を記録するまで、対応中・完了にはできません」が見える。見積書の中身・提出の日は見えない。
  6. **間違えて見積提出を記録した**（要［先に出す］の対応中の件）：取り消しは押せない → 見積書を「後出し」に変えてから取り消す → 赤い印「見積書が未提出（後出し）」が戻る。
- [ ] **Step 1:** 書く → **Step 2:** `npm run build`（ガイドの読み込み）・`npm test`
- [ ] **Step 3: コミット** `docs(guide): 件の見積書（必須・後出し・不要）の使い方と例`

**第 2 段階の区切り：** 最終レビュー → push（SQL の追加なし）。
