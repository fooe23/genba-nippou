import { affiliationLabel, LABOR_CONTRACT_LABELS, type SupplierNames } from '@/lib/calc/affiliation';
import { monthEnd } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import { isUnnamedLabor, laborHeadcount } from '@/lib/report/unnamed-workers';
import type { CostReportInput, CostReportPeriod } from '@/lib/reports/types';

// 現場管理台帳の「出面一覧」（作業員 × 日付。純関数。2026-11-11）。
// 行は 作業員（マスターの id、無ければ名前）× 所属 × 区分（自社／常用／請負）。人工は日報の労務の行の保存値（stored.manDays。
// 請負の人工も名前なしの人数分もそのまま）。月は期間の中で労務の行のある月だけ。繰越初期値は日が無いので入れない。

export type LedgerKind = '自社' | '常用' | '請負';

export interface LedgerAttendanceRow {
  name: string;
  affiliationLabel: string;
  kind: LedgerKind;
  /** 名前なし（会社と人数）の行。 */
  unnamed: boolean;
  /** 日付 → その日の人工（小数 2 桁）と人数。 */
  byDate: Record<string, { manDays: number; headcount: number }>;
  manDays: number;
  /** 出勤日数（人工のある日の数）。 */
  workDays: number;
}

export interface LedgerAttendanceMonth {
  /** 'YYYY-MM' */
  month: string;
  /** その月の 1 日〜末日（'YYYY-MM-DD'）。 */
  days: string[];
  rows: LedgerAttendanceRow[];
  dayTotals: Record<string, number>;
  /** うち請負（区分が請負の行の和）。 */
  ukeoiDayTotals: Record<string, number>;
  manDays: number;
  ukeoiManDays: number;
}

// 浮動小数の誤差を落としてから小数 2 桁（calc/report.ts の round2 と同じ）。
function round2(n: number): number {
  return Math.round(Math.round(n * 1e8) / 1e6) / 100;
}

function daysOf(month: string): string[] {
  const last = Number(monthEnd(month).slice(8, 10));
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** 並びの組：自社 0 → 協力会社 1 → 所属なし 2。 */
function groupOf(affiliation: string | null | undefined): number {
  return affiliation === 'own' ? 0 : affiliation === 'partner' ? 1 : 2;
}


export function buildLedgerAttendance(input: CostReportInput, period: CostReportPeriod): LedgerAttendanceMonth[] {
  const names: SupplierNames = Object.fromEntries(input.suppliers.map((s) => [s.id, s.name]));
  const byMonth = new Map<string, Map<string, { row: LedgerAttendanceRow; group: number }>>();

  for (const r of input.reports) {
    const month = monthKey(r.reportDate);
    if (period.kind === 'month' && month !== period.month) continue;
    for (const l of r.lines) {
      if (l.kind !== 'labor') continue;
      const partner = l.affiliation === 'partner';
      const kind: LedgerKind = partner ? (LABOR_CONTRACT_LABELS[l.laborContract === 'ukeoi' ? 'ukeoi' : 'jouyou'] as LedgerKind) : '自社';
      const label = affiliationLabel(l.affiliation, l.supplierId, names);
      const unnamed = isUnnamedLabor(l);
      const who = l.workerId ? `id:${l.workerId}` : `name:${l.workerName}`;
      const key = `${who}|${l.affiliation ?? ''}|${partner ? (l.supplierId ?? '') : ''}|${kind}`;
      let rows = byMonth.get(month);
      if (!rows) byMonth.set(month, (rows = new Map()));
      let entry = rows.get(key);
      if (!entry) {
        entry = { row: { name: l.workerName, affiliationLabel: label, kind, unnamed, byDate: {}, manDays: 0, workDays: 0 }, group: groupOf(l.affiliation) };
        rows.set(key, entry);
      }
      const row = entry.row;
      if (unnamed) row.unnamed = true;
      const cell = row.byDate[r.reportDate] ?? { manDays: 0, headcount: 0 };
      cell.manDays = round2(cell.manDays + l.stored.manDays);
      cell.headcount += laborHeadcount(l);
      row.byDate[r.reportDate] = cell;
    }
  }

  const kindOrder: Record<LedgerKind, number> = { 自社: 0, 常用: 1, 請負: 2 };
  return [...byMonth.keys()].sort().map((month) => {
    const rows = [...byMonth.get(month)!.values()]
      .sort(
        (a, b) =>
          a.group - b.group ||
          (a.group === 1 ? a.row.affiliationLabel.localeCompare(b.row.affiliationLabel, 'ja') : 0) ||
          a.row.name.localeCompare(b.row.name, 'ja') ||
          kindOrder[a.row.kind] - kindOrder[b.row.kind],
      )
      .map((e) => e.row);
    const days = daysOf(month);
    const dayTotals: Record<string, number> = {};
    const ukeoiDayTotals: Record<string, number> = {};
    for (const row of rows) {
      row.manDays = round2(Object.values(row.byDate).reduce((s, c) => s + c.manDays, 0));
      row.workDays = Object.keys(row.byDate).length;
      for (const [date, c] of Object.entries(row.byDate)) {
        dayTotals[date] = round2((dayTotals[date] ?? 0) + c.manDays);
        if (row.kind === '請負') ukeoiDayTotals[date] = round2((ukeoiDayTotals[date] ?? 0) + c.manDays);
      }
    }
    const sum = (rec: Record<string, number>) => round2(Object.values(rec).reduce((s, v) => s + v, 0));
    return {
      month,
      days,
      rows,
      dayTotals,
      ukeoiDayTotals,
      manDays: sum(dayTotals),
      ukeoiManDays: sum(ukeoiDayTotals),
    };
  });
}
