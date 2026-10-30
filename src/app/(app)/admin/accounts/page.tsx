import { listAccounts } from '@/lib/db/accounts';
import { requireAdmin } from '@/lib/db/profile';
import { AccountsPanel } from '@/components/accounts/AccountsPanel';
import { AdminNav } from '@/components/accounts/AdminNav';

export const metadata = { title: 'アカウント管理' };

export default async function AccountsPage() {
  await requireAdmin();
  const accounts = await listAccounts();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <AdminNav current="accounts" />
      <h1 className="mb-4 text-xl font-bold">アカウント管理</h1>
      <AccountsPanel accounts={accounts} />
    </main>
  );
}
