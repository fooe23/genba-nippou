import 'server-only';
import type { RateHistory } from '@/lib/calc/rates';
import type { Affiliation } from '@/lib/types';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * overtimeRate は残業単価（円/H）。null なら標準の計算式（日当 ÷ 基準時間 × 割増率）。0 も null として返す。
 * updatedAt / updatedBy は最後に更新した日時と人（profiles.id。DB のトリガーが入れる。氏名は profiles を別に引いて突き合わせる）。
 */
/** affiliation は所属（自社・協力会社）、supplierId は協力会社のときの取引先（自社なら null）。 */
export interface Worker { id: string; name: string; trade: string | null; note: string | null; active: boolean; rates: RateHistory[]; overtimeRate: number | null; affiliation: Affiliation; supplierId: string | null; updatedAt: string | null; updatedBy: string | null; createdAt: string; }
export interface Supplier { id: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean; updatedAt: string | null; updatedBy: string | null; createdAt: string; }
export interface Vehicle { id: string; name: string; kind: string | null; kmPerL: number | null; note: string | null; active: boolean; updatedAt: string | null; updatedBy: string | null; createdAt: string; }
export interface LeaseItem { id: string; name: string; spec: string | null; note: string | null; active: boolean; rates: RateHistory[]; updatedAt: string | null; updatedBy: string | null; createdAt: string; }
export interface MasterOption { name: string; sortOrder: number; }

interface RateRow { amount: number | string; effective_from: string; updated_by?: string | null; }
// created_at は取り込みの突き合わせ（RPC と同じく作成が最も古い行）に使う。
interface Touched { created_at: string; updated_at?: string | null; updated_by?: string | null; }
interface WorkerRow extends Touched { id: string; name: string; trade: string | null; note: string | null; active: boolean | null; overtime_rate: number | string | null; affiliation?: string | null; supplier_id?: string | null; gn_worker_rates: RateRow[] | null; }
interface SupplierRow extends Touched { id: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean | null; }
interface VehicleRow extends Touched { id: string; name: string; kind: string | null; km_per_l: number | string | null; note: string | null; active: boolean | null; }
interface LeaseItemRow extends Touched { id: string; name: string; spec: string | null; note: string | null; active: boolean | null; gn_lease_item_rates: RateRow[] | null; }
interface OptionRow { name: string; sort_order: number | null; }

// active は NULL 許容（既定 true）。false のときだけ無効扱いにする。
function isActive(v: boolean | null): boolean {
  return v !== false;
}

function mapRates(rows: RateRow[] | null): RateHistory[] {
  return (rows ?? [])
    .map((r) => ({ amount: Number(r.amount), effectiveFrom: r.effective_from, updatedBy: r.updated_by ?? null }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

function touched(r: Touched): { updatedAt: string | null; updatedBy: string | null; createdAt: string } {
  return { updatedAt: r.updated_at ?? null, updatedBy: r.updated_by ?? null, createdAt: r.created_at };
}

// 残業単価: 空欄・0 は「標準の計算式」（DB のトリガーと同じ扱い）なので null にそろえる。
function toOvertimeRate(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 所属：'partner' 以外は自社。自社の supplierId は null にそろえる。
function toAffiliation(a: string | null | undefined, supplierId: string | null | undefined): { affiliation: Affiliation; supplierId: string | null } {
  return a === 'partner' ? { affiliation: 'partner', supplierId: supplierId ?? null } : { affiliation: 'own', supplierId: null };
}

// 更新者の列（update_2026-11-03c_master_import.sql）が未適用の環境（列が無い＝42703）では、更新者なしで読み直す。
// マスターは日報の入力画面でも読むため、SQL の適用前でも画面が壊れないようにする。
async function selectRows<T>(table: string, columns: string, legacyColumns: string): Promise<T[]> {
  const supabase = await createServerSupabase();
  const first = await supabase.from(table).select(columns);
  let { data, error } = first as unknown as { data: unknown[] | null; error: { code?: string; message: string } | null };
  if (error && error.code === '42703') {
    console.error(`[${table}] ${error.message}（更新者の列が無い場合は update_2026-11-03c_master_import.sql を適用してください）`);
    const retry = await supabase.from(table).select(legacyColumns);
    ({ data, error } = retry as unknown as { data: unknown[] | null; error: { code?: string; message: string } | null });
  }
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

// 有効なものを先に、その中は名前順。
function byActiveThenName<T extends { name: string; active: boolean }>(a: T, b: T): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.name.localeCompare(b.name, 'ja');
}

export async function listWorkers(): Promise<Worker[]> {
  const rows = await selectRows<WorkerRow>(
    'gn_workers',
    'id, name, trade, note, active, created_at, overtime_rate, affiliation, supplier_id, updated_at, updated_by, gn_worker_rates(amount, effective_from, updated_by)',
    'id, name, trade, note, active, created_at, overtime_rate, affiliation, supplier_id, gn_worker_rates(amount, effective_from)',
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      trade: r.trade,
      note: r.note,
      active: isActive(r.active),
      rates: mapRates(r.gn_worker_rates),
      overtimeRate: toOvertimeRate(r.overtime_rate),
      ...toAffiliation(r.affiliation, r.supplier_id),
      ...touched(r),
    }))
    .sort(byActiveThenName);
}

export async function listSuppliers(): Promise<Supplier[]> {
  const rows = await selectRows<SupplierRow>(
    'gn_suppliers',
    'id, name, category, contact, note, active, created_at, updated_at, updated_by',
    'id, name, category, contact, note, active, created_at',
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      contact: r.contact,
      note: r.note,
      active: isActive(r.active),
      ...touched(r),
    }))
    .sort(byActiveThenName);
}

export async function listVehicles(): Promise<Vehicle[]> {
  const rows = await selectRows<VehicleRow>(
    'gn_vehicles',
    'id, name, kind, km_per_l, note, active, created_at, updated_at, updated_by',
    'id, name, kind, km_per_l, note, active, created_at',
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      kmPerL: r.km_per_l === null ? null : Number(r.km_per_l),
      note: r.note,
      active: isActive(r.active),
      ...touched(r),
    }))
    .sort(byActiveThenName);
}

export async function listLeaseItems(): Promise<LeaseItem[]> {
  const rows = await selectRows<LeaseItemRow>(
    'gn_lease_items',
    'id, name, spec, note, active, created_at, updated_at, updated_by, gn_lease_item_rates(amount, effective_from, updated_by)',
    'id, name, spec, note, active, created_at, gn_lease_item_rates(amount, effective_from)',
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      spec: r.spec,
      note: r.note,
      active: isActive(r.active),
      rates: mapRates(r.gn_lease_item_rates),
      ...touched(r),
    }))
    .sort(byActiveThenName);
}

async function listOptionRows(table: 'gn_units' | 'gn_weather_options'): Promise<OptionRow[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from(table)
    .select('name, sort_order')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as OptionRow[];
}

/** 単位の名前一覧（並び順どおり）。 */
export async function listUnits(): Promise<string[]> {
  return (await listOptionRows('gn_units')).map((r) => r.name);
}

/** 天候の名前一覧（並び順どおり）。 */
export async function listWeather(): Promise<string[]> {
  return (await listOptionRows('gn_weather_options')).map((r) => r.name);
}

// 管理画面用: 名前と並び順の両方を返す（listUnits / listWeather は名前だけ）。
export async function listUnitOptions(): Promise<MasterOption[]> {
  return (await listOptionRows('gn_units')).map((r) => ({ name: r.name, sortOrder: r.sort_order ?? 0 }));
}

export async function listWeatherOptions(): Promise<MasterOption[]> {
  return (await listOptionRows('gn_weather_options')).map((r) => ({ name: r.name, sortOrder: r.sort_order ?? 0 }));
}
