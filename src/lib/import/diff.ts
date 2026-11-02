import { rateAt } from '@/lib/calc/rates';
import type {
  CurrentMasters, FieldChange, ImportPreview, LeaseItemPayload, ParsedRows, PreviewRow, SupplierPayload,
  VehiclePayload, WorkerPayload,
} from './types';

// 読み取った行とアプリの現在のマスターの差分。規則は RPC gn_import_masters と同じ：
//   * 名前の前後の空白を除いた完全一致で突き合わせる（DB の btrim と同じく半角スペースだけを除く）。
//   * 既存の行は「空でない項目」だけ比べる（空は「変更しない」なので差分に出さない）。
//   * 日当・リース単価は適用開始日時点の有効単価（rateAt）と比べ、違えば履歴を追加する。
//   * 残業単価の 0 は null（標準の計算式）＝空として扱う。

const numberFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** "2026-11-03" → "2026/11/03" */
function slashDate(date: string): string {
  return date.replaceAll('-', '/');
}

/** DB の btrim(name) と同じ（半角スペースだけを除く）。 */
function dbTrim(s: string): string {
  return s.replace(/^ +| +$/g, '');
}

function indexByName<T extends { name: string }>(list: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of list) {
    const key = dbTrim(item.name);
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}

const UNSET = '未設定';

function textChange(label: string, before: string | null, after: string | null): FieldChange | null {
  if (after === null || after === before) return null;
  return { label, before: before ?? UNSET, after };
}

function numberChange(label: string, before: number | null, after: number | null, unit = ''): FieldChange | null {
  if (after === null || after === before) return null;
  return { label, before: before === null ? UNSET : `${formatNumber(before)}${unit}`, after: `${formatNumber(after)}${unit}` };
}

function rateChange(label: string, before: number | null, after: number | null, effectiveFrom: string): FieldChange | null {
  if (after === null || after === before) return null;
  return {
    label,
    before: before === null ? UNSET : formatNumber(before),
    after: `${formatNumber(after)}（適用開始 ${slashDate(effectiveFrom)}）`,
  };
}

/** 新規の行：空でない項目を「登録する値」として並べる（before は空文字）。 */
function asNew(changes: (FieldChange | null)[]): FieldChange[] {
  return changes.filter((c): c is FieldChange => c !== null).map((c) => ({ ...c, before: '' }));
}

function present(changes: (FieldChange | null)[]): FieldChange[] {
  return changes.filter((c): c is FieldChange => c !== null);
}

function previewRow<P>(kind: string, name: string, existing: { active: boolean } | undefined, changes: FieldChange[], payload: P): PreviewRow<P> {
  return {
    key: `${kind}:${name}`,
    status: existing === undefined ? 'new' : changes.length > 0 ? 'updated' : 'unchanged',
    name,
    changes,
    payload,
    inactive: existing !== undefined && !existing.active,
  };
}

export function diffMasters(parsed: ParsedRows, current: CurrentMasters, effectiveFrom: string): ImportPreview {
  const workers = indexByName(current.workers);
  const suppliers = indexByName(current.suppliers);
  const vehicles = indexByName(current.vehicles);
  const leaseItems = indexByName(current.leaseItems);

  return {
    workers: parsed.workers.map((r) => {
      const overtime = r.overtimeRate === 0 ? null : r.overtimeRate;
      const payload: WorkerPayload = { name: r.name, trade: r.trade, note: r.note, daily_rate: r.dailyRate, overtime_rate: overtime };
      const cur = workers.get(r.name);
      const changes = [
        textChange('職種', cur?.trade ?? null, r.trade),
        rateChange('日当', cur ? rateAt(cur.rates, effectiveFrom) : null, r.dailyRate, effectiveFrom),
        numberChange('残業単価', cur?.overtimeRate ?? null, overtime, '/H'),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('workers', r.name, cur, cur ? present(changes) : asNew(changes), payload);
    }),
    suppliers: parsed.suppliers.map((r) => {
      const payload: SupplierPayload = { name: r.name, category: r.category, contact: r.contact, note: r.note };
      const cur = suppliers.get(r.name);
      const changes = [
        textChange('区分', cur?.category ?? null, r.category),
        textChange('連絡先', cur?.contact ?? null, r.contact),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('suppliers', r.name, cur, cur ? present(changes) : asNew(changes), payload);
    }),
    vehicles: parsed.vehicles.map((r) => {
      const payload: VehiclePayload = { name: r.name, kind: r.kind, km_per_l: r.kmPerL, note: r.note };
      const cur = vehicles.get(r.name);
      const changes = [
        textChange('区分', cur?.kind ?? null, r.kind),
        numberChange('燃費', cur?.kmPerL ?? null, r.kmPerL, ' km/ℓ'),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('vehicles', r.name, cur, cur ? present(changes) : asNew(changes), payload);
    }),
    leaseItems: parsed.leaseItems.map((r) => {
      const payload: LeaseItemPayload = { name: r.name, spec: r.spec, note: r.note, unit_price: r.unitPrice };
      const cur = leaseItems.get(r.name);
      const changes = [
        textChange('規格', cur?.spec ?? null, r.spec),
        rateChange('単価', cur ? rateAt(cur.rates, effectiveFrom) : null, r.unitPrice, effectiveFrom),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('leaseItems', r.name, cur, cur ? present(changes) : asNew(changes), payload);
    }),
  };
}
