import 'server-only';
import { requireAdmin, toAccountType, type AccountType } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';

export interface Account {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  accountType: AccountType;
  companyName: string | null;
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
  return ((data ?? []) as AccountRow[])
    .map((r) => ({
      id: r.id,
      name: r.name ?? '',
      email: r.email ?? '',
      isAdmin: r.is_admin === true,
      accountType: toAccountType(r.account_type),
      companyName: r.company_name ?? null,
    }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'ja'));
}
