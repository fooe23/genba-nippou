import { jpDate, monthKey } from '@/lib/calc/format';

export interface VisitNumbers { monthIndex: number; totalIndex: number; }

// 回目の採番。reportDates は現場の全日報日付（順不同可）。target は未保存でも自分を含めて数える。
// monthIndex = 同じ月で target 以前の日数、totalIndex = 全体で target 以前の日数。
export function visitNumbers(reportDates: string[], target: string): VisitNumbers {
  const all = new Set(reportDates);
  all.add(target);
  let monthIndex = 0;
  let totalIndex = 0;
  for (const d of all) {
    if (d > target) continue;
    totalIndex++;
    if (monthKey(d) === monthKey(target)) monthIndex++;
  }
  return { monthIndex, totalIndex };
}

// "2026/11/5（当月3回目・通算18回目）"
export function visitLabel(date: string, v: VisitNumbers): string {
  return `${jpDate(date)}（当月${v.monthIndex}回目・通算${v.totalIndex}回目）`;
}
