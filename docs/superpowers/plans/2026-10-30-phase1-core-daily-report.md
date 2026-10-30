# 現場日報アプリ 第1計画：基盤と日報入力・集計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スマホから現場日報を入力・提出・承認でき、月次集計・現場原価集計・出面一覧・作業員別累計をアプリ内で見られる Next.js＋Supabase アプリを Vercel に公開する。

**Architecture:** Next.js 16（App Router、`src/` 構成）がフロントとサーバー処理を担い、Supabase（既存の業務日報アプリと同一プロジェクト）に `gn_` 接頭辞のテーブルを追加して行レベルセキュリティで権限を制御する。計算ルール（実働・人工・労務費・燃料費・回目・単価履歴・集計）は依存のない純粋関数として `src/lib/calc/` に置き、Vitest で雛形の数式と同じ結果になることを検証する。日報の保存は Postgres 関数 `gn_save_report` で1トランザクションにする。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind CSS 4 / @supabase/ssr 0.12 / @supabase/supabase-js 2 / Zod 4 / Vitest 5 / Vercel / Supabase（PostgreSQL・Auth・Storage）

**Spec:** `docs/superpowers/specs/2026-10-30-genba-nippou-design.md`（§2〜§7、§11、§12 骨格、§13 画面、§16）

## Global Constraints

- 既存アプリの `public.profiles`（`id, emp_code, name, email, is_admin`）と `public.is_admin()` をそのまま使う。変更しない。
- 新規テーブル・関数・バケットはすべて `gn_` 接頭辞。
- 計算ルールは設計書 §6.2 と一致させる：実働 `max((終了−開始)−(休憩分＋中抜分)/60, 0)`、人工 `round(実働/7.5, 2)`、労務費 `日当×人工`、燃料費 `燃費が0または未設定なら0、そうでなければ 走行距離÷燃費×燃料単価`、各金額 `数量×単価`、歩掛 `施工数量÷投入人工（人工0または未入力なら空）`。
- 時刻は `"HH:MM"` 文字列、日付は `"YYYY-MM-DD"` 文字列、金額は円の number（整数化しない。表示時に丸める）。
- 日報は現場×日付で1枚（`unique(site_id, report_date)`）。
- 日報の状態は `draft / submitted / approved / rejected`、現場の役割は `staff / reviewer / approver`。
- 日報見出しの表記は `YYYY/M/D（当月N回目・通算M回目）`。
- 単価は履歴（適用開始日）で持ち、明細行には保存時点の単価を複写する。
- UIの文言は日本語。スマホ幅（375px）で横スクロールなしに使えること。
- `.env*` はコミットしない。サービスロールキーはサーバー側でのみ使う（第1計画では使わない）。

## Review Focus

- 終了時刻が開始時刻より前（例 開始 17:00・終了 08:00）：実働は0時間になり、入力画面で「終了が開始より前です」と警告する。労務費は0。→ Task 2 のテスト、Task 9 の表示。
- 燃費が0または未設定の車両で走行距離を入れた：燃料費は0、入力画面で「燃費が未設定です」と警告。→ Task 2 のテスト、Task 9 の表示。
- 日当履歴がない（または日報日付より後の履歴しかない）作業員：単価は null → 労務費0、入力画面で「日当が未設定です」と警告。保存は可。→ Task 3 のテスト、Task 9 の表示。
- 二台の端末から同じ現場・同じ日付を同時に保存：`unique(site_id, report_date)` と `gn_save_report` の upsert により2件目は既存日報の更新になる。→ Task 4 の検証手順。
- 承認済み日報を担当者がURL直打ちや古い画面から保存：DBトリガーが拒否し、画面は「承認済みのため編集できません」と出す。→ Task 4 の検証、Task 10 の確認。

---

## ファイル構成

```
アプリ開発_現場日報/
  package.json, next.config.ts, tsconfig.json, vitest.config.ts, .env.example
  supabase/
    schema_genba.sql            # テーブル・RLS・関数・トリガー・バケット（§4）
    verify_rls.md               # 手動検証手順（Task 4, 10）
  src/
    proxy.ts                    # 認証チェック（Next.js 16 の middleware 相当）
    lib/
      types.ts                  # ドメイン型（明細・日報・マスター）
      calc/report.ts            # 実働・人工・労務費・燃料費・金額・歩掛・日報合計
      calc/visit.ts             # 当月N回目・通算M回目
      calc/rates.ts             # 単価履歴から日付時点の単価
      calc/aggregate.ts         # 月次集計・原価集計・出面一覧・作業員別累計
      calc/format.ts            # 日付・金額の表示整形
      supabase/client.ts        # ブラウザ用クライアント
      supabase/server.ts        # サーバー用クライアント（cookie）
      db/profile.ts             # 現在のプロフィール・管理者判定
      db/sites.ts               # 現場・担当・現場で使うマスター・繰越初期値
      db/masters.ts             # 作業員・取引先・車両・リース品・単価履歴・単位・天候
      db/reports.ts             # 日報の取得・保存（rpc）・状態変更・重要事項
      db/summary.ts             # 集計用の取得
    components/
      ui/*                      # ボタン・入力・モーダルなど最小限
      report/ReportForm.tsx     # 日報入力フォーム（6表）
      report/LineTable.tsx      # 区分ごとの明細表（行追加・削除）
      report/IssueBanner.tsx    # 対応中の重要事項バナー
      site/ReportCalendar.tsx   # 日報カレンダー
      site/SiteSummary.tsx      # 現場サマリー
    app/
      (auth)/login/page.tsx
      (app)/layout.tsx          # ログイン後の共通枠（ナビ）
      (app)/page.tsx            # ホーム
      (app)/sites/[siteId]/page.tsx                 # 現場詳細
      (app)/sites/[siteId]/reports/[date]/page.tsx  # 日報入力
      (app)/sites/[siteId]/summary/page.tsx         # 集計
      (app)/approvals/page.tsx
      (app)/admin/masters/page.tsx
      (app)/admin/sites/page.tsx
      (app)/admin/sites/[siteId]/page.tsx
      (app)/guide/page.tsx, guide/[chapter]/page.tsx
    content/guide/*.md          # ガイド各章
  tests/
    calc/report.test.ts, visit.test.ts, rates.test.ts, aggregate.test.ts
```

---

### Task 1: プロジェクト初期化

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`（仮）
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm run dev` / `npm run build` / `npm test`（`vitest run`）が動くリポジトリ。環境変数名 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`。

- [ ] **Step 1: Next.js を `src/` 構成で生成する**

Run（リポジトリ直下で。既存の `docs/` `templates/` `.gitignore` は残す）:
```bash
npx create-next-app@16 . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-git
```
既存ファイルがあると止まる場合は一時フォルダに生成して中身を移す。`.gitignore` は既存のものに生成分（`.next/`, `node_modules/`, `.env*`）が含まれているか確認して統合する。

- [ ] **Step 2: 依存を追加する**

```bash
npm i @supabase/ssr @supabase/supabase-js zod
npm i -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: `vitest.config.ts` と `npm test` を作る**

`vitest.config.ts`：`test.include = ['tests/**/*.test.ts']`、`test.environment = 'node'`、`resolve.alias['@'] = './src'`。`package.json` の scripts に `"test": "vitest run"` を追加。

- [ ] **Step 4: 失敗するスモークテストを書く**

`tests/smoke.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { APP_NAME } from '@/lib/constants';
describe('smoke', () => { it('アプリ名', () => { expect(APP_NAME).toBe('現場日報'); }); });
```

- [ ] **Step 5: 実行して失敗を確認**

Run: `npx vitest run tests/smoke.test.ts` → Expected: FAIL（`@/lib/constants` が無い）

- [ ] **Step 6: `src/lib/constants.ts` に `export const APP_NAME = '現場日報';` を作る**

- [ ] **Step 7: テストとビルドを通す**

Run: `npx vitest run` → PASS。Run: `npm run build` → 正常終了。

- [ ] **Step 8: `.env.example` を作る**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: Next.js 16 と Vitest の初期構成"
```

---

### Task 2: 計算ルール（実働・人工・労務費・燃料費・金額・歩掛・合計）

**Files:**
- Create: `src/lib/types.ts`, `src/lib/calc/report.ts`
- Test: `tests/calc/report.test.ts`

**Interfaces:**
- Produces（`src/lib/types.ts`）:
  ```ts
  export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
  export type SiteRole = 'staff' | 'reviewer' | 'approver';
  export type LineKind = 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'work';
  export interface TimeSpec { start: string | null; end: string | null; breakMin: number | null; gapMin: number | null; }
  export interface LaborLine  { kind: 'labor';  workerId: string | null; workerName: string; time: TimeSpec; dailyRate: number | null; note: string; }
  export interface FuelLine   { kind: 'fuel';   vehicleId: string | null; vehicleName: string; kmPerL: number | null; distanceKm: number | null; pricePerL: number | null; note: string; }
  export interface LeaseLine  { kind: 'lease';  itemId: string | null; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; note: string; }
  export interface CashLine   { kind: 'cash';   itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string; }
  export interface CreditLine { kind: 'credit'; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; supplierId: string | null; vendor: string; }
  export interface WorkLine   { kind: 'work';   estimateItemId: string | null; trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; source: 'estimate' | 'extra'; }
  export type ReportLine = LaborLine | FuelLine | LeaseLine | CashLine | CreditLine | WorkLine;
  export interface ReportTotals { laborHours: number; manDays: number; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; }
  ```
- Produces（`src/lib/calc/report.ts`）:
  ```ts
  export function hoursBetween(start: string, end: string): number;            // (end−start) を時間で。負なら負のまま返す
  export function commonHours(common: TimeSpec): number;                       // 共通実働。start/end が無ければ 0
  export function effectiveHours(line: TimeSpec, common: TimeSpec): number;    // 個別が無ければ共通実働
  export function manDays(hours: number): number;                              // round(h/7.5, 2)
  export function laborCost(dailyRate: number | null, manDays: number): number;
  export function fuelCost(distanceKm: number | null, kmPerL: number | null, pricePerL: number | null): number;
  export function amount(qty: number | null, unitPrice: number | null): number;
  export function productivity(qty: number | null, manDays: number | null): number | null;
  export function laborLineValues(line: LaborLine, common: TimeSpec): { hours: number; manDays: number; cost: number };
  export function lineAmount(line: ReportLine, common: TimeSpec): number;      // 区分ごとの金額
  export function reportTotals(lines: ReportLine[], common: TimeSpec): ReportTotals;
  export function progressRate(cumulativeOutput: number, contractTotal: number | null): number; // 総額0/nullなら0
  ```

- [ ] **Step 1: 失敗するテストを書く**

`tests/calc/report.test.ts`（雛形の数式に合わせた値）:
```ts
import { describe, it, expect } from 'vitest';
import { hoursBetween, commonHours, effectiveHours, manDays, laborCost, fuelCost, amount, productivity, reportTotals, progressRate } from '@/lib/calc/report';
const common = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };

describe('時間', () => {
  it('hoursBetween 08:00→17:00 は 9', () => expect(hoursBetween('08:00', '17:00')).toBe(9));
  it('commonHours 8-17 休憩60 は 8', () => expect(commonHours(common)).toBe(8));
  it('個別時間が無ければ共通実働', () => expect(effectiveHours({ start: null, end: null, breakMin: null, gapMin: null }, common)).toBe(8));
  it('個別 09:00-15:30 休憩null 中抜30 → 休憩は共通60を使い 5.0', () => expect(effectiveHours({ start: '09:00', end: '15:30', breakMin: null, gapMin: 30 }, common)).toBe(5));
  it('終了が開始より前なら 0', () => expect(effectiveHours({ start: '17:00', end: '08:00', breakMin: 0, gapMin: 0 }, common)).toBe(0));
  it('共通の start が無ければ 0', () => expect(commonHours({ start: null, end: null, breakMin: 60, gapMin: 0 })).toBe(0));
});
describe('人工・労務費', () => {
  it('8時間は 1.07 人工', () => expect(manDays(8)).toBe(1.07));
  it('7.5時間は 1 人工', () => expect(manDays(7.5)).toBe(1));
  it('労務費 18000 × 1.07 = 19260', () => expect(laborCost(18000, 1.07)).toBe(19260));
  it('日当 null は 0', () => expect(laborCost(null, 1)).toBe(0));
});
describe('燃料費・金額・歩掛', () => {
  it('40km ÷ 10km/L × 170円 = 680', () => expect(fuelCost(40, 10, 170)).toBe(680));
  it('燃費 0 は 0', () => expect(fuelCost(40, 0, 170)).toBe(0));
  it('燃費 null は 0', () => expect(fuelCost(40, null, 170)).toBe(0));
  it('amount 5 × 280 = 1400、null は 0', () => { expect(amount(5, 280)).toBe(1400); expect(amount(null, 280)).toBe(0); });
  it('歩掛 35㎡ ÷ 2人工 = 17.5、人工0は null', () => { expect(productivity(35, 2)).toBe(17.5); expect(productivity(35, 0)).toBeNull(); expect(productivity(35, null)).toBeNull(); });
});
describe('日報合計', () => {
  it('6区分の合計と出来高', () => {
    const t = reportTotals([
      { kind: 'labor', workerId: 'w1', workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '' },
      { kind: 'labor', workerId: 'w2', workerName: '佐藤', time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 }, dailyRate: 15000, note: '' },
      { kind: 'fuel', vehicleId: 'v1', vehicleName: 'ハイエース', kmPerL: 10, distanceKm: 40, pricePerL: 170, note: '' },
      { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 3500, note: '' },
      { kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: 'コメリ' },
      { kind: 'credit', itemName: 'タイル', spec: '', unit: '枚', qty: 50, unitPrice: 250, supplierId: null, vendor: 'ABC建材' },
      { kind: 'work', estimateItemId: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', manDays: 1.6, unitPrice: 1200, source: 'extra' },
    ], common);
    expect(t.workerCount).toBe(2);
    expect(t.laborHours).toBe(12);                 // 8 + 4
    expect(t.manDays).toBe(1.6);                   // 1.07 + 0.53
    expect(t.labor).toBe(19260 + 7950);            // 18000×1.07 + 15000×0.53
    expect(t.fuel).toBe(680); expect(t.lease).toBe(3500); expect(t.cash).toBe(1400); expect(t.credit).toBe(12500);
    expect(t.cost).toBe(19260 + 7950 + 680 + 3500 + 1400 + 12500);
    expect(t.output).toBe(42000);
  });
  it('進捗率：総額 null/0 は 0', () => { expect(progressRate(100, null)).toBe(0); expect(progressRate(100, 0)).toBe(0); expect(progressRate(2_500_000, 10_000_000)).toBe(0.25); });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run tests/calc/report.test.ts` → FAIL（モジュールなし）

- [ ] **Step 3: `src/lib/types.ts` と `src/lib/calc/report.ts` を Interfaces のとおり実装する**

浮動小数の誤差を避けるため、`manDays` は `Math.round(h / 7.5 * 100) / 100`、時間計算は分単位の整数で行ってから60で割る。`reportTotals` の小数合計は `Math.round(x * 100) / 100` で丸める。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run tests/calc/report.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/calc/report.ts tests/calc/report.test.ts
git commit -m "feat(calc): 日報の計算ルール（実働・人工・労務費・燃料費・合計）"
```

---

### Task 3: 回目の採番と単価履歴

**Files:**
- Create: `src/lib/calc/visit.ts`, `src/lib/calc/rates.ts`, `src/lib/calc/format.ts`
- Test: `tests/calc/visit.test.ts`, `tests/calc/rates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // visit.ts
  export interface VisitNumbers { monthIndex: number; totalIndex: number; }
  export function visitNumbers(reportDates: string[], target: string): VisitNumbers; // reportDates は現場の全日報日付（重複なし・順不同可）。target を含めて数える
  export function visitLabel(date: string, v: VisitNumbers): string;                 // "2026/11/5（当月3回目・通算18回目）"
  // rates.ts
  export interface RateHistory { amount: number; effectiveFrom: string; }
  export function rateAt(history: RateHistory[], date: string): number | null;       // effectiveFrom <= date の最新。無ければ null
  // format.ts
  export function yen(n: number): string;              // "¥19,260"（四捨五入、0 は "¥0"）
  export function jpDate(date: string): string;        // "2026/11/5"
  export function monthKey(date: string): string;      // "2026-11"
  ```

- [ ] **Step 1: 失敗するテストを書く**

`tests/calc/visit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { visitNumbers, visitLabel } from '@/lib/calc/visit';
const dates = ['2026-10-28', '2026-10-30', '2026-11-02', '2026-11-05', '2026-11-04'];
describe('回目', () => {
  it('11/5 は当月3回目・通算5回目', () => expect(visitNumbers(dates, '2026-11-05')).toEqual({ monthIndex: 3, totalIndex: 5 }));
  it('10/28 は当月1回目・通算1回目', () => expect(visitNumbers(dates, '2026-10-28')).toEqual({ monthIndex: 1, totalIndex: 1 }));
  it('未保存の新しい日付も自分を含めて数える', () => expect(visitNumbers(dates, '2026-11-10')).toEqual({ monthIndex: 4, totalIndex: 6 }));
  it('表記', () => expect(visitLabel('2026-11-05', { monthIndex: 3, totalIndex: 18 })).toBe('2026/11/5（当月3回目・通算18回目）'));
});
```
`tests/calc/rates.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rateAt } from '@/lib/calc/rates';
const h = [{ amount: 18000, effectiveFrom: '2026-04-01' }, { amount: 19000, effectiveFrom: '2026-10-01' }];
describe('単価履歴', () => {
  it('改定日以降は新単価', () => expect(rateAt(h, '2026-10-01')).toBe(19000));
  it('改定日前は旧単価', () => expect(rateAt(h, '2026-09-30')).toBe(18000));
  it('履歴より前の日付は null', () => expect(rateAt(h, '2026-03-31')).toBeNull());
  it('履歴なしは null', () => expect(rateAt([], '2026-10-01')).toBeNull());
});
```

- [ ] **Step 2: 失敗を確認**  Run: `npx vitest run tests/calc` → FAIL

- [ ] **Step 3: `visit.ts` `rates.ts` `format.ts` を実装する**

`visitNumbers` は `target` を集合に加えてから、同じ `monthKey` の日付で `<= target` を数え、全体で `<= target` を数える。

- [ ] **Step 4: 通す**  Run: `npx vitest run tests/calc` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc tests/calc && git commit -m "feat(calc): 回目の採番・単価履歴・表示整形"
```

---

### Task 4: データベーススキーマ（テーブル・RLS・保存関数）

**Files:**
- Create: `supabase/schema_genba.sql`, `supabase/verify_rls.md`

**Interfaces:**
- Consumes: 既存 `public.profiles`, `public.is_admin()`。
- Produces（テーブル。すべて `id uuid primary key default gen_random_uuid()`、`created_at timestamptz default now()`、更新のあるものは `updated_at`）:

| テーブル | 列 |
|---|---|
| `gn_sites` | `name text not null, client_name text, project_name text, project_no text, overview text, contract_amount numeric, start_date date, end_date date, contract_type text check in ('元請け','下請','常用'), status text not null default 'active' check in ('active','done')` |
| `gn_site_members` | `site_id uuid ref gn_sites on delete cascade, user_id uuid ref profiles, role text not null check in ('staff','reviewer','approver'), unique(site_id,user_id)` |
| `gn_workers` | `name text not null, trade text, note text, profile_id uuid ref profiles null, active boolean default true` |
| `gn_worker_rates` | `worker_id uuid ref gn_workers on delete cascade, amount numeric not null, effective_from date not null, unique(worker_id,effective_from)` |
| `gn_suppliers` | `name text not null, category text, contact text, note text, active boolean default true` |
| `gn_vehicles` | `name text not null, kind text, km_per_l numeric, note text, active boolean default true` |
| `gn_lease_items` | `name text not null, spec text, note text, active boolean default true` |
| `gn_lease_item_rates` | `item_id uuid ref gn_lease_items on delete cascade, amount numeric not null, effective_from date not null, unique(item_id,effective_from)` |
| `gn_site_workers` / `gn_site_suppliers` / `gn_site_vehicles` / `gn_site_lease_items` | `site_id, <master>_id, sort_order int default 0, unique(site_id,<master>_id)` |
| `gn_units` | `name text unique not null, sort_order int`（初期値：㎡ m m³ 式 箇所 本 枚 台 人 日 t kg ℓ 回 棟） |
| `gn_weather_options` | `name text unique not null, sort_order int`（初期値：晴れ 曇り 雨 雪 晴れ時々曇り 曇り時々雨 雨時々曇り 台風） |
| `gn_daily_reports` | `site_id uuid ref gn_sites, report_date date not null, weather text, supervisor text, common_start text, common_end text, common_break_min int, common_gap_min int, output_total numeric default 0, cost_total numeric default 0, man_days_total numeric default 0, issues_text text, notes_text text, status text not null default 'draft' check in (...), created_by uuid ref profiles, reviewed_by uuid, approved_by uuid, approved_at timestamptz, rejected_reason text, unique(site_id, report_date)` |
| `gn_report_lines` | `report_id uuid ref gn_daily_reports on delete cascade, kind text not null check in ('labor','fuel','lease','cash','credit','work'), sort_order int not null, ref_id uuid null（作業員/車両/品目/取引先/積算行のID）, name text, spec text, unit text, qty numeric, unit_price numeric, amount numeric, start_time text, end_time text, break_min int, gap_min int, hours numeric, man_days numeric, km_per_l numeric, distance_km numeric, price_per_l numeric, vendor text, trade text, description text, productivity numeric, source text check in ('estimate','extra'), note text` |
| `gn_report_issues` | `site_id, report_id uuid ref gn_daily_reports on delete cascade, body text not null, status text not null default 'open' check in ('open','done'), done_at date, estimate_item_id uuid null` |
| `gn_carryovers` | `site_id, worker_id uuid ref gn_workers, man_days numeric not null default 0, labor_cost numeric not null default 0, before_date date not null, unique(site_id,worker_id)` |

- Produces（関数・トリガー・RLS）:
  - `gn_is_site_member(p_site uuid) returns boolean`（`security definer`、`gn_site_members` に `auth.uid()` があるか、または `is_admin()`）
  - `gn_site_role(p_site uuid) returns text`（自分の役割。管理者は `'approver'` を返す）
  - `gn_save_report(p_report jsonb, p_lines jsonb) returns uuid`：`p_report` のキーは `site_id, report_date, weather, supervisor, common_start, common_end, common_break_min, common_gap_min, issues_text, notes_text`。`(site_id, report_date)` で upsert（`created_by` は新規時のみ `auth.uid()`）→ 既存明細を全削除 → `p_lines`（配列、各要素は `gn_report_lines` の列名キー）を `sort_order` 順に挿入 → `output_total = sum(amount where kind='work')`, `cost_total = sum(amount where kind<>'work')`, `man_days_total = sum(man_days where kind='labor')` を更新 → id を返す。`security invoker`。
  - トリガー `gn_report_guard`（`before update on gn_daily_reports`）：`old.status='approved'` かつ `not is_admin()` なら `raise exception 'approved_report_locked'`。`new.status` が `'approved'` または `'rejected'` に変わる時は `gn_site_role(new.site_id) in ('reviewer','approver')` を要求、違反は `raise exception 'not_reviewer'`。`'submitted'` → 変更なし可。
  - トリガー `gn_report_lines_guard`（`before insert or update or delete on gn_report_lines`）：親日報が `approved` かつ `not is_admin()` なら拒否。
  - RLS：`gn_sites` select は `gn_is_site_member(id)`、insert/update/delete は `is_admin()`。マスター6表・単位・天候は select 全認証ユーザー、変更は `is_admin()`。現場×マスター4表・`gn_site_members`・`gn_carryovers` は select `gn_is_site_member(site_id)`、変更 `is_admin()`。`gn_daily_reports` `gn_report_issues` は select/insert/update `gn_is_site_member(site_id)`、delete は `is_admin()`。`gn_report_lines` は親日報の `site_id` で同じ条件。
  - Storage バケット `gn-photos`, `gn-estimates`, `gn-exports`（非公開。第1計画では作成のみ）。

- [ ] **Step 1: `supabase/schema_genba.sql` を上記どおり書く**

すべて `create table if not exists` / `drop policy if exists` / `create or replace function` で再実行可能にする。初期値は `on conflict do nothing`。

- [ ] **Step 2: 構文を確認する**

ローカルに Postgres が無いため、Supabase ダッシュボードの SQL Editor に貼って実行する。エラーなく終わること。

- [ ] **Step 3: `supabase/verify_rls.md` に検証手順を書き、実行する**

内容：テスト用に管理者1名・担当者2名（A, B）を既存アプリのアカウントで用意 → 管理者が現場X（Aを `staff`）と現場Y（Bを `staff`）を作る → SQL Editor の「Run as role」または Table Editor の RLS 確認で、Aが `gn_sites` を読むとXだけ、Bが読むとYだけになること → Aとして `gn_save_report` を現場Xで2回同じ日付で呼び、`gn_daily_reports` が1件のままで明細が最新に置き換わること → 管理者が状態を `approved` にした後、Aの `update gn_daily_reports set weather='雨'` が `approved_report_locked` で失敗すること → Aが自分の現場で `status='approved'` に更新しようとすると `not_reviewer` で失敗すること。各結果を md にチェックボックスで記録する。

- [ ] **Step 4: Commit**

```bash
git add supabase && git commit -m "feat(db): gn_ スキーマ・RLS・gn_save_report"
```

---

### Task 5: Supabase 接続と認証

**Files:**
- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts`, `src/lib/db/profile.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`（仮：プロフィール名表示）
- Modify: `src/app/page.tsx` → `(app)/page.tsx` に移す

**Interfaces:**
- Produces:
  ```ts
  // client.ts
  export function createBrowserSupabase(): SupabaseClient;
  // server.ts（Server Components / Route Handlers / Server Actions 用。cookies() を使う）
  export async function createServerSupabase(): Promise<SupabaseClient>;
  // db/profile.ts
  export interface Profile { id: string; name: string; email: string; isAdmin: boolean; }
  export async function getCurrentProfile(): Promise<Profile | null>;   // 未ログインは null
  export async function requireProfile(): Promise<Profile>;             // 未ログインは /login へ redirect
  export async function requireAdmin(): Promise<Profile>;               // 管理者以外は / へ redirect
  ```
- `src/proxy.ts`：`@supabase/ssr` の推奨どおりセッションを更新し、未ログインで `/login` 以外にアクセスしたら `/login` へ。

- [ ] **Step 1: `.env.local` を作る（コミットしない）**

既存アプリと同じ `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を入れる（値は Supabase ダッシュボード → Project Settings → API）。

- [ ] **Step 2: クライアント2種と `proxy.ts` を実装する**

- [ ] **Step 3: ログイン画面を作る**

メール・パスワード・「ログイン」ボタン。`signInWithPassword` 成功で `/`。失敗時は「メールアドレスまたはパスワードが違います」。パスワード再設定は既存アプリの案内文へのリンクのみ。

- [ ] **Step 4: `(app)/layout.tsx` にナビを作る**

下部タブ（スマホ）：ホーム／承認（役割に関係なく表示、権限は画面側で判定）／ガイド／管理（管理者のみ）。上部にアプリ名と氏名、ログアウト。

- [ ] **Step 5: 動作確認**

Run: `npm run dev` → ブラウザで `/` → `/login` へ飛ぶ → 既存アカウントでログイン → 氏名が表示される → ログアウトで `/login` に戻る。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(auth): Supabase 接続・ログイン・認証ガード"
```

---

### Task 6: マスター管理（管理者）

**Files:**
- Create: `src/lib/db/masters.ts`, `src/app/(app)/admin/masters/page.tsx`, `src/components/masters/*`（作業員・取引先・車両・リース品・単位・天候のタブと編集フォーム）

**Interfaces:**
- Consumes: `rateAt`（Task 3）、`requireAdmin`（Task 5）。
- Produces（`src/lib/db/masters.ts`、すべてサーバー側で `createServerSupabase` を使う）:
  ```ts
  export interface Worker { id: string; name: string; trade: string | null; note: string | null; active: boolean; rates: RateHistory[]; }
  export interface Supplier { id: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean; }
  export interface Vehicle { id: string; name: string; kind: string | null; kmPerL: number | null; note: string | null; active: boolean; }
  export interface LeaseItem { id: string; name: string; spec: string | null; note: string | null; active: boolean; rates: RateHistory[]; }
  export async function listWorkers(): Promise<Worker[]>;        // rates は effective_from 昇順
  export async function listSuppliers(): Promise<Supplier[]>;
  export async function listVehicles(): Promise<Vehicle[]>;
  export async function listLeaseItems(): Promise<LeaseItem[]>;
  export async function listUnits(): Promise<string[]>;
  export async function listWeather(): Promise<string[]>;
  // Server Actions（フォームから呼ぶ）
  export async function upsertWorker(input: { id?: string; name: string; trade?: string; note?: string; active?: boolean }): Promise<string>;
  export async function addWorkerRate(workerId: string, amount: number, effectiveFrom: string): Promise<void>;
  export async function upsertSupplier(input: { id?: string; name: string; category?: string; contact?: string; note?: string; active?: boolean }): Promise<string>;
  export async function upsertVehicle(input: { id?: string; name: string; kind?: string; kmPerL?: number | null; note?: string; active?: boolean }): Promise<string>;
  export async function upsertLeaseItem(input: { id?: string; name: string; spec?: string; note?: string; active?: boolean }): Promise<string>;
  export async function addLeaseItemRate(itemId: string, amount: number, effectiveFrom: string): Promise<void>;
  export async function upsertUnit(name: string, sortOrder: number): Promise<void>;
  export async function upsertWeather(name: string, sortOrder: number): Promise<void>;
  ```

- [ ] **Step 1: `db/masters.ts` を実装する**

`upsert*` は `id` があれば update、無ければ insert。Zod で `name` 必須・`amount >= 0`・`effectiveFrom` 日付形式を検証し、違反は `Error` を投げる。

- [ ] **Step 2: 管理画面を作る**

6タブ。一覧は名前・区分・現在の単価（`rateAt(rates, 今日)`）・有効。行をタップで編集フォーム（モーダル）。作業員・リース品の編集フォームに「単価の改定履歴」表（適用開始日・金額）と「改定を追加」。無効化は削除ではなく `active=false`。

- [ ] **Step 3: 動作確認**

管理者でログイン → `/admin/masters` → 作業員「田中 太郎／大工／日当 18000（2026-04-01から）」を登録 → 改定 19000（2026-10-01）を追加 → 一覧の現在単価が 19000 になる → 車両「ハイエース／燃費 10」、リース品「足場材／3500」、取引先「ABC建材」を登録 → 非管理者でログインすると `/admin/masters` は `/` へ戻される。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(admin): マスター管理（作業員・取引先・車両・リース品・単位・天候・単価履歴）"
```

---

### Task 7: 現場管理（管理者）と繰越初期値

**Files:**
- Create: `src/lib/db/sites.ts`, `src/app/(app)/admin/sites/page.tsx`, `src/app/(app)/admin/sites/[siteId]/page.tsx`, `src/components/sites/*`

**Interfaces:**
- Produces（`src/lib/db/sites.ts`）:
  ```ts
  export interface Site { id: string; name: string; clientName: string | null; projectName: string | null; projectNo: string | null; overview: string | null; contractAmount: number | null; startDate: string | null; endDate: string | null; contractType: '元請け' | '下請' | '常用' | null; status: 'active' | 'done'; }
  export interface SiteMember { userId: string; name: string; email: string; role: SiteRole; }
  export interface SiteMasters { workerIds: string[]; supplierIds: string[]; vehicleIds: string[]; leaseItemIds: string[]; }
  export interface Carryover { workerId: string; manDays: number; laborCost: number; beforeDate: string; }
  export async function listMySites(): Promise<Site[]>;                       // RLS により自分の現場だけ（管理者は全件）
  export async function getSite(siteId: string): Promise<Site | null>;
  export async function upsertSite(input: Omit<Site,'id'|'status'> & { id?: string; status?: Site['status'] }): Promise<string>;
  export async function listSiteMembers(siteId: string): Promise<SiteMember[]>;
  export async function setSiteMember(siteId: string, userId: string, role: SiteRole | null): Promise<void>; // null で削除
  export async function getSiteMasters(siteId: string): Promise<SiteMasters>;
  export async function setSiteMasters(siteId: string, m: SiteMasters): Promise<void>;                     // 差分で insert/delete
  export async function listCarryovers(siteId: string): Promise<Carryover[]>;
  export async function upsertCarryover(siteId: string, c: Carryover): Promise<void>;
  export async function listProfiles(): Promise<{ id: string; name: string; email: string }[]>;            // 管理者のみ
  ```

- [ ] **Step 1: `db/sites.ts` を実装する**

- [ ] **Step 2: 現場一覧・現場編集画面を作る**

一覧：進行中／完了の切替、新規作成。編集：現場情報9項目（雛形の現場情報マスターと同じ並び・ラベル）、担当者（社員を選んで役割を付ける）、「この現場で使うマスター」（作業員・取引先・車両・リース品をチェック）、「繰越初期値」（作業員ごとに人工・労務費・基準日。欄の脇に「前月繰越とは？」→ `/guide/carryover` へのリンク）。

- [ ] **Step 3: 動作確認**

現場「村山一彦様邸 母屋修繕工事」を作成（客先・工事番号・総請負金額・着工／竣工・元請け）→ 担当者Aを `staff`、Bを `approver` に → 作業員2名・車両1台・リース品1点・取引先1社をチェック → 繰越初期値で田中に人工 12.5／労務費 225000／基準日 2026-10-01 を登録 → 担当者Aでログインしてホームにこの現場だけ出る。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(admin): 現場管理（担当者・現場で使うマスター・繰越初期値）"
```

---

### Task 8: ホームと現場詳細（カレンダー・回目）

**Files:**
- Create: `src/lib/db/reports.ts`（取得部分）, `src/app/(app)/page.tsx`（本実装）, `src/app/(app)/sites/[siteId]/page.tsx`, `src/components/site/ReportCalendar.tsx`, `src/components/site/SiteSummary.tsx`

**Interfaces:**
- Consumes: `visitNumbers`, `visitLabel`（Task 3）、`listMySites`, `getSite`（Task 7）。
- Produces（`src/lib/db/reports.ts` 取得部分）:
  ```ts
  export interface ReportHead { id: string; siteId: string; reportDate: string; weather: string | null; supervisor: string | null; status: ReportStatus; outputTotal: number; costTotal: number; manDaysTotal: number; }
  export async function listReportHeads(siteId: string): Promise<ReportHead[]>;             // 日付昇順、全期間
  export async function listTodayStatus(siteIds: string[], today: string): Promise<Record<string, ReportStatus | 'none'>>;
  ```

- [ ] **Step 1: ホームを実装する**

自分の現場一覧（進行中のみ）。各現場カードに現場名・客先・今日の日報の状態（未入力／下書き／提出済／承認済）。未入力を上に並べる。「今日の日報を書く」→ `/sites/[id]/reports/[今日]`。

- [ ] **Step 2: 現場詳細を実装する**

上部に `SiteSummary`：工期と経過日数、通算入場回数（`listReportHeads().length`）、累計原価（`costTotal` 合計）、累計出来高と進捗率（`progressRate`）、直近3日の日報（日付・回目・出来高）、対応中の重要事項（Task 11 で接続。ここでは枠だけ）。下に `ReportCalendar`：月送り、各日を状態で色分け（未入力グレー／下書き黄／提出青／承認緑／差戻し赤）、日報のある日には当月N回目を小さく表示。日をタップで入力画面へ。ボタン：「集計を見る」→ `/sites/[id]/summary`。

- [ ] **Step 3: 動作確認**

担当者Aで現場を開く → カレンダーに今日が未入力で出る → 任意の日をタップで入力画面のURLへ遷移する（画面は Task 9）。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(site): ホーム・現場詳細・日報カレンダー"
```

---

### Task 9: 日報入力フォーム

**Files:**
- Create: `src/lib/db/reports.ts`（保存部分を追加）, `src/lib/report/schema.ts`（Zod）, `src/lib/report/draft.ts`（localStorage 下書き）, `src/app/(app)/sites/[siteId]/reports/[date]/page.tsx`, `src/components/report/ReportForm.tsx`, `src/components/report/LineTable.tsx`
- Test: `tests/report/schema.test.ts`

**Interfaces:**
- Consumes: Task 2 の計算関数と型、Task 3 の `rateAt` `visitLabel`、Task 6 の一覧、Task 7 の `getSiteMasters`。
- Produces:
  ```ts
  // db/reports.ts
  export interface ReportDetail { head: ReportHead | null; common: TimeSpec; issuesText: string; notesText: string; lines: ReportLine[]; }
  export async function getReport(siteId: string, date: string): Promise<ReportDetail>;             // 無ければ head: null・空行
  export async function getPreviousReport(siteId: string, beforeDate: string): Promise<ReportDetail | null>;
  export async function saveReport(input: { siteId: string; date: string; weather: string | null; supervisor: string | null; common: TimeSpec; issuesText: string; notesText: string; lines: ReportLine[] }): Promise<string>; // gn_save_report を呼ぶ
  // report/schema.ts
  export const reportInputSchema: z.ZodType<SaveInput>;        // saveReport の input を検証
  export type SaveInput = Parameters<typeof saveReport>[0];      // { siteId, date, weather, supervisor, common, issuesText, notesText, lines }
  export function validateReport(input: unknown): { ok: true; value: SaveInput } | { ok: false; errors: string[] };
  export function reportWarnings(input: SaveInput, ctx?: { siteStartDate: string | null; today: string }): string[];
  // 保存は止めない警告文。ctx があれば「日付が着工予定日より前です」「日付が今日より後です」も返す
  // report/draft.ts
  export function saveDraft(siteId: string, date: string, data: SaveInput): void;
  export function loadDraft(siteId: string, date: string): SaveInput | null;
  export function clearDraft(siteId: string, date: string): void;
  ```
- `saveReport` は `ReportLine` を `gn_report_lines` の列に変換する。対応：labor → `ref_id=workerId, name=workerName, start_time/end_time/break_min/gap_min, hours, man_days, unit_price=dailyRate, amount=cost, note`；fuel → `ref_id=vehicleId, name, km_per_l, distance_km, price_per_l, amount, note`；lease → `ref_id=itemId, name, spec, unit, qty, unit_price, amount, note`；cash/credit → `name, spec, unit, qty, unit_price, amount, vendor, ref_id=supplierId`；work → `ref_id=estimateItemId, trade, description, qty, unit, man_days, unit_price, amount, productivity, source`。

- [ ] **Step 1: 検証と警告の失敗するテストを書く**

`tests/report/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateReport, reportWarnings } from '@/lib/report/schema';
const base = { siteId: '11111111-1111-1111-1111-111111111111', date: '2026-11-05', weather: '晴れ', supervisor: '大堀', common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 }, issuesText: '', notesText: '', lines: [] as any[] };
describe('validateReport', () => {
  it('作業員名が空の労務行はエラー', () => {
    const r = validateReport({ ...base, lines: [{ kind: 'labor', workerId: null, workerName: '', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '' }] });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.errors[0]).toContain('作業員名');
  });
  it('燃料行は車両・走行距離・燃料単価が必須', () => {
    const r = validateReport({ ...base, lines: [{ kind: 'fuel', vehicleId: null, vehicleName: 'ハイエース', kmPerL: 10, distanceKm: null, pricePerL: 170, note: '' }] });
    expect(r.ok).toBe(false);
  });
  it('日付形式が違えばエラー', () => expect(validateReport({ ...base, date: '2026/11/05' }).ok).toBe(false));
});
describe('reportWarnings', () => {
  it('終了が開始より前・燃費未設定・日当未設定・作業員0行を警告する', () => {
    const w = reportWarnings({ ...base, lines: [
      { kind: 'labor', workerId: 'w', workerName: '田中', time: { start: '17:00', end: '08:00', breakMin: 0, gapMin: 0 }, dailyRate: null, note: '' },
      { kind: 'fuel', vehicleId: 'v', vehicleName: 'ダンプ', kmPerL: null, distanceKm: 20, pricePerL: 170, note: '' },
    ] });
    expect(w.some(s => s.includes('終了が開始より前'))).toBe(true);
    expect(w.some(s => s.includes('燃費が未設定'))).toBe(true);
    expect(w.some(s => s.includes('日当が未設定'))).toBe(true);
    expect(reportWarnings({ ...base, lines: [] }).some(s => s.includes('作業員が0'))).toBe(true);
  });
  it('着工予定日より前・今日より後の日付を警告する', () => {
    const w1 = reportWarnings(base, { siteStartDate: '2026-11-10', today: '2026-11-20' });
    expect(w1.some(s => s.includes('着工予定日より前'))).toBe(true);
    const w2 = reportWarnings(base, { siteStartDate: '2026-10-01', today: '2026-11-01' });
    expect(w2.some(s => s.includes('今日より後'))).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**  Run: `npx vitest run tests/report` → FAIL

- [ ] **Step 3: `report/schema.ts` を実装する**

Zod で `ReportLine` の判別共用体を定義。現金・買掛は「数量と単価の両方」または「金額のみ」のどちらか（金額のみは `qty=1, unitPrice=金額` に正規化）。

- [ ] **Step 4: 通す**  Run: `npx vitest run tests/report` → PASS

- [ ] **Step 5: `draft.ts` と `db/reports.ts` の保存部分を実装する**

`saveDraft` は `localStorage` キー `gn_draft:${siteId}:${date}`。`saveReport` は検証 → 明細を列に変換（計算値は Task 2 の関数で算出して渡す）→ `supabase.rpc('gn_save_report', { p_report, p_lines })`。`approved_report_locked` エラーは「承認済みのため編集できません」に変換して投げる。

- [ ] **Step 6: `ReportForm` と `LineTable` を作る**

構成（上から）：見出し `visitLabel` ／ 日付・天候（`listWeather`）・作業責任者 ／ 「前回をコピー」（`getPreviousReport` の labor・fuel・lease 行を複写。labor の個別時間は空に、fuel の走行距離は空に、lease の数量はそのまま）／ 共通時間（開始・終了・休憩分・中抜分、右に共通実働 H 表示）／ 6表を `LineTable` で縦に。各表の仕様：

| 表 | 行の入力 | 選択元 | 表示する計算値 |
|---|---|---|---|
| 作業員 | 作業員（選択）、開始・終了・休憩・中抜（任意、空なら共通）、備考 | 現場で使う作業員（`getSiteMasters`）。日当は `rateAt(rates, 日付)` を複写 | 実働H・人工・労務費・日当 |
| 車両 | 車両（選択）、走行距離、燃料単価、備考 | 現場で使う車両。燃費を複写 | 燃料費 |
| リース | 品目（選択）、規格（複写・編集可）、単位、数量、備考 | 現場で使うリース品。単価を `rateAt` で複写 | リース費 |
| 現金 | 品目、規格、単位、数量、購入単価、購入先 | 単位は `listUnits` | 購入金額 |
| 買掛 | 品目、規格、単位、数量、仕入単価、仕入先（選択） | 現場で使う取引先 | 仕入金額 |
| 作業内容 | 工種、施工内容、施工数量、単位、投入人工、施工単価 | 単位は `listUnits`。第1計画では `source='extra'` のみ（「内訳から選ぶ」ボタンは第3計画で追加） | 歩掛・合計金額 |

各表の末尾に「＋追加」、行に削除。表の下に小計。全体の下に「本日原価集計」（5項目と合計）と「本日出来高」「進捗率（累計出来高÷総請負金額）」。重要事項・連絡事項のテキストエリア。`reportWarnings` を黄色帯で表示。ボタン：「下書き保存」（status 変更なし）と「提出」（Task 10）。入力中は 2 秒ごとに `saveDraft`、画面を開いた時に下書きがあれば「保存していない入力があります。復元しますか？」。承認済みの日報は全項目を読み取り専用にして「承認済みのため編集できません」を表示。

- [ ] **Step 7: 動作確認**

担当者Aで今日の日報を開く → 共通 08:00-17:00 休憩60 → 田中（日当19000が入る）、佐藤に個別 08:00-12:00 → 人工 1.07／0.53、労務費が表示 → 車両ハイエース 40km 170円 → 680円 → リース 足場材 1式 → 3500 → 現金 養生テープ 5巻 280円 → 買掛 タイル 50枚 250円 ABC建材 → 作業内容 塗装工事／外壁下塗り／35㎡／1.6人工／1200円 → 歩掛 21.88、合計 42000 → 本日原価合計が Task 2 のテストと同じ値 → 下書き保存 → 再読込で内容が残る → 現場詳細のカレンダーで今日が黄色。別の日を開いて「前回をコピー」で作業員・車両・リース品が入る。終了を開始より前にすると警告が出る。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(report): 日報入力フォーム（6表・前回コピー・下書き・保存rpc）"
```

---

### Task 10: 提出・承認フロー

**Files:**
- Modify: `src/lib/db/reports.ts`（状態変更）, `src/components/report/ReportForm.tsx`（提出ボタン・差戻し理由表示）
- Create: `src/app/(app)/approvals/page.tsx`

**Interfaces:**
- Produces:
  ```ts
  export async function submitReport(reportId: string): Promise<void>;                       // draft/rejected → submitted
  export async function approveReport(reportId: string): Promise<void>;                      // submitted → approved（approved_by, approved_at）
  export async function rejectReport(reportId: string, reason: string): Promise<void>;       // submitted → rejected（rejected_reason）
  export async function reopenReport(reportId: string): Promise<void>;                       // 管理者のみ approved → draft
  export async function listSubmittedReports(): Promise<(ReportHead & { siteName: string; createdByName: string })[]>; // 自分が reviewer/approver の現場の submitted
  ```

- [ ] **Step 1: 状態変更関数を実装する**

いずれも `update gn_daily_reports set status=...`。`not_reviewer` エラーは「この現場の確認者・承認者ではありません」に変換。

- [ ] **Step 2: フォームに「提出」を付ける**

提出前に `validateReport` と確認ダイアログ（作業員0行なら「作業員が入力されていません。休工日として提出しますか？」）。提出後は「提出済み（承認待ち）」表示、担当者は編集可（提出済みでも修正→再提出できる）。差戻しの場合は理由を赤帯で表示。

- [ ] **Step 3: 承認画面を作る**

`listSubmittedReports` を現場ごとにまとめて表示。行をタップで日報を読み取り専用表示（`ReportForm` の readOnly）し、「承認」「差戻し（理由入力）」。管理者には承認済み日報の「承認解除」。`(app)/layout.tsx` の「承認」タブに `listSubmittedReports().length` を件数バッジとして表示する（0 件なら非表示）。これが設計書 §6.1 の「アプリ内バッジ通知」。

- [ ] **Step 4: 動作確認**

Aが提出 → Bの承認画面に出る → Bが差戻し（理由「人工の確認」）→ Aの画面に赤帯で理由 → Aが再提出 → Bが承認 → Aの画面は読み取り専用で「承認済みのため編集できません」。Aが古いタブから保存すると同じメッセージでエラー。管理者が承認解除 → Aが編集できる。`supabase/verify_rls.md` の該当項目にチェックを付ける。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(report): 提出・承認・差戻し・承認解除"
```

---

### Task 11: 重要事項の件管理

**Files:**
- Modify: `src/lib/db/reports.ts`, `src/components/report/ReportForm.tsx`, `src/components/site/SiteSummary.tsx`
- Create: `src/components/report/IssueBanner.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface Issue { id: string; siteId: string; reportId: string; reportDate: string; body: string; status: 'open' | 'done'; doneAt: string | null; }
  export async function listOpenIssues(siteId: string): Promise<Issue[]>;      // 日付昇順
  export async function listIssuesForReport(reportId: string): Promise<Issue[]>;
  export async function addIssue(reportId: string, body: string): Promise<string>;
  export async function setIssueDone(issueId: string, done: boolean, doneAt?: string): Promise<void>;
  ```

- [ ] **Step 1: 関数を実装する**

- [ ] **Step 2: フォームに「重要事項（件）」を足す**

重要事項テキストエリアの下に、その日報の件一覧（本文・状態切替）と「件を追加」。保存済みの日報でのみ追加可（日報IDが要る。未保存なら「先に下書き保存してください」）。

- [ ] **Step 3: `IssueBanner` を作る**

日報入力画面の最上部に、現場の `open` の件を日付付きで表示（当日の件は除く）。各件に「完了にする」。現場詳細の `SiteSummary` にも同じ一覧。

- [ ] **Step 4: 動作確認**

10/30 の日報で件「北面の下地補修 追加指示あり（数量未定）」を追加 → 11/2 の日報を開くとバナーに出る → 完了にすると消える → 現場詳細でも同じ。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(report): 重要事項の件管理と対応中バナー"
```

---

### Task 12: アプリ内集計（月次・原価・出面・作業員別累計）

**Files:**
- Create: `src/lib/calc/aggregate.ts`, `src/lib/db/summary.ts`, `src/app/(app)/sites/[siteId]/summary/page.tsx`, `src/components/summary/*`
- Test: `tests/calc/aggregate.test.ts`

**Interfaces:**
- Consumes: `ReportHead`（Task 8）、`Carryover`（Task 7）、`visitNumbers`、`progressRate`。
- Produces（`src/lib/calc/aggregate.ts`）:
  ```ts
  export interface LaborEntry { reportDate: string; workerId: string | null; workerName: string; manDays: number; cost: number; }
  export interface DayTotals extends ReportHead { labor: number; fuel: number; lease: number; cash: number; credit: number; workerCount: number; }
  export interface MonthlyRow { date: string; monthIndex: number; totalIndex: number; weather: string | null; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; progress: number; }
  export function monthlyRows(days: DayTotals[], month: string, contractTotal: number | null): MonthlyRow[];   // month "YYYY-MM"。progress は累計出来高ベース
  export function sumRows(rows: MonthlyRow[]): Omit<MonthlyRow,'date'|'monthIndex'|'totalIndex'|'weather'|'progress'>;
  export interface CostSummary { labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; shares: Record<'labor'|'fuel'|'lease'|'cash'|'credit', number>; contractTotal: number | null; grossProfit: number | null; grossMargin: number | null; progress: number; }
  export function costSummary(days: DayTotals[], contractTotal: number | null): CostSummary;      // 渡した days の範囲（月 or 全期間）
  export interface AttendanceRow { workerName: string; byDate: Record<string, { manDays: number; cost: number }>; workDays: number; manDays: number; cost: number; }
  export function attendance(entries: LaborEntry[]): AttendanceRow[];                                // 作業員名でまとめ、名前順
  export interface WorkerCumulativeRow { workerId: string | null; workerName: string; carryManDays: number; carryCost: number; manDays: number; cost: number; totalManDays: number; totalCost: number; }
  export function workerCumulative(entries: LaborEntry[], carryovers: Carryover[], workerNames: Record<string,string>): WorkerCumulativeRow[];
  ```
- Produces（`src/lib/db/summary.ts`）: `loadDayTotals(siteId): Promise<DayTotals[]>`（全期間、明細から区分別合計を集計）、`loadLaborEntries(siteId): Promise<LaborEntry[]>`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/calc/aggregate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { monthlyRows, sumRows, costSummary, attendance, workerCumulative } from '@/lib/calc/aggregate';
const day = (d: string, o: Partial<any> = {}) => ({ id: d, siteId: 's', reportDate: d, weather: '晴れ', supervisor: null, status: 'approved', outputTotal: 0, costTotal: 0, manDaysTotal: 0, labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0, ...o });
const days = [
  day('2026-10-30', { labor: 10000, costTotal: 10000, outputTotal: 50000 }),
  day('2026-11-02', { labor: 20000, fuel: 500, costTotal: 20500, outputTotal: 100000, workerCount: 2 }),
  day('2026-11-05', { labor: 30000, costTotal: 30000, outputTotal: 150000, workerCount: 3 }),
];
describe('月次集計', () => {
  it('11月の行は2行、回目と累計進捗が付く', () => {
    const rows = monthlyRows(days, '2026-11', 1_000_000);
    expect(rows.map(r => [r.monthIndex, r.totalIndex])).toEqual([[1, 2], [2, 3]]);
    expect(rows[1].progress).toBe(0.3);                 // (50000+100000+150000)/1,000,000
    const s = sumRows(rows); expect(s.labor).toBe(50000); expect(s.output).toBe(250000); expect(s.cost).toBe(50500);
  });
});
describe('原価集計', () => {
  it('構成比・粗利・粗利率・進捗', () => {
    const c = costSummary(days, 1_000_000);
    expect(c.cost).toBe(60500); expect(c.shares.labor).toBeCloseTo(60000 / 60500, 6);
    expect(c.grossProfit).toBe(939500); expect(c.grossMargin).toBeCloseTo(0.9395, 6); expect(c.progress).toBe(0.3);
  });
  it('総額 null なら粗利は null、進捗 0', () => { const c = costSummary(days, null); expect(c.grossProfit).toBeNull(); expect(c.progress).toBe(0); });
});
describe('出面一覧・作業員別累計', () => {
  const e = [
    { reportDate: '2026-11-02', workerId: 'w1', workerName: '田中', manDays: 1.07, cost: 20330 },
    { reportDate: '2026-11-05', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000 },
    { reportDate: '2026-11-05', workerId: 'w2', workerName: '佐藤', manDays: 0.53, cost: 7950 },
  ];
  it('出面一覧', () => {
    const a = attendance(e); const t = a.find(r => r.workerName === '田中')!;
    expect(t.workDays).toBe(2); expect(t.manDays).toBe(2.07); expect(t.cost).toBe(39330); expect(t.byDate['2026-11-05'].manDays).toBe(1);
  });
  it('繰越を足した累計', () => {
    const w = workerCumulative(e, [{ workerId: 'w1', manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }], { w1: '田中', w2: '佐藤' });
    const t = w.find(r => r.workerId === 'w1')!;
    expect(t.totalManDays).toBe(14.57); expect(t.totalCost).toBe(264330);
  });
});
```

- [ ] **Step 2: 失敗を確認**  Run: `npx vitest run tests/calc/aggregate.test.ts` → FAIL

- [ ] **Step 3: `aggregate.ts` を実装する**

小数の合計は `Math.round(x*100)/100`。

- [ ] **Step 4: 通す**  → PASS

- [ ] **Step 5: `db/summary.ts` と集計画面を作る**

画面上部で「月」（月送り）と「工期全体」を切替。タブ：月次集計（雛形の列順：日付（回目付き）・天候・作業員数・労務費・燃料費・リース費・現金購入・買掛費・本日原価・工事出来高・進捗率、合計行）／現場原価集計（5項目・構成比・原価合計・総請負金額・総原価・粗利益・粗利率・進捗率）／出面一覧（作業員×日、上段人工・下段労務費、稼働日数・人工計・労務費計。横スクロール可）／作業員別累計（繰越・当期間・累計）。スマホでは表を横スクロールにし、1列目を固定する。

- [ ] **Step 6: 動作確認**

Task 9〜10 で入れた日報が月次集計に出て、値が入力画面の合計と一致する。工期全体に切り替えると繰越初期値（田中 12.5人工）が累計に足されている。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(summary): 月次集計・現場原価集計・出面一覧・作業員別累計"
```

---

### Task 13: ガイド（骨格）

**Files:**
- Create: `src/content/guide/{index,input,carryover,migration,approval,summary}.md`, `src/app/(app)/guide/page.tsx`, `src/app/(app)/guide/[chapter]/page.tsx`, `src/lib/guide.ts`

**Interfaces:**
- Produces: `src/lib/guide.ts` に `export const GUIDE_CHAPTERS: { slug: string; title: string }[]`（順序どおり）と `export async function loadChapter(slug: string): Promise<string>`（md を読み HTML に変換。`npm i marked`）。

- [ ] **Step 1: 章を書く**

各章は見出しと手順の箇条書き。内容は設計書 §12 の該当項目を、第1計画で実装した画面に合わせて書く。`carryover.md` は「アプリでは繰越の手作業は不要」「Excel出力時に前月までの合計が自動で入る」「導入前の分は現場管理の繰越初期値に1回だけ入れる」の3点を必ず含める。`migration.md` は旧ブックのマスターシート「作業員別 当月集計」G・H列（累計人工・累計労務費）を見て繰越初期値に入れる手順。Excel出力・PDF・積算・写真の章は見出しだけ置き「第2計画以降で追記」と書く。

- [ ] **Step 2: 画面を作る**

目次ページと章ページ。Task 7 の繰越初期値欄のリンク先 `/guide/carryover` が開くこと。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(guide): アプリ内ガイドの骨格と前月繰越・移行の章"
```

---

### Task 14: GitHub と Vercel への公開

**Files:**
- Create: `README.md`（構築手順：設計書 §16 の第1計画分）

- [ ] **Step 1: ビルド確認**  Run: `npm run build && npx vitest run` → ともに成功

- [ ] **Step 2: GitHub リポジトリを作って push する**

ユーザーが GitHub でプライベートリポジトリ `genba-nippou` を作成 → `git remote add origin <url> && git push -u origin main`。

- [ ] **Step 3: Vercel に連携する**

Vercel で Import → 環境変数 `NEXT_PUBLIC_SUPABASE_URL` `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定 → Deploy。Supabase の Authentication → URL Configuration に Vercel のURLを Site URL / Redirect URL として追加。

- [ ] **Step 4: 本番での確認**

スマホで公開URLを開く → ログイン → ホームに現場 → 日報を1件入力して下書き保存 → 提出 → 承認者で承認 → 集計に反映。`README.md` に確認結果の日付を記す。

- [ ] **Step 5: Commit & push**

```bash
git add README.md && git commit -m "docs: 構築手順と第1計画の公開確認" && git push
```
