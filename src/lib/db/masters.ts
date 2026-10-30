import 'server-only';
import type { RateHistory } from '@/lib/calc/rates';
import { createServerSupabase } from '@/lib/supabase/server';

export interface Worker { id: string; name: string; trade: string | null; note: string | null; active: boolean; rates: RateHistory[]; }
export interface Supplier { id: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean; }
export interface Vehicle { id: string; name: string; kind: string | null; kmPerL: number | null; note: string | null; active: boolean; }
export interface LeaseItem { id: string; name: string; spec: string | null; note: string | null; active: boolean; rates: RateHistory[]; }
export interface MasterOption { name: string; sortOrder: number; }

interface RateRow { amount: number | string; effective_from: string; }
interface WorkerRow { id: string; name: string; trade: string | null; note: string | null; active: boolean | null; gn_worker_rates: RateRow[] | null; }
interface SupplierRow { id: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean | null; }
interface VehicleRow { id: string; name: string; kind: string | null; km_per_l: number | string | null; note: string | null; active: boolean | null; }
interface LeaseItemRow { id: string; name: string; spec: string | null; note: string | null; active: boolean | null; gn_lease_item_rates: RateRow[] | null; }
interface OptionRow { name: string; sort_order: number | null; }

// active は NULL 許容（既定 true）。false のときだけ無効扱いにする。
function isActive(v: boolean | null): boolean {
  return v !== false;
}

function mapRates(rows: RateRow[] | null): RateHistory[] {
  return (rows ?? [])
    .map((r) => ({ amount: Number(r.amount), effectiveFrom: r.effective_from }))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
}

// 有効なものを先に、その中は名前順。
function byActiveThenName<T extends { name: string; active: boolean }>(a: T, b: T): number {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.name.localeCompare(b.name, 'ja');
}

export async function listWorkers(): Promise<Worker[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_workers')
    .select('id, name, trade, note, active, gn_worker_rates(amount, effective_from)');
  if (error) throw new Error(error.message);
  return ((data ?? []) as WorkerRow[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      trade: r.trade,
      note: r.note,
      active: isActive(r.active),
      rates: mapRates(r.gn_worker_rates),
    }))
    .sort(byActiveThenName);
}

export async function listSuppliers(): Promise<Supplier[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_suppliers')
    .select('id, name, category, contact, note, active');
  if (error) throw new Error(error.message);
  return ((data ?? []) as SupplierRow[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      contact: r.contact,
      note: r.note,
      active: isActive(r.active),
    }))
    .sort(byActiveThenName);
}

export async function listVehicles(): Promise<Vehicle[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_vehicles')
    .select('id, name, kind, km_per_l, note, active');
  if (error) throw new Error(error.message);
  return ((data ?? []) as VehicleRow[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      kmPerL: r.km_per_l === null ? null : Number(r.km_per_l),
      note: r.note,
      active: isActive(r.active),
    }))
    .sort(byActiveThenName);
}

export async function listLeaseItems(): Promise<LeaseItem[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_lease_items')
    .select('id, name, spec, note, active, gn_lease_item_rates(amount, effective_from)');
  if (error) throw new Error(error.message);
  return ((data ?? []) as LeaseItemRow[])
    .map((r) => ({
      id: r.id,
      name: r.name,
      spec: r.spec,
      note: r.note,
      active: isActive(r.active),
      rates: mapRates(r.gn_lease_item_rates),
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
