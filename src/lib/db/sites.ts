import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { toAccountType, type AccountType } from '@/lib/db/profile';
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

type SiteOptionalKey = 'commonStart' | 'commonEnd' | 'commonBreakMin' | 'commonGapMin' | 'contractStatus' | 'estimatedAmount';
/** upsertSite に渡す入力（sites-actions.ts）。共通時間の既定・契約の状態・概算金額は省略すると変更しない（新規は DB の既定）。 */
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

interface SiteRow {
  id: string;
  name: string;
  client_name: string | null;
  project_name: string | null;
  project_no: string | null;
  overview: string | null;
  contract_amount: number | string | null;
  start_date: string | null;
  end_date: string | null;
  contract_type: string | null;
  status: string;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | string | null;
  common_gap_min: number | string | null;
  deleted_at: string | null;
  contract_status: string | null;
  estimated_amount: number | string | null;
}
interface ProfileRef { name: string | null; email: string | null; account_type: string | null; company_name: string | null; }
interface MemberRow { user_id: string; role: SiteRole; profiles: ProfileRef | ProfileRef[] | null; }
interface CarryoverRow { worker_id: string; man_days: number | string; labor_cost: number | string; before_date: string; }

const SITE_COLUMNS =
  'id, name, client_name, project_name, project_no, overview, contract_amount, start_date, end_date, contract_type, status, common_start, common_end, common_break_min, common_gap_min, deleted_at, contract_status, estimated_amount';

function toSite(r: SiteRow): Site {
  return {
    id: r.id,
    name: r.name,
    clientName: r.client_name,
    projectName: r.project_name,
    projectNo: r.project_no,
    overview: r.overview,
    contractAmount: r.contract_amount === null ? null : Number(r.contract_amount),
    startDate: r.start_date,
    endDate: r.end_date,
    contractType: r.contract_type === '元請け' || r.contract_type === '下請' || r.contract_type === '常用' ? r.contract_type : null,
    status: r.status === 'done' ? 'done' : 'active',
    commonStart: r.common_start || null,
    commonEnd: r.common_end || null,
    commonBreakMin: r.common_break_min === null || r.common_break_min === undefined ? null : Number(r.common_break_min),
    commonGapMin: r.common_gap_min === null || r.common_gap_min === undefined ? null : Number(r.common_gap_min),
    deletedAt: r.deleted_at ?? null,
    contractStatus: r.contract_status === 'tentative' ? 'tentative' : 'fixed',
    estimatedAmount: r.estimated_amount === null || r.estimated_amount === undefined ? null : Number(r.estimated_amount),
  };
}

/**
 * 自分が見られる現場（RLS により、社員・管理者は全件、協力会社は割り当て現場だけ）。進行中を先に、その中は名前順。
 * 削除済みの現場は含めない（管理者には RLS で返ってくるため、ここで除く）。
 */
export async function listMySites(): Promise<Site[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_sites').select(SITE_COLUMNS).is('deleted_at', null);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SiteRow[]).map(toSite).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
}

/** 削除済みの現場（管理画面の「削除済み」一覧用）。削除日時の新しい順。管理者以外には RLS で何も返らない。 */
export async function listDeletedSites(): Promise<Site[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_sites')
    .select(SITE_COLUMNS)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SiteRow[]).map(toSite);
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
  const { data, error } = await supabase.from('gn_sites').select(SITE_COLUMNS).eq('id', siteId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toSite(data as SiteRow) : null;
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
