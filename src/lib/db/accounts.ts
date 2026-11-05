import 'server-only';
import { getCurrentProfile, requireAdmin, toAccountType, type AccountType } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';

export interface Account {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  accountType: AccountType;
  companyName: string | null;
  /** 協力会社アカウントの所属する協力会社（取引先。gn_partner_accounts）。未設定・社員は null。 */
  supplierId: string | null;
}

interface AccountRow {
  id: string;
  name: string | null;
  email: string | null;
  is_admin: boolean | null;
  account_type: string | null;
  company_name: string | null;
}

/** アカウント一覧（管理者のみ・氏名順）。社員と協力会社の両方。 */
export async function listAccounts(): Promise<Account[]> {
  await requireAdmin();
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, is_admin, account_type, company_name')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  const { data: links, error: linkError } = await supabase.from('gn_partner_accounts').select('user_id, supplier_id');
  if (linkError) throw new Error(linkError.message);
  const supplierOf = new Map(((links ?? []) as { user_id: string; supplier_id: string }[]).map((r) => [r.user_id, r.supplier_id]));
  return ((data ?? []) as AccountRow[])
    .map((r) => ({
      id: r.id,
      name: r.name ?? '',
      email: r.email ?? '',
      isAdmin: r.is_admin === true,
      accountType: toAccountType(r.account_type),
      companyName: r.company_name ?? null,
      supplierId: supplierOf.get(r.id) ?? null,
    }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'ja'));
}

/**
 * ログイン中のユーザーが協力会社アカウントなら、その所属する協力会社（取引先 ID）。未設定・社員・未ログインは null。
 * RLS（gn_partner_accounts は本人と社員・管理者が読める）で本人の行を読む。
 */
export async function getMyPartnerSupplierId(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile || profile.accountType !== 'partner') return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_partner_accounts').select('supplier_id').eq('user_id', profile.id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { supplier_id: string } | null)?.supplier_id ?? null;
}
