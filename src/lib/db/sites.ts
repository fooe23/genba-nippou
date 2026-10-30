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

/** upsertSite に渡す入力（sites-actions.ts）。 */
export type SiteInput = Omit<Site, 'id' | 'status'> & { id?: string; status?: Site['status'] };

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
}
interface ProfileRef { name: string | null; email: string | null; account_type: string | null; company_name: string | null; }
interface MemberRow { user_id: string; role: SiteRole; profiles: ProfileRef | ProfileRef[] | null; }
interface CarryoverRow { worker_id: string; man_days: number | string; labor_cost: number | string; before_date: string; }

const SITE_COLUMNS =
  'id, name, client_name, project_name, project_no, overview, contract_amount, start_date, end_date, contract_type, status';

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
  };
}

/** 自分が見られる現場（RLS により担当の現場だけ、管理者は全件）。進行中を先に、その中は名前順。 */
export async function listMySites(): Promise<Site[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_sites').select(SITE_COLUMNS);
  if (error) throw new Error(error.message);
  return ((data ?? []) as SiteRow[]).map(toSite).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.name.localeCompare(b.name, 'ja');
  });
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
