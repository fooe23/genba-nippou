import { monthKey } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { visitNumbers } from '@/lib/calc/visit';
import type { ReportHead } from '@/lib/db/reports';
import type { Carryover } from '@/lib/db/sites';

// アプリ内集計（月次・原価・出面・作業員別累計）。純粋関数のみ。
// 人工は小数 2 桁に丸める（浮動小数の誤差対策）。金額は丸めない。

/**
 * 労務行 1 件の保存値（man_days・amount・overtime_hours。名前なしの行は人数分）。headcount は名前なし（会社と人数）の行の人数
 * （2026-11-19。名前のある行は null・省略）。名前なしの行の workerName は「会社名（名前なし）」なので、名前でまとめると会社ごとになる。
 */
export interface LaborEntry { reportDate: string; workerId: string | null; workerName: string; manDays: number; cost: number; overtimeHours: number; headcount?: number | null; }
/**
 * 日ごとの区分別の合計（明細の保存値）。credit は買掛の全部（仕入＋外注）、subcontract はそのうちの外注（2026-11-17）。
 * 原価 ＝ labor + fuel + lease + cash + credit（外注は credit に 1 回だけ入る）。見出しの costTotal（cost_total）は外注を含まないので
 * 原価には使わない。
 */
export interface DayTotals extends ReportHead {
  labor: number; fuel: number; lease: number; cash: number; credit: number; subcontract: number; workerCount: number;
  /**
   * 外注の支払いのうち出来高に数える分（2026-11-11。src/lib/report/subcontract-output.ts：件なしは契約内、件ありは追加・増・変更、
   * 減・やり直しの件は数えない）。協力会社のアカウントには外注の行が来ないので 0。省略は 0。
   */
  subcontractOutput?: number;
}

/** 日の出来高 = 作業内容の出来高（output_total）＋ 外注の支払いのうち出来高に数える分。 */
export function dayOutput(d: Pick<DayTotals, 'outputTotal' | 'subcontractOutput'>): number {
  return d.outputTotal + (d.subcontractOutput ?? 0);
}

/** 日の原価（区分の和。外注の買掛を含む）。 */
export function dayCostTotal(d: Pick<DayTotals, 'labor' | 'fuel' | 'lease' | 'cash' | 'credit'>): number {
  return d.labor + d.fuel + d.lease + d.cash + d.credit;
}
export interface MonthlyRow { date: string; monthIndex: number; totalIndex: number; weather: string | null; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; progress: number; }

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** month は "YYYY-MM"。progress は全期間の累計出来高ベース。 */
export function monthlyRows(days: DayTotals[], month: string, contractTotal: number | null): MonthlyRow[] {
  const allDates = days.map((d) => d.reportDate);
  const sorted = [...days].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return sorted
    .filter((d) => monthKey(d.reportDate) === month)
    .map((d) => {
      const v = visitNumbers(allDates, d.reportDate);
      let cumulative = 0;
      for (const x of sorted) if (x.reportDate <= d.reportDate) cumulative += dayOutput(x);
      return {
        date: d.reportDate,
        monthIndex: v.monthIndex,
        totalIndex: v.totalIndex,
        weather: d.weather,
        workerCount: d.workerCount,
        labor: d.labor,
        fuel: d.fuel,
        lease: d.lease,
        cash: d.cash,
        credit: d.credit,
        cost: dayCostTotal(d),
        output: dayOutput(d),
        progress: progressRate(cumulative, contractTotal),
      };
    });
}

export function sumRows(rows: MonthlyRow[]): Omit<MonthlyRow, 'date' | 'monthIndex' | 'totalIndex' | 'weather' | 'progress'> {
  const sum = { workerCount: 0, labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, cost: 0, output: 0 };
  for (const r of rows) {
    sum.workerCount += r.workerCount;
    sum.labor += r.labor;
    sum.fuel += r.fuel;
    sum.lease += r.lease;
    sum.cash += r.cash;
    sum.credit += r.credit;
    sum.cost += r.cost;
    sum.output += r.output;
  }
  return sum;
}

export interface CostSummary { labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; shares: Record<'labor' | 'fuel' | 'lease' | 'cash' | 'credit', number>; contractTotal: number | null; grossProfit: number | null; grossMargin: number | null; progress: number; }

/** 渡した days の範囲（月 or 全期間）で原価を集計する。 */
export function costSummary(days: DayTotals[], contractTotal: number | null): CostSummary {
  let labor = 0, fuel = 0, lease = 0, cash = 0, credit = 0, output = 0;
  for (const d of days) {
    labor += d.labor;
    fuel += d.fuel;
    lease += d.lease;
    cash += d.cash;
    credit += d.credit;
    output += dayOutput(d);
  }
  const cost = labor + fuel + lease + cash + credit;
  const share = (n: number) => (cost === 0 ? 0 : n / cost);
  const hasContract = contractTotal !== null && contractTotal !== 0;
  return {
    labor, fuel, lease, cash, credit, cost,
    shares: { labor: share(labor), fuel: share(fuel), lease: share(lease), cash: share(cash), credit: share(credit) },
    contractTotal,
    grossProfit: hasContract ? contractTotal - cost : null,
    grossMargin: hasContract ? (contractTotal - cost) / contractTotal : null,
    progress: progressRate(output, contractTotal),
  };
}

/** 出面一覧の 1 行。名前なし（会社と人数）の行（unnamed）は日ごとの人数（headcount）も持つ。 */
export interface AttendanceRow {
  workerName: string;
  byDate: Record<string, { manDays: number; cost: number; headcount: number }>;
  workDays: number;
  manDays: number;
  cost: number;
  unnamed: boolean;
}

/** 作業員名でまとめ、名前順に返す。 */
export function attendance(entries: LaborEntry[]): AttendanceRow[] {
  const map = new Map<string, AttendanceRow>();
  for (const e of entries) {
    let row = map.get(e.workerName);
    if (!row) {
      row = { workerName: e.workerName, byDate: {}, workDays: 0, manDays: 0, cost: 0, unnamed: false };
      map.set(e.workerName, row);
    }
    if (e.headcount !== null && e.headcount !== undefined) row.unnamed = true;
    const cell = row.byDate[e.reportDate] ?? { manDays: 0, cost: 0, headcount: 0 };
    cell.manDays = round2(cell.manDays + e.manDays);
    cell.headcount += e.headcount ?? 1;
    cell.cost += e.cost;
    row.byDate[e.reportDate] = cell;
    row.manDays = round2(row.manDays + e.manDays);
    row.cost += e.cost;
  }
  const rows = [...map.values()];
  for (const r of rows) r.workDays = Object.keys(r.byDate).length;
  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'));
}

export interface WorkerCumulativeRow {
  workerId: string | null;
  workerName: string;
  /** 前月繰越 = 繰越初期値 + 表示期間より前（繰越の基準日以降）の日報。 */
  carryManDays: number;
  carryCost: number;
  /** 表示期間（from〜to）の日報。 */
  manDays: number;
  cost: number;
  /** 累計 = 前月繰越 + 表示期間。 */
  totalManDays: number;
  totalCost: number;
  /** 出勤日数：累計に入った日報の日付の数（繰越初期値の分は数えない）。 */
  workDays: number;
  /** 残業 H：累計に入った日報の分（繰越初期値には残業が無い）。 */
  overtimeHours: number;
  /** 繰越の基準日より前の日報の件数（繰越初期値に含まれているとみなして集計から除いた分）。 */
  excludedCount: number;
}

/** 表示期間。from / to は両端を含む YYYY-MM-DD。null は制限なし（工期全体は両方 null）。 */
export interface Period { from: string | null; to: string | null; }

/**
 * 作業員別累計（Excel 雛形の「作業員別 当月集計」と同じ考え方：前月繰越／当月／累計）。
 * - 前月繰越 = 繰越初期値（gn_carryovers）+ 繰越の基準日以降で表示期間より前の日報
 * - 当期間 = 表示期間（from〜to）の日報
 * - 累計 = 前月繰越 + 当期間（to より後の日報は含めない）
 * 繰越初期値は基準日より前の分を表すので、その作業員の基準日より前の日報は二重に数えないよう
 * どこにも入れず、件数だけ excludedCount に数える。繰越だけ・前月繰越だけの作業員も含める。
 * 出勤日数・残業 H は累計（前月繰越の日報 + 当期間）に入った日報から数える（繰越初期値には含まれない）。
 */
export function workerCumulative(
  entries: LaborEntry[],
  carryovers: Carryover[],
  workerNames: Record<string, string>,
  period: Period,
): WorkerCumulativeRow[] {
  // キー: workerId があればそれ、なければ名前（先頭に区別用の接頭辞）
  const map = new Map<string, WorkerCumulativeRow>();
  const datesByKey = new Map<string, Set<string>>();
  const ensure = (key: string, workerId: string | null, fallbackName: string): WorkerCumulativeRow => {
    let row = map.get(key);
    if (!row) {
      row = {
        workerId,
        workerName: (workerId !== null ? workerNames[workerId] : undefined) ?? fallbackName,
        carryManDays: 0, carryCost: 0, manDays: 0, cost: 0, totalManDays: 0, totalCost: 0, workDays: 0, overtimeHours: 0, excludedCount: 0,
      };
      map.set(key, row);
    }
    return row;
  };

  const beforeDates = new Map<string, string>();
  for (const c of carryovers) {
    const row = ensure(`id:${c.workerId}`, c.workerId, workerNames[c.workerId] ?? '（不明な作業員）');
    row.carryManDays = round2(row.carryManDays + c.manDays);
    row.carryCost += c.laborCost;
    beforeDates.set(c.workerId, c.beforeDate);
  }

  for (const e of entries) {
    if (period.to !== null && e.reportDate > period.to) continue;
    const key = e.workerId !== null ? `id:${e.workerId}` : `name:${e.workerName}`;
    const beforeDate = e.workerId !== null ? beforeDates.get(e.workerId) : undefined;
    if (beforeDate !== undefined && e.reportDate < beforeDate) {
      ensure(key, e.workerId, e.workerName).excludedCount += 1;
      continue;
    }
    const row = ensure(key, e.workerId, e.workerName);
    row.overtimeHours = round2(row.overtimeHours + e.overtimeHours);
    let dates = datesByKey.get(key);
    if (!dates) {
      dates = new Set();
      datesByKey.set(key, dates);
    }
    dates.add(e.reportDate);
    if (period.from !== null && e.reportDate < period.from) {
      row.carryManDays = round2(row.carryManDays + e.manDays);
      row.carryCost += e.cost;
    } else {
      row.manDays = round2(row.manDays + e.manDays);
      row.cost += e.cost;
    }
  }

  for (const [key, dates] of datesByKey) map.get(key)!.workDays = dates.size;
  const rows = [...map.values()];
  for (const r of rows) {
    r.totalManDays = round2(r.carryManDays + r.manDays);
    r.totalCost = r.carryCost + r.cost;
  }
  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'));
}
