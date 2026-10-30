import { amount, fuelCost, laborLineValues, productivity } from '@/lib/calc/report';
import type { ReportLine, TimeSpec } from '@/lib/types';
import type { SaveInput } from '@/lib/report/schema';

// 日報の明細と gn_report_lines の列の相互変換（純関数。サーバーの読み書きから使う）。
// 計算値（hours・man_days・amount・productivity）はここでも計算して送るが、DB のトリガー
// （gn_report_lines_compute）が入力値から同じ式で計算し直すので、保存される値は DB 側の計算になる。
// jsonb_populate_record は数値・uuid 列に "" を渡すとエラーになるため、空値は必ず null で送る。

/** gn_report_lines の1行（id・report_id・created_at を除く）。 */
export interface LineRow {
  kind: ReportLine['kind'];
  sort_order: number;
  ref_id: string | null;
  name: string | null;
  spec: string | null;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
  start_time: string | null;
  end_time: string | null;
  break_min: number | null;
  gap_min: number | null;
  hours: number | null;
  man_days: number | null;
  km_per_l: number | null;
  distance_km: number | null;
  price_per_l: number | null;
  vendor: string | null;
  trade: string | null;
  description: string | null;
  productivity: number | null;
  source: 'estimate' | 'extra' | null;
  note: string | null;
}

/** gn_save_report の p_report。 */
export interface ReportRow {
  site_id: string;
  report_date: string;
  weather: string | null;
  supervisor: string | null;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | null;
  common_gap_min: number | null;
  issues_text: string | null;
  notes_text: string | null;
  /** 楽観ロック：画面を開いたときの updated_at。null なら比べない（新しい日報など）。 */
  expected_updated_at?: string | null;
}

const EMPTY_ROW: Omit<LineRow, 'kind' | 'sort_order'> = {
  ref_id: null, name: null, spec: null, unit: null, qty: null, unit_price: null, amount: null,
  start_time: null, end_time: null, break_min: null, gap_min: null, hours: null, man_days: null,
  km_per_l: null, distance_km: null, price_per_l: null, vendor: null, trade: null, description: null,
  productivity: null, source: null, note: null,
};

function text(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

// 浮動小数の誤差（20330.000000000004 など）を落とす。
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function toLineRow(line: ReportLine, common: TimeSpec, sortOrder: number): LineRow {
  const base = { ...EMPTY_ROW, kind: line.kind, sort_order: sortOrder };
  switch (line.kind) {
    case 'labor': {
      const v = laborLineValues(line, common);
      return {
        ...base,
        ref_id: text(line.workerId),
        name: text(line.workerName),
        start_time: text(line.time.start),
        end_time: text(line.time.end),
        break_min: num(line.time.breakMin),
        gap_min: num(line.time.gapMin),
        hours: clean(v.hours),
        man_days: clean(v.manDays),
        unit_price: num(line.dailyRate),
        amount: clean(v.cost),
        note: text(line.note),
      };
    }
    case 'fuel':
      return {
        ...base,
        ref_id: text(line.vehicleId),
        name: text(line.vehicleName),
        km_per_l: num(line.kmPerL),
        distance_km: num(line.distanceKm),
        price_per_l: num(line.pricePerL),
        amount: clean(fuelCost(line.distanceKm, line.kmPerL, line.pricePerL)),
        note: text(line.note),
      };
    case 'lease':
      return {
        ...base,
        ref_id: text(line.itemId),
        name: text(line.itemName),
        spec: text(line.spec),
        unit: text(line.unit),
        qty: num(line.qty),
        unit_price: num(line.unitPrice),
        amount: clean(amount(line.qty, line.unitPrice)),
        note: text(line.note),
      };
    case 'cash':
    case 'credit':
      return {
        ...base,
        ref_id: line.kind === 'credit' ? text(line.supplierId) : null,
        name: text(line.itemName),
        spec: text(line.spec),
        unit: text(line.unit),
        qty: num(line.qty),
        unit_price: num(line.unitPrice),
        amount: clean(amount(line.qty, line.unitPrice)),
        vendor: text(line.vendor),
      };
    case 'work': {
      const p = productivity(line.qty, line.manDays);
      return {
        ...base,
        ref_id: text(line.estimateItemId),
        trade: text(line.trade),
        description: text(line.description),
        qty: num(line.qty),
        unit: text(line.unit),
        man_days: num(line.manDays),
        unit_price: num(line.unitPrice),
        amount: clean(amount(line.qty, line.unitPrice)),
        productivity: p === null ? null : clean(p),
        source: line.source,
      };
    }
  }
}

export function toLineRows(lines: ReportLine[], common: TimeSpec): LineRow[] {
  return lines.map((l, i) => toLineRow(l, common, i));
}

export function toReportRow(v: SaveInput): ReportRow {
  return {
    site_id: v.siteId,
    report_date: v.date,
    weather: text(v.weather),
    supervisor: text(v.supervisor),
    common_start: text(v.common.start),
    common_end: text(v.common.end),
    common_break_min: num(v.common.breakMin),
    common_gap_min: num(v.common.gapMin),
    issues_text: text(v.issuesText),
    notes_text: text(v.notesText),
  };
}

// ─── 読み取り（DB → 明細） ───

/** PostgREST から返る行（numeric は文字列のこともある）。 */
export type LineRowRead = { [K in keyof LineRow]?: LineRow[K] | string | null };

function rNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function rId(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function rTime(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 種類が不明な行は null（読み飛ばす）。 */
export function fromLineRow(r: LineRowRead): ReportLine | null {
  switch (r.kind) {
    case 'labor':
      return {
        kind: 'labor',
        workerId: rId(r.ref_id),
        workerName: rStr(r.name),
        time: { start: rTime(r.start_time), end: rTime(r.end_time), breakMin: rNum(r.break_min), gapMin: rNum(r.gap_min) },
        dailyRate: rNum(r.unit_price),
        note: rStr(r.note),
      };
    case 'fuel':
      return {
        kind: 'fuel',
        vehicleId: rId(r.ref_id),
        vehicleName: rStr(r.name),
        kmPerL: rNum(r.km_per_l),
        distanceKm: rNum(r.distance_km),
        pricePerL: rNum(r.price_per_l),
        note: rStr(r.note),
      };
    case 'lease':
      return {
        kind: 'lease',
        itemId: rId(r.ref_id),
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        note: rStr(r.note),
      };
    case 'cash':
      return {
        kind: 'cash',
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        vendor: rStr(r.vendor),
      };
    case 'credit':
      return {
        kind: 'credit',
        itemName: rStr(r.name),
        spec: rStr(r.spec),
        unit: rStr(r.unit),
        qty: rNum(r.qty),
        unitPrice: rNum(r.unit_price),
        supplierId: rId(r.ref_id),
        vendor: rStr(r.vendor),
      };
    case 'work':
      return {
        kind: 'work',
        estimateItemId: rId(r.ref_id),
        trade: rStr(r.trade),
        description: rStr(r.description),
        qty: rNum(r.qty),
        unit: rStr(r.unit),
        manDays: rNum(r.man_days),
        unitPrice: rNum(r.unit_price),
        source: r.source === 'estimate' ? 'estimate' : 'extra',
      };
    default:
      return null;
  }
}

/** 前回コピー: 作業員・車両・リースだけを複写。作業員の個別時間と車両の走行距離は空にする（リースの数量はそのまま）。 */
export function copyableLines(lines: ReportLine[]): ReportLine[] {
  const out: ReportLine[] = [];
  for (const l of lines) {
    if (l.kind === 'labor') out.push({ ...l, time: { start: null, end: null, breakMin: null, gapMin: null } });
    else if (l.kind === 'fuel') out.push({ ...l, distanceKm: null });
    else if (l.kind === 'lease') out.push({ ...l });
  }
  return out;
}

/** 他の端末で更新・削除されていたときの文言（楽観ロック）。 */
export const STALE_REPORT_MESSAGE = '他の端末で更新されています。画面を再読み込みしてから保存してください。';

/** gn_save_report / ガードトリガーのエラーを利用者向けの文言に変換する。 */
export function saveErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('stale_report')) return STALE_REPORT_MESSAGE;
  if (m.includes('approved_report_locked')) return '承認済みのため編集できません';
  if (m.includes('not_reviewer')) return 'この現場の確認者・承認者ではありません';
  return '保存に失敗しました。通信状況を確認してもう一度お試しください。';
}
