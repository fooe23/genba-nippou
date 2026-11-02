'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  leaseItemInputSchema,
  leaseItemWithRateSchema,
  optionInputSchema,
  parseOrThrow,
  rateInputSchema,
  supplierInputSchema,
  vehicleInputSchema,
  workerInputSchema,
  workerWithRateSchema,
  type LeaseItemInput,
  type LeaseItemWithRateInput,
  type SupplierInput,
  type VehicleInput,
  type WorkerInput,
  type WorkerWithRateInput,
} from '@/lib/db/masters-schemas';

const PATH = '/admin/masters';

// undefined → 触らない / 空文字 → null（クリア）/ それ以外はそのまま。
function nullable(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === '' ? null : v;
}

function defined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

async function saveRow(
  supabase: SupabaseClient,
  table: string,
  id: string | undefined,
  row: Record<string, unknown>,
): Promise<string> {
  const values = defined(row);
  const query = id
    ? supabase.from(table).update(values).eq('id', id)
    : supabase.from(table).insert(values);
  const { data, error } = await query.select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function upsertWorker(input: WorkerInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(workerInputSchema, input);
  const supabase = await createServerSupabase();
  const id = await saveRow(supabase, 'gn_workers', v.id, {
    name: v.name,
    trade: nullable(v.trade),
    note: nullable(v.note),
    overtime_rate: v.overtimeRate,
    active: v.active,
  });
  revalidatePath(PATH);
  return id;
}

export async function addWorkerRate(workerId: string, amount: number, effectiveFrom: string): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(rateInputSchema, { ownerId: workerId, amount, effectiveFrom });
  const supabase = await createServerSupabase();
  // 同じ適用開始日があれば金額を上書きする（unique(worker_id, effective_from)）。
  const { error } = await supabase
    .from('gn_worker_rates')
    .upsert(
      { worker_id: v.ownerId, amount: v.amount, effective_from: v.effectiveFrom },
      { onConflict: 'worker_id,effective_from' },
    );
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

export async function upsertSupplier(input: SupplierInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(supplierInputSchema, input);
  const supabase = await createServerSupabase();
  const id = await saveRow(supabase, 'gn_suppliers', v.id, {
    name: v.name,
    category: nullable(v.category),
    contact: nullable(v.contact),
    note: nullable(v.note),
    active: v.active,
  });
  revalidatePath(PATH);
  return id;
}

export async function upsertVehicle(input: VehicleInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(vehicleInputSchema, input);
  const supabase = await createServerSupabase();
  const id = await saveRow(supabase, 'gn_vehicles', v.id, {
    name: v.name,
    kind: nullable(v.kind),
    km_per_l: v.kmPerL,
    note: nullable(v.note),
    active: v.active,
  });
  revalidatePath(PATH);
  return id;
}

export async function upsertLeaseItem(input: LeaseItemInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(leaseItemInputSchema, input);
  const supabase = await createServerSupabase();
  const id = await saveRow(supabase, 'gn_lease_items', v.id, {
    name: v.name,
    spec: nullable(v.spec),
    note: nullable(v.note),
    active: v.active,
  });
  revalidatePath(PATH);
  return id;
}

export async function addLeaseItemRate(itemId: string, amount: number, effectiveFrom: string): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(rateInputSchema, { ownerId: itemId, amount, effectiveFrom });
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('gn_lease_item_rates')
    .upsert(
      { item_id: v.ownerId, amount: v.amount, effective_from: v.effectiveFrom },
      { onConflict: 'item_id,effective_from' },
    );
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

// 単位・天候は name が一意。同名があれば並び順を更新、無ければ追加する。
export async function upsertUnit(name: string, sortOrder: number): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(optionInputSchema, { name, sortOrder });
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('gn_units')
    .upsert({ name: v.name, sort_order: v.sortOrder }, { onConflict: 'name' });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

export async function upsertWeather(name: string, sortOrder: number): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(optionInputSchema, { name, sortOrder });
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('gn_weather_options')
    .upsert({ name: v.name, sort_order: v.sortOrder }, { onConflict: 'name' });
  if (error) throw new Error(error.message);
  revalidatePath(PATH);
}

// 新規作成と初回単価を1アクションで行う。単価の登録に失敗したら作成した行を削除して巻き戻す
// （再試行しても重複登録にならない）。検証は書き込み前に両方済ませる。
async function createWithRate(
  masterTable: string,
  rateTable: string,
  ownerColumn: string,
  master: Record<string, unknown>,
  amount: number,
  effectiveFrom: string,
): Promise<string> {
  const supabase = await createServerSupabase();
  const id = await saveRow(supabase, masterTable, undefined, master);
  const { error } = await supabase
    .from(rateTable)
    .insert({ [ownerColumn]: id, amount, effective_from: effectiveFrom });
  if (error) {
    const { error: rollbackError } = await supabase.from(masterTable).delete().eq('id', id);
    if (rollbackError) {
      throw new Error('単価の登録に失敗し、作成した行の取り消しにも失敗しました。一覧を確認してください。');
    }
    throw new Error('単価の登録に失敗したため、登録を取り消しました。もう一度お試しください。');
  }
  return id;
}

export async function createWorkerWithRate(input: WorkerWithRateInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(workerWithRateSchema, input);
  const id = await createWithRate(
    'gn_workers',
    'gn_worker_rates',
    'worker_id',
    { name: v.name, trade: nullable(v.trade), note: nullable(v.note), overtime_rate: v.overtimeRate },
    v.amount,
    v.effectiveFrom,
  );
  revalidatePath(PATH);
  return id;
}

export async function createLeaseItemWithRate(input: LeaseItemWithRateInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(leaseItemWithRateSchema, input);
  const id = await createWithRate(
    'gn_lease_items',
    'gn_lease_item_rates',
    'item_id',
    { name: v.name, spec: nullable(v.spec), note: nullable(v.note) },
    v.amount,
    v.effectiveFrom,
  );
  revalidatePath(PATH);
  return id;
}
