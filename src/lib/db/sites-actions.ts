'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOrThrow } from '@/lib/db/masters-schemas';
import { requireAdmin, toAccountType } from '@/lib/db/profile';
import type { Carryover, SiteInput, SiteMasters } from '@/lib/db/sites';
import { carryoverSchema, memberSchema, partnerRoleError, siteInputSchema, siteMastersSchema } from '@/lib/db/sites-schemas';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SiteRole } from '@/lib/types';

function revalidateSite(siteId: string): void {
  revalidatePath('/admin/sites');
  revalidatePath(`/admin/sites/${siteId}`);
}

export async function upsertSite(input: SiteInput): Promise<string> {
  await requireAdmin();
  const v = parseOrThrow(siteInputSchema, input);
  const supabase = await createServerSupabase();
  const row = {
    name: v.name,
    client_name: v.clientName,
    project_name: v.projectName,
    project_no: v.projectNo,
    overview: v.overview,
    contract_amount: v.contractAmount,
    start_date: v.startDate,
    end_date: v.endDate,
    contract_type: v.contractType,
  };
  const query = v.id
    ? supabase.from('gn_sites').update(v.status ? { ...row, status: v.status } : row).eq('id', v.id)
    : supabase.from('gn_sites').insert({ ...row, status: v.status ?? 'active' });
  const { data, error } = await query.select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  revalidateSite(id);
  return id;
}

export type SiteMemberResult = { ok: true } | { ok: false; error: string };

const MEMBER_FAILED = '担当者の保存に失敗しました。もう一度お試しください。';

/**
 * 担当者の追加・役割変更。role を null にすると外す。
 * 本番では throw した文言が画面に届かないため、{ ok, error } を返す。
 * 協力会社（partner）は担当（staff）以外にできない。
 */
export async function setSiteMember(siteId: string, userId: string, role: SiteRole | null): Promise<SiteMemberResult> {
  await requireAdmin();
  const parsed = memberSchema.safeParse({ siteId, userId, role });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  const supabase = await createServerSupabase();

  if (v.role === null) {
    const { error } = await supabase.from('gn_site_members').delete().eq('site_id', v.siteId).eq('user_id', v.userId);
    if (error) {
      console.error('[setSiteMember:delete]', error.message);
      return { ok: false, error: MEMBER_FAILED };
    }
  } else {
    if (v.role !== 'staff') {
      const { data: target, error: targetError } = await supabase
        .from('profiles')
        .select('account_type')
        .eq('id', v.userId)
        .maybeSingle();
      if (targetError) {
        console.error('[setSiteMember:profile]', targetError.message);
        return { ok: false, error: MEMBER_FAILED };
      }
      if (!target) return { ok: false, error: '社員が見つかりません' };
      const message = partnerRoleError(toAccountType((target as { account_type: unknown }).account_type), v.role);
      if (message) return { ok: false, error: message };
    }
    const { error } = await supabase
      .from('gn_site_members')
      .upsert({ site_id: v.siteId, user_id: v.userId, role: v.role }, { onConflict: 'site_id,user_id' });
    if (error) {
      console.error('[setSiteMember:upsert]', error.message);
      return { ok: false, error: MEMBER_FAILED };
    }
  }
  revalidateSite(v.siteId);
  return { ok: true };
}

// 差分だけを反映する: 現在の行を読み、増えた ID だけ insert、減った ID だけ delete。
// 残る行には触れない（sort_order もそのまま）。insert する行の sort_order は配列の添字。
async function syncSelection(
  supabase: SupabaseClient,
  table: string,
  column: string,
  siteId: string,
  wanted: string[],
): Promise<void> {
  const { data, error } = await supabase.from(table).select(column).eq('site_id', siteId);
  if (error) throw new Error(error.message);
  const current = new Set(((data ?? []) as unknown as Record<string, string>[]).map((r) => r[column]));
  const wantedSet = new Set(wanted);

  const toRemove = [...current].filter((id) => !wantedSet.has(id));
  const toAdd: Record<string, string | number>[] = [];
  const seen = new Set<string>();
  wanted.forEach((id, index) => {
    if (seen.has(id)) return;
    seen.add(id);
    if (!current.has(id)) toAdd.push({ site_id: siteId, [column]: id, sort_order: index });
  });

  if (toRemove.length > 0) {
    const { error: delError } = await supabase.from(table).delete().eq('site_id', siteId).in(column, toRemove);
    if (delError) throw new Error(delError.message);
  }
  if (toAdd.length > 0) {
    const { error: insError } = await supabase.from(table).insert(toAdd);
    if (insError) throw new Error(insError.message);
  }
}

export async function setSiteMasters(siteId: string, m: SiteMasters): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(siteMastersSchema, { siteId, ...m });
  const supabase = await createServerSupabase();
  await syncSelection(supabase, 'gn_site_workers', 'worker_id', v.siteId, v.workerIds);
  await syncSelection(supabase, 'gn_site_suppliers', 'supplier_id', v.siteId, v.supplierIds);
  await syncSelection(supabase, 'gn_site_vehicles', 'vehicle_id', v.siteId, v.vehicleIds);
  await syncSelection(supabase, 'gn_site_lease_items', 'lease_item_id', v.siteId, v.leaseItemIds);
  revalidateSite(v.siteId);
}

export async function upsertCarryover(siteId: string, c: Carryover): Promise<void> {
  await requireAdmin();
  const v = parseOrThrow(carryoverSchema, c);
  const site = parseOrThrow(memberSchema.shape.siteId, siteId);
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('gn_carryovers').upsert(
    { site_id: site, worker_id: v.workerId, man_days: v.manDays, labor_cost: v.laborCost, before_date: v.beforeDate },
    { onConflict: 'site_id,worker_id' },
  );
  if (error) throw new Error(error.message);
  revalidateSite(site);
}
