import { APP_NAME } from '@/lib/constants';
import { requireProfile } from '@/lib/db/profile';
import { getSubmittedCount } from '@/lib/db/reports';
import { logout } from './actions';
import { TabBar, type TabItem } from './tab-bar';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();

  const submittedCount = await getSubmittedCount();

  const tabs: TabItem[] = [
    { href: '/', label: 'ホーム' },
    { href: '/approvals', label: '承認' },
    { href: '/guide', label: 'ガイド' },
    ...(profile.isAdmin ? [{ href: '/admin/sites', label: '管理' }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-2 border-b border-gray-300 px-4 py-2 dark:border-gray-700">
        <span className="shrink-0 font-bold">{APP_NAME}</span>
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm">{profile.name || profile.email}</span>
          <form action={logout}>
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-blue-700 dark:text-blue-400"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <TabBar tabs={tabs} badges={{ '/approvals': submittedCount }} />
    </div>
  );
}
