import { monthKey } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { visitNumbers } from '@/lib/calc/visit';
import type { ReportHead } from '@/lib/db/reports';
import type { Carryover } from '@/lib/db/sites';

// アプリ内集計（月次・原価・出面・作業員別累計）。純粋関数のみ。
// 人工は小数 2 桁に丸める（浮動小数の誤差対策）。金額は丸めない。

export interface LaborEntry { reportDate: string; workerId: string | null; workerName: string; manDays: number; cost: number; }
export interface DayTotals extends ReportHead { labor: number; fuel: number; lease: number; cash: number; credit: number; workerCount: number; }
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
      for (const x of sorted) if (x.reportDate <= d.reportDate) cumulative += x.outputTotal;
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
        cost: d.costTotal,
        output: d.outputTotal,
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
    output += d.outputTotal;
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

export interface AttendanceRow { workerName: string; byDate: Record<string, { manDays: number; cost: number }>; workDays: number; manDays: number; cost: number; }

/** 作業員名でまとめ、名前順に返す。 */
export function attendance(entries: LaborEntry[]): AttendanceRow[] {
  const map = new Map<string, AttendanceRow>();
  for (const e of entries) {
    let row = map.get(e.workerName);
    if (!row) {
      row = { workerName: e.workerName, byDate: {}, workDays: 0, manDays: 0, cost: 0 };
      map.set(e.workerName, row);
    }
    const cell = row.byDate[e.reportDate] ?? { manDays: 0, cost: 0 };
    cell.manDays = round2(cell.manDays + e.manDays);
    cell.cost += e.cost;
    row.byDate[e.reportDate] = cell;
    row.manDays = round2(row.manDays + e.manDays);
    row.cost += e.cost;
  }
  const rows = [...map.values()];
  for (const r of rows) r.workDays = Object.keys(r.byDate).length;
  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'));
}

export interface WorkerCumulativeRow { workerId: string | null; workerName: string; carryManDays: number; carryCost: number; manDays: number; cost: number; totalManDays: number; totalCost: number; }

/** 繰越初期値 + 渡した entries の範囲 = 累計。繰越だけの作業員も含める。 */
export function workerCumulative(entries: LaborEntry[], carryovers: Carryover[], workerNames: Record<string, string>): WorkerCumulativeRow[] {
  // キー: workerId があればそれ、なければ名前（先頭に区別用の接頭辞）
  const map = new Map<string, WorkerCumulativeRow>();
  const ensure = (key: string, workerId: string | null, fallbackName: string): WorkerCumulativeRow => {
    let row = map.get(key);
    if (!row) {
      row = {
        workerId,
        workerName: (workerId !== null ? workerNames[workerId] : undefined) ?? fallbackName,
        carryManDays: 0, carryCost: 0, manDays: 0, cost: 0, totalManDays: 0, totalCost: 0,
      };
      map.set(key, row);
    }
    return row;
  };
  for (const e of entries) {
    const row = e.workerId !== null ? ensure(`id:${e.workerId}`, e.workerId, e.workerName) : ensure(`name:${e.workerName}`, null, e.workerName);
    row.manDays = round2(row.manDays + e.manDays);
    row.cost += e.cost;
  }
  for (const c of carryovers) {
    const row = ensure(`id:${c.workerId}`, c.workerId, workerNames[c.workerId] ?? '（不明な作業員）');
    row.carryManDays = round2(row.carryManDays + c.manDays);
    row.carryCost += c.laborCost;
  }
  const rows = [...map.values()];
  for (const r of rows) {
    r.totalManDays = round2(r.carryManDays + r.manDays);
    r.totalCost = r.carryCost + r.cost;
  }
  return rows.sort((a, b) => a.workerName.localeCompare(b.workerName, 'ja'));
}
