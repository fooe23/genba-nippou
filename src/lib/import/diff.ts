import { rateAt } from '@/lib/calc/rates';
import type {
  CurrentMasters, FieldChange, ImportPreview, LeaseItemPayload, ParsedRows, PreviewRow, SupplierPayload,
  VehiclePayload, WorkerPayload,
} from './types';

// 読み取った行とアプリの現在のマスターの差分。規則は RPC gn_import_masters と同じ：
//   * 名前の前後の空白を除いた完全一致で突き合わせる（DB の btrim と同じく半角スペースだけを除く）。
//     同じ名前の既存行が複数あれば RPC は作成が最も古い行を更新するが、取り違えを防ぐため確認画面でエラーにして送らない。
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

function createdTime(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export interface NameIndex<T> {
  /** 名前ごとに、RPC（order by created_at limit 1）と同じく作成が最も古い行。 */
  oldest: Map<string, T>;
  /** 名前ごとの既存行の件数（2 以上なら取り込まない）。 */
  count: Map<string, number>;
}

/** 既存行を DB の btrim した名前でまとめる。 */
export function indexByName<T extends { name: string; createdAt: string }>(list: readonly T[]): NameIndex<T> {
  const oldest = new Map<string, T>();
  const count = new Map<string, number>();
  for (const item of list) {
    const key = dbTrim(item.name);
    count.set(key, (count.get(key) ?? 0) + 1);
    const prev = oldest.get(key);
    if (prev === undefined || createdTime(item.createdAt) < createdTime(prev.createdAt)) oldest.set(key, item);
  }
  return { oldest, count };
}

/** アプリに同じ名前の行が 2 件以上あるときの理由（無ければ null）。 */
function duplicateError(index: NameIndex<unknown>, name: string): string | null {
  const n = index.count.get(name) ?? 0;
  return n >= 2 ? `同じ名前の行が ${n} 件登録されています。管理 → マスターで 1 件に整理してから取り込んでください。` : null;
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

function previewRow<P>(
  kind: string,
  name: string,
  index: NameIndex<{ active: boolean }>,
  changes: FieldChange[],
  payload: P,
): PreviewRow<P> {
  const existing = index.oldest.get(name);
  const error = duplicateError(index, name);
  if (error) return { key: `${kind}:${name}`, status: 'error', name, changes: [], payload, inactive: false, error };
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
      const cur = workers.oldest.get(r.name);
      const changes = [
        textChange('職種', cur?.trade ?? null, r.trade),
        rateChange('日当', cur ? rateAt(cur.rates, effectiveFrom) : null, r.dailyRate, effectiveFrom),
        numberChange('残業単価', cur?.overtimeRate ?? null, overtime, '/H'),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('workers', r.name, workers, cur ? present(changes) : asNew(changes), payload);
    }),
    suppliers: parsed.suppliers.map((r) => {
      const payload: SupplierPayload = { name: r.name, category: r.category, contact: r.contact, note: r.note };
      const cur = suppliers.oldest.get(r.name);
      const changes = [
        textChange('区分', cur?.category ?? null, r.category),
        textChange('連絡先', cur?.contact ?? null, r.contact),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('suppliers', r.name, suppliers, cur ? present(changes) : asNew(changes), payload);
    }),
    vehicles: parsed.vehicles.map((r) => {
      const payload: VehiclePayload = { name: r.name, kind: r.kind, km_per_l: r.kmPerL, note: r.note };
      const cur = vehicles.oldest.get(r.name);
      const changes = [
        textChange('区分', cur?.kind ?? null, r.kind),
        numberChange('燃費', cur?.kmPerL ?? null, r.kmPerL, ' km/ℓ'),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('vehicles', r.name, vehicles, cur ? present(changes) : asNew(changes), payload);
    }),
    leaseItems: parsed.leaseItems.map((r) => {
      const payload: LeaseItemPayload = { name: r.name, spec: r.spec, note: r.note, unit_price: r.unitPrice };
      const cur = leaseItems.oldest.get(r.name);
      const changes = [
        textChange('規格', cur?.spec ?? null, r.spec),
        rateChange('単価', cur ? rateAt(cur.rates, effectiveFrom) : null, r.unitPrice, effectiveFrom),
        textChange('メモ', cur?.note ?? null, r.note),
      ];
      return previewRow('leaseItems', r.name, leaseItems, cur ? present(changes) : asNew(changes), payload);
    }),
  };
}
