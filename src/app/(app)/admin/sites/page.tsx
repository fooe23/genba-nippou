import Link from 'next/link';
import { jpDateTime } from '@/lib/calc/format';
import { requireAdmin } from '@/lib/db/profile';
import { listDeletedSites, listMySites } from '@/lib/db/sites';
import { countEstimatePendingBySite, issueEstimateColumnsReady } from '@/lib/db/reports';
import { EstimatePendingCount } from '@/components/site/EstimatePendingCount';
import { contractAmountText, siteSubline, siteTitle } from '@/lib/sites/display';
import { AdminNav } from '@/components/accounts/AdminNav';
import { EmptyText } from '@/components/masters/common';
import { LIST_FILTER_LABELS, type ListFilter } from '@/components/sites/labels';
import { NewSiteButton } from '@/components/sites/NewSiteButton';
import { Chevron, linkTitleClass, rowLinkClass } from '@/components/ui/tappable';
import { RestoreSiteButton } from '@/components/sites/RestoreSiteButton';

export const metadata = { title: '現場管理' };

const navBase = 'flex min-h-11 items-center rounded-lg px-4 text-base';
const navOff = `${navBase} border border-gray-400 font-medium dark:border-gray-600`;
const navOn = `${navBase} bg-blue-700 font-bold text-white`;
// secondaryButtonClass と同じ見た目（'use client' のモジュールの定数はサーバー部品から値として読めないため複写）。
const secondaryLinkClass =
  'flex min-h-11 items-center rounded-lg border border-gray-400 px-4 text-base font-medium dark:border-gray-600';

const FILTERS: ListFilter[] = ['active', 'done', 'deleted'];

function filterHref(f: ListFilter): string {
  return f === 'active' ? '/admin/sites' : `/admin/sites?status=${f}`;
}

export default async function SitesPage({ searchParams }: PageProps<'/admin/sites'>) {
  await requireAdmin();
  const { status: rawStatus } = await searchParams;
  const status: ListFilter = rawStatus === 'done' || rawStatus === 'deleted' ? rawStatus : 'active';

  // 削除済みは listDeletedSites だけで扱う（listMySites は削除済みを返さない）。
  const sites = status === 'deleted' ? await listDeletedSites() : (await listMySites()).filter((s) => s.status === status);
  // 見積が未提出の件の数（2026-11-20。削除済みには出さない）と、新規作成で「見積提出が必須」を出すか
  const [pendingCounts, estimateReady] = await Promise.all([
    status === 'deleted' ? Promise.resolve<Record<string, number>>({}) : countEstimatePendingBySite(sites.map((s) => s.id)),
    issueEstimateColumnsReady(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <AdminNav current="sites" />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">現場管理</h1>
        <div className="flex gap-2">
          <Link href="/admin/sites/log" className={secondaryLinkClass}>
            削除ログ
          </Link>
          <NewSiteButton estimateReady={estimateReady} />
        </div>
      </div>

      <div role="group" aria-label="状態で絞り込み" className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <Link
            key={s}
            href={filterHref(s)}
            aria-current={s === status ? 'page' : undefined}
            className={s === status ? navOn : navOff}
          >
            {LIST_FILTER_LABELS[s]}
          </Link>
        ))}
      </div>

      {sites.length === 0 ? (
        <EmptyText>{LIST_FILTER_LABELS[status]}の現場はありません。</EmptyText>
      ) : status === 'deleted' ? (
        <>
          <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
            削除済みの現場は、管理者を含む全員の画面から消えています。「復元」を押すと元に戻ります。
          </p>
          <ul>
            {sites.map((s) => (
              <li
                key={s.id}
                className={`flex min-h-14 items-center justify-between gap-3 border-b border-gray-300 px-1 py-2 dark:border-gray-700 ${rowLinkClass}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate font-bold ${linkTitleClass}`}>{siteTitle(s)}</span>
                  <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                    {siteSubline(s, { showAmount: false })}
                  </span>
                  <span className="block text-sm text-gray-600 dark:text-gray-400">
                    削除 {s.deletedAt ? jpDateTime(s.deletedAt) : ''}
                  </span>
                </span>
                <RestoreSiteButton siteId={s.id} siteName={s.name} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul>
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/admin/sites/${s.id}`}
                className={`flex min-h-14 items-center justify-between gap-3 border-b border-gray-300 px-1 py-2 dark:border-gray-700 ${rowLinkClass}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate font-bold ${linkTitleClass}`}>{siteTitle(s)}</span>
                  <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                    {siteSubline(s, { showAmount: false })}
                  </span>
                  <EstimatePendingCount count={pendingCounts[s.id]} />
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium">
                  {/* 請負金額は右の列のまま（管理者だけの画面なので 2 行目には重ねない） */}
                  {contractAmountText(s.contractAmount)}
                  <Chevron />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
