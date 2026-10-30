import { rateAt, type RateHistory } from '@/lib/calc/rates';
import { yen } from '@/lib/calc/format';
import type { CashLineInput, CreditLineInput, ReportLineInput, SaveInput } from '@/lib/report/schema';
import type { FuelLine, LaborLine, LeaseLine, ReportLine, TimeSpec, WorkLine } from '@/lib/types';

// 日報入力フォームの状態と変換（純関数）。表ごとに行を持ち、保存時に SaveInput へ並べ直す。

export interface WorkerOption { id: string; name: string; active: boolean; rates: RateHistory[]; }
export interface VehicleOption { id: string; name: string; active: boolean; kmPerL: number | null; }
export interface LeaseItemOption { id: string; name: string; spec: string | null; active: boolean; rates: RateHistory[]; }
export interface SupplierOption { id: string; name: string; active: boolean; }
export interface ReportMasters {
  workers: WorkerOption[];
  vehicles: VehicleOption[];
  leaseItems: LeaseItemOption[];
  suppliers: SupplierOption[];
  units: string[];
  weather: string[];
}

/** 表の1行。key は React 用、amountMode は現金・買掛の「金額のみ入力」。 */
export interface Row<L> { key: string; line: L; amountMode?: boolean; }
export interface Rows {
  labor: Row<LaborLine>[];
  fuel: Row<FuelLine>[];
  lease: Row<LeaseLine>[];
  cash: Row<CashLineInput>[];
  credit: Row<CreditLineInput>[];
  work: Row<WorkLine>[];
}
export interface FormState {
  weather: string;
  supervisor: string;
  common: TimeSpec;
  issuesText: string;
  notesText: string;
  rows: Rows;
}

let seq = 0;
export function newKey(): string {
  seq += 1;
  return `row-${seq}`;
}

export const EMPTY_TIME: TimeSpec = { start: null, end: null, breakMin: null, gapMin: null };

export const newLine = {
  labor: (): LaborLine => ({ kind: 'labor', workerId: null, workerName: '', time: { ...EMPTY_TIME }, dailyRate: null, note: '' }),
  fuel: (): FuelLine => ({ kind: 'fuel', vehicleId: null, vehicleName: '', kmPerL: null, distanceKm: null, pricePerL: null, note: '' }),
  lease: (): LeaseLine => ({ kind: 'lease', itemId: null, itemName: '', spec: '', unit: '', qty: null, unitPrice: null, note: '' }),
  cash: (): CashLineInput => ({ kind: 'cash', itemName: '', spec: '', unit: '', qty: null, unitPrice: null, vendor: '' }),
  credit: (): CreditLineInput => ({ kind: 'credit', itemName: '', spec: '', unit: '', qty: null, unitPrice: null, supplierId: null, vendor: '' }),
  work: (): WorkLine => ({ kind: 'work', estimateItemId: null, trade: '', description: '', qty: null, unit: '', manDays: null, unitPrice: null, source: 'extra' }),
};

export function row<L>(line: L): Row<L> {
  return { key: newKey(), line };
}

function purchaseRow<L extends CashLineInput | CreditLineInput>(line: L): Row<L> {
  // 金額のみ入力のときだけ amountOnly のキーを持つ（空欄なら null）。
  const amountMode = line.amountOnly !== undefined;
  return { key: newKey(), line, amountMode };
}

export function toRows(lines: ReportLineInput[]): Rows {
  const rows: Rows = { labor: [], fuel: [], lease: [], cash: [], credit: [], work: [] };
  for (const l of lines) {
    switch (l.kind) {
      case 'labor': rows.labor.push(row(l)); break;
      case 'fuel': rows.fuel.push(row(l)); break;
      case 'lease': rows.lease.push(row(l)); break;
      case 'cash': rows.cash.push(purchaseRow(l)); break;
      case 'credit': rows.credit.push(purchaseRow(l)); break;
      case 'work': rows.work.push(row(l)); break;
    }
  }
  return rows;
}

export function fromInput(input: SaveInput): FormState {
  return {
    weather: input.weather ?? '',
    supervisor: input.supervisor ?? '',
    common: { ...input.common },
    issuesText: input.issuesText,
    notesText: input.notesText,
    rows: toRows(input.lines),
  };
}

function purchaseLine<L extends CashLineInput | CreditLineInput>(r: Row<L>): L {
  const { amountOnly, ...rest } = r.line;
  if (r.amountMode) return { ...rest, qty: null, unitPrice: null, amountOnly: amountOnly ?? null } as L;
  return rest as L;
}

/** フォームの状態 → 保存の入力（表の順に並べる。sort_order はこの順）。 */
export function toInput(siteId: string, date: string, s: FormState): SaveInput {
  const r = s.rows;
  return {
    siteId,
    date,
    weather: s.weather === '' ? null : s.weather,
    supervisor: s.supervisor.trim() === '' ? null : s.supervisor,
    common: s.common,
    issuesText: s.issuesText,
    notesText: s.notesText,
    lines: [
      ...r.labor.map((x) => x.line),
      ...r.fuel.map((x) => x.line),
      ...r.lease.map((x) => x.line),
      ...r.cash.map(purchaseLine),
      ...r.credit.map(purchaseLine),
      ...r.work.map((x) => x.line),
    ],
  };
}

/** 画面表示の計算用: 金額のみ入力を qty=1・unitPrice=金額 として扱う（サーバーの正規化と同じ）。 */
export function calcLines(lines: ReportLineInput[]): ReportLine[] {
  return lines.map((l) => {
    if ((l.kind === 'cash' || l.kind === 'credit') && l.amountOnly !== null && l.amountOnly !== undefined) {
      const { amountOnly, ...rest } = l;
      return { ...rest, qty: 1, unitPrice: amountOnly };
    }
    return l;
  });
}

export function patchRow<L>(rows: Row<L>[], index: number, patch: Partial<L>): Row<L>[] {
  return rows.map((r, i) => (i === index ? { ...r, line: { ...r.line, ...patch } } : r));
}

export function removeRow<L>(rows: Row<L>[], index: number): Row<L>[] {
  return rows.filter((_, i) => i !== index);
}

/** 円表示（入力途中の不正値では「—」）。 */
export function money(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : yen(n);
}

/** 小数を最大 digits 桁で表示（末尾の0は付けない）。 */
export function decimal(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
}

/** 前回コピーした行の単価・燃費を、この日報の日付時点のマスターで取り直す（マスターに無ければ複写元のまま）。 */
export function refreshFromMasters(lines: ReportLine[], masters: ReportMasters, date: string): ReportLine[] {
  return lines.map((l) => {
    if (l.kind === 'labor') {
      const w = masters.workers.find((x) => x.id === l.workerId);
      return w ? { ...l, workerName: w.name, dailyRate: rateAt(w.rates, date) ?? l.dailyRate } : l;
    }
    if (l.kind === 'fuel') {
      const v = masters.vehicles.find((x) => x.id === l.vehicleId);
      return v ? { ...l, vehicleName: v.name, kmPerL: v.kmPerL ?? l.kmPerL } : l;
    }
    if (l.kind === 'lease') {
      const item = masters.leaseItems.find((x) => x.id === l.itemId);
      return item ? { ...l, itemName: item.name, unitPrice: rateAt(item.rates, date) ?? l.unitPrice } : l;
    }
    return l;
  });
}
