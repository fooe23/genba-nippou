import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentProfile, isEmployeeOrAdmin, toAccountType, type AccountType } from '@/lib/db/profile';
import type { SiteMoneyFields } from '@/lib/sites/display';
import { isMissingFunctionError, mergeSiteMoney, siteMoneyMap, type SiteMoneyRow } from '@/lib/sites/money';
import { isMissingColumnError, siteColumns, siteFromRow, type SiteRow } from '@/lib/sites/site-row';
import type { SiteRole } from '@/lib/types';

// 現場まわりの読み取り（RLS 前提）。書き込みは sites-actions.ts（Server Actions）。

export interface Site {
  id: string;
  name: string;
  clientName: string | null;
  projectName: string | null;
  projectNo: string | null;
  overview: string | null;
  contractAmount: number | null;
  startDate: string | null;
  endDate: string | null;
  contractType: '元請け' | '下請' | '常用' | null;
  status: 'active' | 'done';
  /** 新しい日報の共通時間の既定（null なら全社の設定 gn_settings の既定を使う）。 */
  commonStart: string | null;
  commonEnd: string | null;
  commonBreakMin: number | null;
  commonGapMin: number | null;
  /** 削除（アーカイブ）した日時。null なら削除されていない。管理者には削除済みも返るので、呼び出し側で判断する。 */
  deletedAt: string | null;
  /** 契約金額が確定しているか（fixed）、未確定（tentative。概算・見積提示額 estimatedAmount を使う）か。 */
  contractStatus: 'fixed' | 'tentative';
  /** 概算・見積提示額（契約金額が未確定のときに使う）。 */
  estimatedAmount: number | null;
  /** 常用単価の既定（客先請求・円／人工）。件を常用で精算するときの単価の初期値。未設定は null。 */
  defaultDailyRate: number | null;
  /**
   * 見積提出が必須のお客様（2026-11-20）。オンの現場で新しく作る件は、見積書が最初から「要（先に出す）」（やり直しは不要）。
   * null は DB に列が無い（update_2026-11-20_issue_estimate.sql の前。設定も見積書の欄も出さない）。
   */
  estimateRequired: boolean | null;
}
export interface SiteMember {
  userId: string;
  name: string;
  email: string;
  role: SiteRole;
  accountType: AccountType;
  companyName: string | null;
}
export interface ProfileListItem {
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
  companyName: string | null;
}
export interface SiteMasters { workerIds: string[]; supplierIds: string[]; vehicleIds: string[]; leaseItemIds: string[]; }
export interface Carryover { workerId: string; manDays: number; laborCost: number; beforeDate: string; }

type SiteOptionalKey =
  | 'commonStart'
  | 'commonEnd'
  | 'commonBreakMin'
  | 'commonGapMin'
  | 'contractStatus'
  | 'estimatedAmount'
  | 'defaultDailyRate'
  | 'estimateRequired';
/** upsertSite に渡す入力（sites-actions.ts）。共通時間の既定・契約の状態・概算金額・常用単価の既定・見積提出が必須は省略すると変更しない（新規は DB の既定）。 */
export type SiteInput = Omit<Site, 'id' | 'status' | 'deletedAt' | SiteOptionalKey> &
  Partial<Pick<Site, SiteOptionalKey>> & { id?: string; status?: Site['status'] };

/** 現場の削除・復元の記録（gn_site_audit_log。管理者だけ読める）。 */
export interface SiteAuditEntry {
  id: number;
  siteId: string | null;
  siteName: string;
  action: 'archive' | 'restore';
  actorName: string;
  actorEmail: string;
  reason: string | null;
  createdAt: string;
}

interface ProfileRef { name: string | null; email: string | null; account_type: string | null; company_name: string | null; }
interface MemberRow { user_id: string; role: SiteRole; profiles: ProfileRef | ProfileRef[] | null; }
interface CarryoverRow { worker_id: string; man_days: number | string; labor_cost: number | string; before_date: string; }

// gn_sites は必ず列を名指しで読む（siteColumns。お金の列は入れない）。お金の列は社員・管理者のときだけ gn_site_money で
// 読んで重ねる（withSiteMoney）。見積提出が必須（estimate_required。2026-11-20）の列が無い DB では、外して読み直す。
async function selectSites<T>(
  run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let res = await run(siteColumns(true));
  if (res.error && isMissingColumnError(res.error)) res = await run(siteColumns(false));
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
const SITE_MONEY_COLUMNS = 'id, contract_amount, estimated_amount, default_daily_rate';
/** SQL の前の読み直し（.in の id の数。URL が長くなりすぎないように分ける）。 */
const MONEY_FALLBACK_CHUNK = 100;

/**
 * 現場のお金の列（社員・管理者だけが呼ぶ）。gn_site_money（SECURITY DEFINER。社員・管理者で、その現場を見られるときだけ行が返る）で読む。
 * 関数がまだ無い（update_2026-11-16_site_money.sql の前）ときだけ、今まで通り表から直接読む（その間は列の SELECT が残っている）。
 */
async function loadSiteMoney(supabase: SupabaseClient, ids: string[]): Promise<Map<string, SiteMoneyFields>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('gn_site_money', { p_site_ids: ids });
  if (!error) return siteMoneyMap(data as SiteMoneyRow[] | null);
  if (!isMissingFunctionError(error)) throw new Error(error.message);
  const rows: SiteMoneyRow[] = [];
  for (let i = 0; i < ids.length; i += MONEY_FALLBACK_CHUNK) {
    const part = ids.slice(i, i + MONEY_FALLBACK_CHUNK);
    const res = await supabase.from('gn_sites').select(SITE_MONEY_COLUMNS).in('id', part);
    if (res.error) throw new Error(res.error.message);
    rows.push(...((res.data ?? []) as SiteMoneyRow[]));
  }
  return siteMoneyMap(rows);
}

/**
 * 行を Site にして、お金の項目を重ねる。お金は社員・管理者のときだけ読む。協力会社（とログインしていない人）は
 * 読みに行かず 3 つとも null（画面・client component・API の応答に請負金額が載らない）。
 */
async function withSiteMoney(supabase: SupabaseClient, rows: SiteRow[]): Promise<Site[]> {
  if (rows.length === 0) return [];
  const profile = await getCurrentProfile();
  const money = profile !== null && isEmployeeOrAdmin(profile) ? await loadSiteMoney(supabase, rows.map((r) => r.id)) : new Map();
  return rows.map((r) => mergeSiteMoney(siteFromRow(r), money));
}

/**
 * 自分が見られる現場（RLS により、社員・管理者は全件、協力会社は割り当て現場だけ）。進行中を先に、その中は名前順。
 * 削除済みの現場は含めない（管理者には RLS で返ってくるため、ここで除く）。
 */
export async function listMySites(): Promise<Site[]> {
  const supabase = await createServerSupabase();
  const data = await selectSites((cols) => supabase.from('gn_sites').select(cols).is('deleted_at', null));
  return (await withSiteMoney(supabase, (data ?? []) as unknown as SiteRow[])).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
}

/** 削除済みの現場（管理画面の「削除済み」一覧用）。削除日時の新しい順。管理者以外には RLS で何も返らない。 */
export async function listDeletedSites(): Promise<Site[]> {
  const supabase = await createServerSupabase();
  const data = await selectSites((cols) =>
    supabase.from('gn_sites').select(cols).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
  );
  return withSiteMoney(supabase, (data ?? []) as unknown as SiteRow[]);
}

interface AuditRow {
  id: number | string;
  site_id: string | null;
  site_name: string | null;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  reason: string | null;
  created_at: string;
}

/** 現場の削除・復元の記録。新しい順に limit 件まで。gn_site_audit_log は管理者だけ読める。 */
export async function listSiteAuditLog(limit = 200): Promise<SiteAuditEntry[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_site_audit_log')
    .select('id, site_id, site_name, action, actor_name, actor_email, reason, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AuditRow[]).map((r) => ({
    id: Number(r.id),
    siteId: r.site_id,
    siteName: r.site_name ?? '',
    action: r.action === 'restore' ? 'restore' : 'archive',
    actorName: r.actor_name ?? '',
    actorEmail: r.actor_email ?? '',
    reason: r.reason ?? null,
    createdAt: r.created_at,
  }));
}

/** 自分が担当者として割り当てられている現場の id（gn_site_members）。社員・管理者は割り当てのない現場も見られるので、担当かどうかの判定に使う。 */
export async function listMyMemberSiteIds(userId: string): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_site_members').select('site_id').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { site_id: string }[]).map((r) => r.site_id);
}

export async function getSite(siteId: string): Promise<Site | null> {
  const supabase = await createServerSupabase();
  const data = await selectSites((cols) => supabase.from('gn_sites').select(cols).eq('id', siteId).maybeSingle());
  if (!data) return null;
  const [site] = await withSiteMoney(supabase, [data as unknown as SiteRow]);
  return site ?? null;
}

export async function listSiteMembers(siteId: string): Promise<SiteMember[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_site_members')
    .select('user_id, role, profiles(name, email, account_type, company_name)')
    .eq('site_id', siteId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MemberRow[])
    .map((r) => {
      const p = Array.isArray(r.profiles) ? (r.profiles[0] ?? null) : r.profiles;
      return {
        userId: r.user_id,
        name: p?.name ?? '',
        email: p?.email ?? '',
        role: r.role,
        accountType: toAccountType(p?.account_type),
        companyName: p?.company_name ?? null,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'ja'));
}

async function selectedIds(table: string, column: string, siteId: string): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .eq('site_id', siteId)
    .order('sort_order', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[column]);
}

/** この現場で使うマスターの選択状態。 */
export async function getSiteMasters(siteId: string): Promise<SiteMasters> {
  const [workerIds, supplierIds, vehicleIds, leaseItemIds] = await Promise.all([
    selectedIds('gn_site_workers', 'worker_id', siteId),
    selectedIds('gn_site_suppliers', 'supplier_id', siteId),
    selectedIds('gn_site_vehicles', 'vehicle_id', siteId),
    selectedIds('gn_site_lease_items', 'lease_item_id', siteId),
  ]);
  return { workerIds, supplierIds, vehicleIds, leaseItemIds };
}

/** 現場の協力会社（gn_site_partners）。amount は請負金額（任意）。supplierName は取引先の名前（読めなければ空）。 */
export interface SitePartner { id: string; siteId: string; supplierId: string; supplierName: string; amount: number | null; note: string | null; }

interface SitePartnerRow {
  id: string;
  site_id: string;
  supplier_id: string;
  amount: number | string | null;
  note: string | null;
  gn_suppliers: { name: string | null } | { name: string | null }[] | null;
}

/**
 * 現場の協力会社の一覧（取引先の名前順）。RLS で社員・管理者だけが読める（協力会社のアカウントでは空になる）。
 * 協力会社の作業員の現場登録は getSiteMasters の workerIds（gn_site_workers）に自社の作業員の選択と一緒に入っている。
 */
export async function listSitePartners(siteId: string): Promise<SitePartner[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_site_partners')
    .select('id, site_id, supplier_id, amount, note, gn_suppliers(name)')
    .eq('site_id', siteId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SitePartnerRow[])
    .map((r) => {
      const supplier = Array.isArray(r.gn_suppliers) ? r.gn_suppliers[0] : r.gn_suppliers;
      return {
        id: r.id,
        siteId: r.site_id,
        supplierId: r.supplier_id,
        supplierName: supplier?.name ?? '',
        amount: r.amount === null ? null : Number(r.amount),
        note: r.note,
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ja'));
}

export async function listCarryovers(siteId: string): Promise<Carryover[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_carryovers')
    .select('worker_id, man_days, labor_cost, before_date')
    .eq('site_id', siteId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CarryoverRow[]).map((r) => ({
    workerId: r.worker_id,
    manDays: Number(r.man_days),
    laborCost: Number(r.labor_cost),
    beforeDate: r.before_date,
  }));
}

/** 社員一覧（協力会社を含む）。profiles の RLS（本人または管理者のみ閲覧可）により、実質は管理者専用。 */
export async function listProfiles(): Promise<ProfileListItem[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('profiles').select('id, name, email, account_type, company_name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; name: string | null; email: string | null; account_type: string | null; company_name: string | null }[])
    .map((r) => ({
      id: r.id,
      name: r.name ?? '',
      email: r.email ?? '',
      accountType: toAccountType(r.account_type),
      companyName: r.company_name ?? null,
    }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'ja'));
}
