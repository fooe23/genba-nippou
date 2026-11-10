import { rateAt, type RateHistory } from '@/lib/calc/rates';
import { yen } from '@/lib/calc/format';
import { withoutSaved } from '@/lib/report/rows';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { SiteTrade, TradeAlias } from '@/lib/budget/types';
import type { CashLineInput, CreditLineInput, ReportLineInput, SaveInput } from '@/lib/report/schema';
import type { Affiliation, FuelLine, LaborLine, LeaseLine, ReportLine, TimeSpec, WorkLine } from '@/lib/types';

// 日報入力フォームの状態と変換（純関数）。表ごとに行を持ち、保存時に SaveInput へ並べ直す。

/**
 * overtimeRate は作業員マスターの残業単価（円/H）。null なら標準の計算式（日当 ÷ 基準時間 × 割増率）。
 * affiliation・supplierId は作業員マスターのいまの所属（社内の表示と、常用／請負の欄を出すかの判断に使う。省略は所属不明）。
 */
export interface WorkerOption {
  id: string;
  name: string;
  active: boolean;
  rates: RateHistory[];
  overtimeRate: number | null;
  affiliation?: Affiliation;
  supplierId?: string | null;
}
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
  /** 取引先 ID → 名前（作業員の行の所属の表示用。無効な取引先も含む）。省略時は名前を出さない。 */
  supplierNames?: Record<string, string>;
  /** 現場の工種（実行予算の工種。並び順）。作業内容の行の工種の選択肢。省略・空なら工種の欄は手入力だけ。 */
  siteTrades?: SiteTrade[];
  /** 現場の読み替え表（日報の工種の文字 → 工種）。1 日分の Excel の取り込みで工種を決めるのに使う。 */
  tradeAliases?: TradeAlias[];
  /**
   * 外注の買掛の支払先（現場の協力会社。2026-11-17）。undefined は区分の欄を出さない（協力会社のアカウント・SQL の前）。
   */
  subcontractSuppliers?: SupplierOption[];
}

/** 表の1行。key は React 用、amountMode は現金・買掛の「金額のみ入力」、manual は作業員・買掛の仕入先で「（手入力）」を選んだ印。 */
export interface Row<L> { key: string; line: L; amountMode?: boolean; manual?: boolean; }
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

/**
 * まだ保存されていない日報の共通時間の初期値。現場の既定に開始・終了の両方が入っていれば現場の 4 項目を、
 * そうでなければ全社の設定の既定（4 項目まとめて）を使う。
 */
export function newReportCommon(site: TimeSpec, company: TimeSpec): TimeSpec {
  if (site.start && site.end) return { ...site };
  return { ...company };
}

export const newLine = {
  labor: (): LaborLine => ({ kind: 'labor', workerId: null, workerName: '', time: { ...EMPTY_TIME }, dailyRate: null, note: '', overtimeRate: null }),
  fuel: (): FuelLine => ({ kind: 'fuel', vehicleId: null, vehicleName: '', kmPerL: null, distanceKm: null, pricePerL: null, note: '', issueId: null }),
  lease: (): LeaseLine => ({ kind: 'lease', itemId: null, itemName: '', spec: '', unit: '', qty: null, unitPrice: null, note: '', issueId: null }),
  cash: (): CashLineInput => ({ kind: 'cash', itemName: '', spec: '', unit: '', qty: null, unitPrice: null, vendor: '', issueId: null }),
  credit: (): CreditLineInput => ({ kind: 'credit', itemName: '', spec: '', unit: '', qty: null, unitPrice: null, supplierId: null, vendor: '', purchaseKind: 'material', siteTradeId: null, issueId: null }),
  work: (): WorkLine => ({ kind: 'work', estimateItemId: null, trade: '', description: '', qty: null, unit: '', manDays: null, unitPrice: null, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null }),
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

/** フォームの状態 → 保存の入力（表の順に並べる。sort_order はこの順）。労務行の DB の計算値（saved）は含めない（保存・下書きに持ち込まない）。 */
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
      ...r.labor.map((x) => withoutSaved(x.line)),
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

/**
 * 作業員・仕入先の「（手入力）」の行か。参照（ID）が無く、「（手入力）」を選んだ印があるか名前が入っている行。
 * 新しい空の行（未選択）は印も名前も無いので手入力ではない。保存済み・前回コピー・下書きの行は名前で判断する。
 */
export function isManualRow<L>(r: Row<L>, refId: string | null, name: string): boolean {
  return refId === null && (r.manual === true || name !== '');
}

/** 作業員・仕入先の選び直し・手入力の名前の入力：line に patch を当て、「（手入力）」の印を付け外しする。 */
export function selectRow<L>(rows: Row<L>[], index: number, patch: Partial<L>, manual: boolean): Row<L>[] {
  return rows.map((r, i) => (i === index ? { ...r, manual, line: { ...r.line, ...patch } } : r));
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

/** 前回コピーした行の単価・燃費・残業単価を、この日報の日付時点のマスターで取り直す（マスターに無ければ複写元のまま）。 */
export function refreshFromMasters(lines: ReportLine[], masters: ReportMasters, date: string): ReportLine[] {
  return lines.map((l) => {
    if (l.kind === 'labor') {
      const w = masters.workers.find((x) => x.id === l.workerId);
      // 所属の写しは複写元の日のもの。この日報ではサーバーが保存時に決め直すので、写しは持ち込まない。
      // 常用・請負は複写する（いまの所属が自社なら外す）。
      const { affiliation: _affiliation, supplierId: _supplierId, ...rest } = l;
      void _affiliation;
      void _supplierId;
      if (!w) return rest;
      return {
        ...rest,
        workerName: w.name,
        dailyRate: rateAt(w.rates, date) ?? l.dailyRate,
        overtimeRate: w.overtimeRate,
        ...(w.affiliation === 'own' && l.laborContract !== undefined ? { laborContract: null } : {}),
      };
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

/**
 * 日報を開いたとき、未設定（null）の日当・リース単価・燃費だけを、この日付時点のマスターで補う。
 * 値がある行は保存時のスナップショットなのでそのまま。マスターに有効な値が無ければ null のまま。
 * filled は補った項目の数。
 */
export function fillMissingRates<L extends ReportLineInput>(
  lines: L[],
  masters: ReportMasters,
  date: string,
): { lines: L[]; filled: number } {
  let filled = 0;
  const out = lines.map((l): L => {
    if (l.kind === 'labor' && l.dailyRate === null && l.workerId) {
      const rate = rateAt(masters.workers.find((x) => x.id === l.workerId)?.rates ?? [], date);
      if (rate !== null) {
        filled += 1;
        return { ...l, dailyRate: rate };
      }
    } else if (l.kind === 'lease' && l.unitPrice === null && l.itemId) {
      const rate = rateAt(masters.leaseItems.find((x) => x.id === l.itemId)?.rates ?? [], date);
      if (rate !== null) {
        filled += 1;
        return { ...l, unitPrice: rate };
      }
    } else if (l.kind === 'fuel' && l.kmPerL === null && l.vehicleId) {
      const km = masters.vehicles.find((x) => x.id === l.vehicleId)?.kmPerL ?? null;
      if (km !== null) {
        filled += 1;
        return { ...l, kmPerL: km };
      }
    }
    return l;
  });
  return { lines: out, filled };
}
