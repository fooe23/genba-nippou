import type { TimeSpec, LaborLine, ReportLine, ReportTotals } from '@/lib/types';

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

export function manDays(hours: number): number {
  return Math.round((hours / 7.5) * 100) / 100;
}

export function laborCost(dailyRate: number | null, manDays: number): number {
  return (dailyRate ?? 0) * manDays;
}

export function fuelCost(distanceKm: number | null, kmPerL: number | null, pricePerL: number | null): number {
  if (!kmPerL) return 0;
  return ((distanceKm ?? 0) / kmPerL) * (pricePerL ?? 0);
}

export function amount(qty: number | null, unitPrice: number | null): number {
  return (qty ?? 0) * (unitPrice ?? 0);
}

export function productivity(qty: number | null, manDays: number | null): number | null {
  if (!manDays) return null;
  if (qty === null) return null;
  return qty / manDays;
}

export function laborLineValues(line: LaborLine, common: TimeSpec): { hours: number; manDays: number; cost: number } {
  const hours = effectiveHours(line.time, common);
  const days = manDays(hours);
  return { hours, manDays: days, cost: laborCost(line.dailyRate, days) };
}

export function lineAmount(line: ReportLine, common: TimeSpec): number {
  switch (line.kind) {
    case 'labor':
      return laborLineValues(line, common).cost;
    case 'fuel':
      return fuelCost(line.distanceKm, line.kmPerL, line.pricePerL);
    case 'lease':
    case 'cash':
    case 'credit':
    case 'work':
      return amount(line.qty, line.unitPrice);
  }
}

export function reportTotals(lines: ReportLine[], common: TimeSpec): ReportTotals {
  const t: ReportTotals = {
    laborHours: 0, manDays: 0, workerCount: 0,
    labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, cost: 0, output: 0,
  };
  for (const line of lines) {
    switch (line.kind) {
      case 'labor': {
        const v = laborLineValues(line, common);
        t.laborHours += v.hours;
        t.manDays += v.manDays;
        t.workerCount += 1;
        t.labor += v.cost;
        break;
      }
      case 'fuel':
        t.fuel += lineAmount(line, common);
        break;
      case 'lease':
        t.lease += lineAmount(line, common);
        break;
      case 'cash':
        t.cash += lineAmount(line, common);
        break;
      case 'credit':
        t.credit += lineAmount(line, common);
        break;
      case 'work':
        t.output += lineAmount(line, common);
        break;
    }
  }
  t.laborHours = Math.round(t.laborHours * 100) / 100;
  t.manDays = Math.round(t.manDays * 100) / 100;
  t.cost = t.labor + t.fuel + t.lease + t.cash + t.credit;
  return t;
}

export function progressRate(cumulativeOutput: number, contractTotal: number | null): number {
  if (!contractTotal) return 0;
  return cumulativeOutput / contractTotal;
}
