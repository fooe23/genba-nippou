'use server';

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseOrThrow } from '@/lib/db/masters-schemas';
import { isEmployeeOrAdmin, requireAdmin, requireProfile, toAccountType } from '@/lib/db/profile';
import type { Carryover, SiteInput, SiteMasters } from '@/lib/db/sites';
import {
  archiveSiteSchema,
  carryoverSchema,
  copySitePartnersMessage,
  copySitePartnersSchema,
  memberSchema,
  partnerRoleError,
  planSitePartnerCopy,
  SITE_PARTNERS_CLOSED_MESSAGE,
  SITE_PARTNERS_FORBIDDEN_MESSAGE,
  siteInputSchema,
  siteMastersSchema,
  sitePartnerAddSchema,
  sitePartnerUpdateSchema,
  sitePartnerWorkersSchema,
  siteStatusSchema,
  type SitePartnerAddInput,
  type SitePartnerUpdateInput,
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
    // 契約の状態・概算金額・常用単価の既定。省略された項目は変更しない（新規は DB の既定）。
    ...(v.contractStatus !== undefined ? { contract_status: v.contractStatus } : {}),
    ...(v.estimatedAmount !== undefined ? { estimated_amount: v.estimatedAmount } : {}),
    ...(v.defaultDailyRate !== undefined ? { default_daily_rate: v.defaultDailyRate } : {}),
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
// inScope を渡すと、その ID の行だけを対象にする（範囲外の現在の行は残し、範囲外の wanted は無視する）。
async function syncSelection(
  supabase: SupabaseClient,
  table: string,
  column: string,
  siteId: string,
  wantedAll: string[],
  inScope: (id: string) => boolean = () => true,
): Promise<void> {
  const { data, error } = await supabase.from(table).select(column).eq('site_id', siteId);
  if (error) throw new Error(error.message);
  const current = new Set(((data ?? []) as unknown as Record<string, string>[]).map((r) => r[column]).filter(inScope));
  const wanted = wantedAll.filter(inScope);
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
  // 作業員は自社の作業員の選択だけを反映する。協力会社の作業員の登録（社員も変えられる）はここでは触れない
  // （画面から協力会社の作業員の ID が届いても無視する。登録は setSitePartnerWorkers で行う）。
  const partnerIds = await partnerWorkerIds(supabase);
  await syncSelection(supabase, 'gn_site_workers', 'worker_id', v.siteId, v.workerIds, (id) => !partnerIds.has(id));
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

// ─── 現場の協力会社（gn_site_partners）と協力会社の作業員の現場登録（gn_site_workers） ───
// 社員・管理者が使う（協力会社は不可）。完了・削除済みの現場は変えられない（RLS でも止める）。
// いずれも { ok, error } を返す（throw しない）。協力会社の作業員＝gn_workers.affiliation = 'partner'。

export type SitePartnerResult = { ok: true } | { ok: false; error: string };
export type AddSitePartnerResult = { ok: true; id: string } | { ok: false; error: string };
export type CopySitePartnersResult =
  | { ok: true; partners: number; workers: number; message: string }
  | { ok: false; error: string };

const SITE_PARTNER_FAILED = '協力会社の保存に失敗しました。もう一度お試しください。';

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? '入力内容が正しくありません';
}

function revalidateSitePartners(siteId: string): void {
  revalidateSite(siteId);
  revalidatePath(`/sites/${siteId}`);
  revalidatePath('/sites/[siteId]/reports/[date]', 'page');
}

/** 社員・管理者でなければ文言を返す。 */
async function staffError(): Promise<string | null> {
  const profile = await requireProfile();
  return isEmployeeOrAdmin(profile) ? null : SITE_PARTNERS_FORBIDDEN_MESSAGE;
}

/** 現場が進行中でなければ（完了・削除済み・見つからない）文言を返す。 */
async function closedSiteError(supabase: SupabaseClient, siteId: string): Promise<string | null> {
  const { data, error } = await supabase.from('gn_sites').select('status, deleted_at').eq('id', siteId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return SITE_NOT_FOUND;
  const row = data as { status: string; deleted_at: string | null };
  return row.status !== 'active' || row.deleted_at !== null ? SITE_PARTNERS_CLOSED_MESSAGE : null;
}

/** 協力会社の作業員の ID（supplierId を渡すとその会社の作業員だけ）。 */
async function partnerWorkerIds(supabase: SupabaseClient, supplierId?: string): Promise<Set<string>> {
  let query = supabase.from('gn_workers').select('id').eq('affiliation', 'partner');
  if (supplierId) query = query.eq('supplier_id', supplierId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

/** 現場に協力会社を追加する（請負金額・メモは任意）。すでにあれば請負金額・メモを上書きする。 */
export async function addSitePartner(input: SitePartnerAddInput): Promise<AddSitePartnerResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const parsed = sitePartnerAddSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const closed = await closedSiteError(supabase, v.siteId);
    if (closed) return { ok: false, error: closed };
    const { data, error } = await supabase
      .from('gn_site_partners')
      .upsert({ site_id: v.siteId, supplier_id: v.supplierId, amount: v.amount, note: v.note }, { onConflict: 'site_id,supplier_id' })
      .select('id')
      .single();
    if (error) {
      console.error('[addSitePartner]', error.message);
      return { ok: false, error: SITE_PARTNER_FAILED };
    }
    revalidateSitePartners(v.siteId);
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    console.error('[addSitePartner]', e);
    return { ok: false, error: SITE_PARTNER_FAILED };
  }
}

/** 現場の協力会社の請負金額・メモを直す。 */
export async function updateSitePartner(input: SitePartnerUpdateInput): Promise<SitePartnerResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const parsed = sitePartnerUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const row = await readSitePartner(supabase, v.id);
    if (!row) return { ok: false, error: '協力会社が見つかりません' };
    const closed = await closedSiteError(supabase, row.site_id);
    if (closed) return { ok: false, error: closed };
    const { data, error } = await supabase
      .from('gn_site_partners')
      .update({ amount: v.amount, note: v.note })
      .eq('id', v.id)
      .select('id');
    if (error) {
      console.error('[updateSitePartner]', error.message);
      return { ok: false, error: SITE_PARTNER_FAILED };
    }
    if ((data ?? []).length === 0) return { ok: false, error: '協力会社が見つかりません' };
    revalidateSitePartners(row.site_id);
    return { ok: true };
  } catch (e) {
    console.error('[updateSitePartner]', e);
    return { ok: false, error: SITE_PARTNER_FAILED };
  }
}

async function readSitePartner(
  supabase: SupabaseClient,
  id: string,
): Promise<{ site_id: string; supplier_id: string } | null> {
  const { data, error } = await supabase.from('gn_site_partners').select('site_id, supplier_id').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { site_id: string; supplier_id: string } | null) ?? null;
}

/**
 * 現場から協力会社を外す。その会社の協力会社の作業員の現場登録も一緒に外す
 * （過去の日報は行の所属の写しを使うので変わらない）。
 */
export async function removeSitePartner(id: string): Promise<SitePartnerResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const parsed = sitePartnerUpdateSchema.shape.id.safeParse(id);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  try {
    const supabase = await createServerSupabase();
    const row = await readSitePartner(supabase, parsed.data);
    if (!row) return { ok: false, error: '協力会社が見つかりません' };
    const closed = await closedSiteError(supabase, row.site_id);
    if (closed) return { ok: false, error: closed };
    const ids = [...(await partnerWorkerIds(supabase, row.supplier_id))];
    if (ids.length > 0) {
      const { error: wError } = await supabase.from('gn_site_workers').delete().eq('site_id', row.site_id).in('worker_id', ids);
      if (wError) {
        console.error('[removeSitePartner:workers]', wError.message);
        return { ok: false, error: SITE_PARTNER_FAILED };
      }
    }
    const { error } = await supabase.from('gn_site_partners').delete().eq('id', parsed.data);
    if (error) {
      console.error('[removeSitePartner]', error.message);
      return { ok: false, error: SITE_PARTNER_FAILED };
    }
    revalidateSitePartners(row.site_id);
    return { ok: true };
  } catch (e) {
    console.error('[removeSitePartner]', e);
    return { ok: false, error: SITE_PARTNER_FAILED };
  }
}

/**
 * 協力会社 1 社について、この現場に登録する作業員をそろえる（その会社の協力会社の作業員の登録だけを増減し、
 * 自社の作業員の選択と他社の登録には触れない）。作業員を 1 人以上登録するときは、現場の協力会社の行も無ければ作る。
 */
export async function setSitePartnerWorkers(siteId: string, supplierId: string, workerIds: string[]): Promise<SitePartnerResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const parsed = sitePartnerWorkersSchema.safeParse({ siteId, supplierId, workerIds });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const closed = await closedSiteError(supabase, v.siteId);
    if (closed) return { ok: false, error: closed };
    const companyWorkers = await partnerWorkerIds(supabase, v.supplierId);
    if (v.workerIds.some((id) => !companyWorkers.has(id))) {
      return { ok: false, error: 'この協力会社の作業員ではない作業員が含まれています' };
    }
    if (v.workerIds.length > 0) {
      // 請負金額・メモは変えない（無いときだけ作る）。
      const { error } = await supabase
        .from('gn_site_partners')
        .upsert({ site_id: v.siteId, supplier_id: v.supplierId }, { onConflict: 'site_id,supplier_id', ignoreDuplicates: true });
      if (error) {
        console.error('[setSitePartnerWorkers:partner]', error.message);
        return { ok: false, error: SITE_PARTNER_FAILED };
      }
    }
    await syncSelection(supabase, 'gn_site_workers', 'worker_id', v.siteId, v.workerIds, (id) => companyWorkers.has(id));
    revalidateSitePartners(v.siteId);
    return { ok: true };
  } catch (e) {
    console.error('[setSitePartnerWorkers]', e);
    return { ok: false, error: SITE_PARTNER_FAILED };
  }
}

/**
 * 別の現場（fromSiteId）から、協力会社（請負金額・メモは写さない）と協力会社の作業員の登録を写す。
 * 写し先（toSiteId）にすでにあるもの・無効な作業員は飛ばす。写し先が完了・削除済みなら写さない。
 */
export async function copySitePartners(fromSiteId: string, toSiteId: string): Promise<CopySitePartnersResult> {
  const forbidden = await staffError();
  if (forbidden) return { ok: false, error: forbidden };
  const parsed = copySitePartnersSchema.safeParse({ fromSiteId, toSiteId });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const closed = await closedSiteError(supabase, v.toSiteId);
    if (closed) return { ok: false, error: closed };

    const [srcPartners, srcWorkers, dstPartners, dstWorkers] = await Promise.all([
      supabase.from('gn_site_partners').select('supplier_id').eq('site_id', v.fromSiteId).order('created_at', { ascending: true }),
      supabase
        .from('gn_site_workers')
        .select('worker_id, gn_workers!inner(affiliation, supplier_id, active)')
        .eq('site_id', v.fromSiteId)
        .eq('gn_workers.affiliation', 'partner')
        .order('sort_order', { ascending: true, nullsFirst: false }),
      supabase.from('gn_site_partners').select('supplier_id').eq('site_id', v.toSiteId),
      supabase.from('gn_site_workers').select('worker_id, sort_order').eq('site_id', v.toSiteId),
    ]);
    for (const r of [srcPartners, srcWorkers, dstPartners, dstWorkers]) if (r.error) throw new Error(r.error.message);

    type JoinedWorker = { affiliation: string; supplier_id: string | null; active: boolean | null };
    const sourceWorkers = ((srcWorkers.data ?? []) as unknown as { worker_id: string; gn_workers: JoinedWorker | JoinedWorker[] | null }[])
      .map((r) => ({ id: r.worker_id, w: Array.isArray(r.gn_workers) ? r.gn_workers[0] : r.gn_workers }))
      .filter((r) => r.w?.affiliation === 'partner')
      .map((r) => ({ id: r.id, supplierId: r.w?.supplier_id ?? null, active: r.w?.active !== false }));
    const targetWorkers = (dstWorkers.data ?? []) as { worker_id: string; sort_order: number | null }[];
    const plan = planSitePartnerCopy(
      {
        supplierIds: ((srcPartners.data ?? []) as { supplier_id: string }[]).map((r) => r.supplier_id),
        workers: sourceWorkers,
      },
      {
        supplierIds: ((dstPartners.data ?? []) as { supplier_id: string }[]).map((r) => r.supplier_id),
        workerIds: targetWorkers.map((r) => r.worker_id),
      },
    );

    if (plan.supplierIds.length > 0) {
      const { error } = await supabase
        .from('gn_site_partners')
        .upsert(
          plan.supplierIds.map((id) => ({ site_id: v.toSiteId, supplier_id: id })),
          { onConflict: 'site_id,supplier_id', ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    }
    if (plan.workerIds.length > 0) {
      const start = targetWorkers.reduce((m, r) => Math.max(m, (r.sort_order ?? 0) + 1), 0);
      const { error } = await supabase
        .from('gn_site_workers')
        .insert(plan.workerIds.map((id, i) => ({ site_id: v.toSiteId, worker_id: id, sort_order: start + i })));
      if (error) throw new Error(error.message);
    }
    revalidateSitePartners(v.toSiteId);
    const counts = { partners: plan.supplierIds.length, workers: plan.workerIds.length };
    return { ok: true, ...counts, message: copySitePartnersMessage(counts) };
  } catch (e) {
    console.error('[copySitePartners]', e);
    return { ok: false, error: '協力会社の写しに失敗しました。もう一度お試しください。' };
  }
}
