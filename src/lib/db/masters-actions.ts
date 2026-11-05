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
  workerDeleteError,
  workerIdSchema,
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

// 所属の列。省略（undefined）なら変更しない。自社なら取引先は null、協力会社なら選んだ取引先（検証済みで必須）。
function affiliationColumns(v: { affiliation?: 'own' | 'partner'; supplierId?: string | null }): Record<string, unknown> {
  if (v.affiliation === undefined) return {};
  return v.affiliation === 'partner'
    ? { affiliation: 'partner', supplier_id: v.supplierId ?? null }
    : { affiliation: 'own', supplier_id: null };
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
    ...affiliationColumns(v),
  });
  revalidatePath(PATH);
  return id;
}

export type DeleteWorkerResult = { ok: true } | { ok: false; error: string };

const DELETE_WORKER_FAILED = '削除に失敗しました。もう一度お試しください。';

/**
 * 作業員を削除する（管理者のみ。ほかのマスターの書き込みと同じ）。日報の作業員の行・繰越の初期値で一度も使っていない
 * 作業員だけ削除でき、現場の選択（gn_site_workers）からも一緒に外す。単価の履歴は DB の on delete cascade で消える。
 * 使っている作業員は { ok: false, error: '日報や繰越で使っているため削除できません。無効にしてください' }。
 */
export async function deleteWorker(id: string): Promise<DeleteWorkerResult> {
  await requireAdmin();
  const parsed = workerIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const workerId = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const [lines, carryovers] = await Promise.all([
      supabase.from('gn_report_lines').select('id', { count: 'exact', head: true }).eq('kind', 'labor').eq('ref_id', workerId),
      supabase.from('gn_carryovers').select('id', { count: 'exact', head: true }).eq('worker_id', workerId),
    ]);
    if (lines.error || carryovers.error || lines.count === null || carryovers.count === null) {
      console.error('[deleteWorker:usage]', lines.error?.message, carryovers.error?.message);
      return { ok: false, error: DELETE_WORKER_FAILED };
    }
    const inUse = workerDeleteError({ reportLines: lines.count, carryovers: carryovers.count });
    if (inUse) return { ok: false, error: inUse };

    const { error: siteError } = await supabase.from('gn_site_workers').delete().eq('worker_id', workerId);
    if (siteError) {
      console.error('[deleteWorker:site_workers]', siteError.message);
      return { ok: false, error: DELETE_WORKER_FAILED };
    }
    const { data, error } = await supabase.from('gn_workers').delete().eq('id', workerId).select('id');
    if (error) {
      console.error('[deleteWorker]', error.message);
      return { ok: false, error: DELETE_WORKER_FAILED };
    }
    if ((data ?? []).length === 0) return { ok: false, error: '作業員が見つかりません' };
  } catch (e) {
    console.error('[deleteWorker]', e);
    return { ok: false, error: DELETE_WORKER_FAILED };
  }
  revalidatePath(PATH);
  revalidatePath('/admin/sites/[siteId]', 'page');
  return { ok: true };
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
    { name: v.name, trade: nullable(v.trade), note: nullable(v.note), overtime_rate: v.overtimeRate, ...affiliationColumns(v) },
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
