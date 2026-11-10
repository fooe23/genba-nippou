import { laborHeadcount } from '@/lib/report/unnamed-workers';
import type { TimeSpec, LaborLine, LaborRule, ReportLine, ReportTotals, WorkLine } from '@/lib/types';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 実働 = max((終了−開始) − (休憩分＋中抜分)/60, 0)。分単位の整数で計算してから時間に直す。
function workHours(start: string, end: string, breakMin: number, gapMin: number): number {
  const minutes = toMinutes(end) - toMinutes(start) - breakMin - gapMin;
  return Math.max(minutes, 0) / 60;
}

export function hoursBetween(start: string, end: string): number {
  return (toMinutes(end) - toMinutes(start)) / 60;
}

export function commonHours(common: TimeSpec): number {
  if (common.start === null || common.end === null) return 0;
  return workHours(common.start, common.end, common.breakMin ?? 0, common.gapMin ?? 0);
}

export function effectiveHours(line: TimeSpec, common: TimeSpec): number {
  if (line.start === null || line.end === null) return commonHours(common);
  return workHours(
    line.start,
    line.end,
    line.breakMin ?? common.breakMin ?? 0,
    line.gapMin ?? common.gapMin ?? 0,
  );
}

// 人工・残業・労務費（Excel 雛形 V34 と DB のトリガー gn_report_lines_compute と同じルール）。
//   人工     = 実働 ≤ 所定 なら ROUND(実働 ÷ 所定, 2)、超えたら 1.0
//   残業時間 = MAX(実働 − 固定残業の上限, 0)（小数 2 桁）
//   残業単価 = 作業員の残業単価（空欄・0 は無し扱い）、無ければ ROUND(日当 ÷ 基準時間 × 割増率, 0)
//   労務費   = 日当 × 人工 ＋ 残業時間 × 残業単価
// 設定値は gn_settings から読み、呼び出し側が渡す（この関数群は Supabase に依存しない）。

/** gn_settings が読めないとき（SQL 未適用など）の既定値。DB の列の既定と同じ。 */
export const DEFAULT_LABOR_RULE: LaborRule = { shoteiHours: 7.5, fixedOvertimeLimit: 8, overtimeMultiplier: 1.25, overtimeBaseHours: 8 };

// 浮動小数の誤差（4.6 ÷ 8 = 0.57499999… など）を落としてから小数 2 桁に四捨五入する（DB の numeric の round と同じ結果）。
function round2(n: number): number {
  return Math.round(Math.round(n * 1e8) / 1e6) / 100;
}

// 浮動小数の誤差（2812.4999999 など）を落としてから円未満を四捨五入する。
function roundYen(n: number): number {
  return Math.round(Math.round(n * 1e6) / 1e6);
}

export function manDays(hours: number, rule: LaborRule): number {
  if (!(rule.shoteiHours > 0)) return 0;
  if (hours <= rule.shoteiHours) return round2(hours / rule.shoteiHours);
  return 1;
}

export function overtimeHours(hours: number, rule: LaborRule): number {
  return round2(Math.max(hours - rule.fixedOvertimeLimit, 0));
}

/** 残業単価（円/H）。override（作業員の残業単価）が null・0 なら 日当 ÷ 基準時間 × 割増率（円未満四捨五入）。 */
export function overtimeRate(dailyRate: number | null, override: number | null, rule: LaborRule): number {
  if (override !== null && override !== undefined && Number.isFinite(override) && override > 0) return override;
  if (!(rule.overtimeBaseHours > 0)) return 0;
  // DB と同じく先に掛けてから割る。
  return roundYen(((dailyRate ?? 0) * rule.overtimeMultiplier) / rule.overtimeBaseHours);
}

export function laborCost(dailyRate: number | null, manDays: number, overtimeHours: number, overtimeRate: number): number {
  return (dailyRate ?? 0) * manDays + overtimeHours * overtimeRate;
}

export function fuelCost(distanceKm: number | null, kmPerL: number | null, pricePerL: number | null): number {
  if (!kmPerL) return 0;
  return ((distanceKm ?? 0) / kmPerL) * (pricePerL ?? 0);
}

export function amount(qty: number | null, unitPrice: number | null): number {
  return (qty ?? 0) * (unitPrice ?? 0);
}

/**
 * 作業内容の行の金額（出来高）。数量 × 単価。減（changeKind 'minus'）は数量・単価を正で入れる決まりで、金額は負
 * （−数量 × 単価）。DB のトリガー gn_report_lines_compute と同じ規則なので、画面の合計は保存値（amount・output_total）と一致する。
 */
export function workAmount(line: Pick<WorkLine, 'qty' | 'unitPrice' | 'changeKind'>): number {
  const a = amount(line.qty, line.unitPrice);
  // 0 は −0 にしない（表示が「-0」になるため）
  return line.changeKind === 'minus' && a !== 0 ? -a : a;
}

export function productivity(qty: number | null, manDays: number | null): number | null {
  if (!manDays) return null;
  if (qty === null) return null;
  return qty / manDays;
}

/**
 * 作業員の行の計算値。hours（実働）は 1 人あたり、manDays・overtimeHours・cost は人数分（headcount 人。名前のある行は 1）。
 * 名前なし（会社と人数）の行：src/lib/report/unnamed-workers.ts（2026-11-19）。
 */
export interface LaborValues { hours: number; manDays: number; overtimeHours: number; overtimeRate: number; cost: number; headcount: number; }

/** preferSaved：保存済みの行（line.saved あり）は DB の計算値を返す。読み取り専用の画面（承認済み・完了現場・承認画面）で使う。 */
export interface LaborCalcOptions { preferSaved?: boolean; }

/**
 * reportTotals の労務費の決まり（2026-11-17。src/lib/calc/labor-cost.ts の laborCostSplit を行の所属を決めてから呼ぶ関数）。
 * 省略時は行の金額（出面の金額）をそのまま数える。
 */
export type LaborSplitOf = (line: LaborLine, values: LaborValues) => { countedCost: number; ukeoiManDays: number };

export function laborLineValues(line: LaborLine, common: TimeSpec, rule: LaborRule, opts?: LaborCalcOptions): LaborValues {
  const headcount = laborHeadcount(line);
  if (opts?.preferSaved && line.saved) {
    const s = line.saved;
    return { ...s, overtimeRate: overtimeRate(line.dailyRate, line.overtimeRate, rule), headcount };
  }
  const hours = effectiveHours(line.time, common);
  // 1 人分を出してから人数を掛ける（DB のトリガーと同じ）。
  const days = round2(manDays(hours, rule) * headcount);
  const otHours = round2(overtimeHours(hours, rule) * headcount);
  const otRate = overtimeRate(line.dailyRate, line.overtimeRate, rule);
  return { hours, manDays: days, overtimeHours: otHours, overtimeRate: otRate, cost: laborCost(line.dailyRate, days, otHours, otRate), headcount };
}

export function lineAmount(line: ReportLine, common: TimeSpec, rule: LaborRule, opts?: LaborCalcOptions): number {
  switch (line.kind) {
    case 'labor':
      return laborLineValues(line, common, rule, opts).cost;
    case 'fuel':
      return fuelCost(line.distanceKm, line.kmPerL, line.pricePerL);
    case 'lease':
    case 'cash':
    case 'credit':
      return amount(line.qty, line.unitPrice);
    case 'work':
      return workAmount(line);
  }
}

export function reportTotals(
  lines: ReportLine[],
  common: TimeSpec,
  rule: LaborRule,
  opts?: LaborCalcOptions & { laborSplit?: LaborSplitOf },
): ReportTotals {
  const t: ReportTotals = {
    laborHours: 0, manDays: 0, ukeoiManDays: 0, overtimeHours: 0, workerCount: 0,
    labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, cost: 0, output: 0,
  };
  for (const line of lines) {
    switch (line.kind) {
      case 'labor': {
        const v = laborLineValues(line, common, rule, opts);
        // 実働は 1 人あたりなので人数を掛ける（人工・残業は人数分の値）。名前なしの行は人数分を人数に数える。
        t.laborHours += v.hours * v.headcount;
        t.manDays += v.manDays;
        t.overtimeHours += v.overtimeHours;
        t.workerCount += v.headcount;
        if (opts?.laborSplit) {
          const s = opts.laborSplit(line, v);
          t.labor += s.countedCost;
          t.ukeoiManDays += s.ukeoiManDays;
        } else {
          t.labor += v.cost;
        }
        break;
      }
      case 'fuel':
        t.fuel += lineAmount(line, common, rule);
        break;
      case 'lease':
        t.lease += lineAmount(line, common, rule);
        break;
      case 'cash':
        t.cash += lineAmount(line, common, rule);
        break;
      case 'credit': {
        const a = lineAmount(line, common, rule);
        t.credit += a;
        if (line.purchaseKind === 'subcontract') t.subcontract += a;
        break;
      }
      case 'work':
        t.output += lineAmount(line, common, rule);
        break;
    }
  }
  t.laborHours = round2(t.laborHours);
  t.manDays = round2(t.manDays);
  t.ukeoiManDays = round2(t.ukeoiManDays);
  t.overtimeHours = round2(t.overtimeHours);
  t.cost = t.labor + t.fuel + t.lease + t.cash + t.credit;
  return t;
}

export function progressRate(cumulativeOutput: number, contractTotal: number | null): number {
  if (!contractTotal) return 0;
  return cumulativeOutput / contractTotal;
}
