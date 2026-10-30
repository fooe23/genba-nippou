import Link from 'next/link';
import { yen } from '@/lib/calc/format';
import { requireAdmin } from '@/lib/db/profile';
import { listMySites } from '@/lib/db/sites';
import { EmptyText } from '@/components/masters/common';
import { STATUS_LABELS } from '@/components/sites/labels';
import { NewSiteButton } from '@/components/sites/NewSiteButton';

export const metadata = { title: '現場管理' };

const navBase = 'flex min-h-11 items-center rounded-lg px-4 text-base';
const navOff = `${navBase} border border-gray-400 font-medium dark:border-gray-600`;
const navOn = `${navBase} bg-blue-700 font-bold text-white`;

export default async function SitesPage({ searchParams }: PageProps<'/admin/sites'>) {
  await requireAdmin();
  const { status: rawStatus } = await searchParams;
  const status = rawStatus === 'done' ? 'done' : 'active';

  const sites = (await listMySites()).filter((s) => s.status === status);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <nav aria-label="管理メニュー" className="mb-4 flex gap-2">
        <Link href="/admin/sites" aria-current="page" className={navOn}>
          現場
        </Link>
        <Link href="/admin/masters" className={navOff}>
          マスター
        </Link>
      </nav>

      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold">現場管理</h1>
        <NewSiteButton />
      </div>

      <div role="group" aria-label="状態で絞り込み" className="mb-3 flex gap-2">
        {(['active', 'done'] as const).map((s) => (
          <Link
            key={s}
            href={s === 'active' ? '/admin/sites' : '/admin/sites?status=done'}
            aria-current={s === status ? 'page' : undefined}
            className={s === status ? navOn : navOff}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {sites.length === 0 ? (
        <EmptyText>{STATUS_LABELS[status]}の現場はありません。</EmptyText>
      ) : (
        <ul>
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/sites/${s.id}`}
                className="flex min-h-14 items-center justify-between gap-3 border-b border-gray-300 px-1 py-2 dark:border-gray-700"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">{s.name}</span>
                  <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                    {s.clientName ?? '客先未設定'}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium">
                  {s.contractAmount === null ? '' : yen(s.contractAmount)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
