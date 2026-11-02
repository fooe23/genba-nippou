'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseOrThrow } from '@/lib/db/masters-schemas';
import { requireAdmin, toAccountType } from '@/lib/db/profile';
import type { Carryover, SiteInput, SiteMasters } from '@/lib/db/sites';
import {
  archiveSiteSchema,
  carryoverSchema,
  memberSchema,
  partnerRoleError,
  siteInputSchema,
  siteMastersSchema,
  siteStatusSchema,
} from '@/lib/db/sites-schemas';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SiteRole } from '@/lib/types';

function revalidateSite(siteId: string): void {
  revalidatePath('/admin/sites');
  revalidatePath(`/admin/sites/${siteId}`);
}

export type ActionResult = { ok: true } | { ok: false; error: string };

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
    // 共通時間の既定。省略（undefined）された項目は変更しない。
    ...(v.commonStart !== undefined ? { common_start: v.commonStart } : {}),
    ...(v.commonEnd !== undefined ? { common_end: v.commonEnd } : {}),
    ...(v.commonBreakMin !== undefined ? { common_break_min: v.commonBreakMin } : {}),
    ...(v.commonGapMin !== undefined ? { common_gap_min: v.commonGapMin } : {}),
  };
  // 削除済みの現場は編集しない（復元してから編集する）。
  const query = v.id
    ? supabase
        .from('gn_sites')
        .update(v.status ? { ...row, status: v.status } : row)
        .eq('id', v.id)
        .is('deleted_at', null)
    : supabase.from('gn_sites').insert({ ...row, status: v.status ?? 'active' });
  const { data, error } = await query.select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  revalidateSite(id);
  // 状態（進行中／完了）が変わるとホームと完了現場タブの一覧も変わる。
  revalidatePath('/');
  revalidatePath('/done');
  revalidatePath(`/sites/${id}`);
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

// ─── 現場の削除（アーカイブ）・復元・状態の切り替え ───
// いずれも { ok, error } を返す（throw しない）。削除・復元は DB の関数（gn_archive_site / gn_restore_site）が
// 管理者かどうかを最終判定し、実行者と日時・理由を gn_site_audit_log に記録する。

const ARCHIVE_FAILED = '削除に失敗しました。もう一度お試しください。';
const RESTORE_FAILED = '復元に失敗しました。もう一度お試しください。';
const SITE_NOT_FOUND = '対象の現場が見つかりません';

function siteRpcErrorMessage(dbMessage: string | null | undefined, notFound: string, fallback: string): string {
  const m = dbMessage ?? '';
  if (m.includes('not_admin')) return '管理者権限が必要です';
  if (m.includes('site_not_found')) return notFound;
  return fallback;
}

function revalidateArchive(siteId: string): void {
  revalidatePath('/');
  revalidatePath('/done');
  revalidatePath('/approvals');
  revalidatePath('/admin/sites');
  revalidatePath(`/admin/sites/${siteId}`);
  revalidatePath('/admin/sites/log');
}

/**
 * パスワードの照合だけを行う。Cookie のセッションには触れないよう、保存しない使い捨てのクライアントで
 * サインインし、すぐにサインアウトする（サインアウトの失敗は無視）。
 */
async function verifyPassword(email: string, password: string): Promise<string | null> {
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return null;
  try {
    await verifier.auth.signOut({ scope: 'local' });
  } catch {
    // 照合用のセッションは保存していないので、失敗しても実害はない。
  }
  return data.user.id;
}

/**
 * 現場を削除する（deleted_at をセットするだけで、データは残り、復元できる）。
 * 実行前に、ログイン中の管理者本人のメールアドレスとパスワードを再入力させて照合する。
 */
export async function archiveSite(input: {
  siteId: string;
  email: string;
  password: string;
  reason: string | null;
}): Promise<ActionResult> {
  const profile = await requireAdmin();
  const parsed = archiveSiteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;

  if (v.email.toLowerCase() !== profile.email.trim().toLowerCase()) {
    return { ok: false, error: 'ログイン中のアカウントのメールアドレスを入力してください' };
  }

  try {
    // 照合に失敗した理由（パスワード違い・回数制限など）は区別しない。
    // 照合で得たユーザーがログイン中の管理者本人（auth のユーザー id）でなければ、別アカウントの資格情報なので拒否する。
    const verifiedUserId = await verifyPassword(v.email, v.password);
    if (verifiedUserId === null || verifiedUserId !== profile.id) return { ok: false, error: 'パスワードが違います' };
  } catch (e) {
    console.error('[archiveSite:verify]', e);
    return { ok: false, error: 'パスワードが違います' };
  }

  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc('gn_archive_site', { p_site: v.siteId, p_reason: v.reason });
    if (error) {
      console.error('[archiveSite]', error.message);
      return {
        ok: false,
        error: siteRpcErrorMessage(error.message, '対象の現場が見つかりません（すでに削除済みの可能性があります）', ARCHIVE_FAILED),
      };
    }
  } catch (e) {
    console.error('[archiveSite]', e);
    return { ok: false, error: ARCHIVE_FAILED };
  }
  revalidateArchive(v.siteId);
  return { ok: true };
}

/** 削除済みの現場を元に戻す（管理者のみ。再認証は不要）。 */
export async function restoreSite(siteId: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = memberSchema.shape.siteId.safeParse(siteId);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };

  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.rpc('gn_restore_site', { p_site: parsed.data });
    if (error) {
      console.error('[restoreSite]', error.message);
      return { ok: false, error: siteRpcErrorMessage(error.message, '対象の現場が見つかりません（すでに復元済みの可能性があります）', RESTORE_FAILED) };
    }
  } catch (e) {
    console.error('[restoreSite]', e);
    return { ok: false, error: RESTORE_FAILED };
  }
  revalidateArchive(parsed.data);
  return { ok: true };
}

/** 現場を完了にする／進行中に戻す（現場詳細の管理者向けボタン）。削除済みの現場は対象外。 */
export async function setSiteStatus(siteId: string, status: 'active' | 'done'): Promise<ActionResult> {
  await requireAdmin();
  const parsed = siteStatusSchema.safeParse({ siteId, status });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_sites')
      .update({ status: v.status })
      .eq('id', v.siteId)
      .is('deleted_at', null)
      .select('id');
    if (error) {
      console.error('[setSiteStatus]', error.message);
      return { ok: false, error: '状態の変更に失敗しました。もう一度お試しください。' };
    }
    if (!data || data.length === 0) return { ok: false, error: SITE_NOT_FOUND };
  } catch (e) {
    console.error('[setSiteStatus]', e);
    return { ok: false, error: '状態の変更に失敗しました。もう一度お試しください。' };
  }
  revalidatePath('/');
  revalidatePath('/done');
  revalidatePath(`/sites/${v.siteId}`);
  revalidatePath('/admin/sites');
  revalidatePath(`/admin/sites/${v.siteId}`);
  return { ok: true };
}
