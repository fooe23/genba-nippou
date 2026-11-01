import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listOpenIssues, listReportHeads } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { ReportCalendar } from '@/components/site/ReportCalendar';
import { SiteStatusButton } from '@/components/site/SiteStatusButton';
import { SiteSummary } from '@/components/site/SiteSummary';

export const metadata = { title: '現場' };

export default async function SiteDetailPage({ params }: PageProps<'/sites/[siteId]'>) {
  const profile = await requireProfile();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  // 削除済みの現場は管理者にも出さない（管理 → 現場 → 「削除済み」でだけ扱う）。
  if (!site || site.deletedAt !== null) notFound();
  const done = site.status === 'done';
  const [heads, issues] = await Promise.all([listReportHeads(siteId), listOpenIssues(siteId)]);
  const today = todayJst();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link
        href={done ? '/done' : '/'}
        className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400"
      >
        {done ? '← 完了現場' : '← ホーム'}
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">{site.name}</h1>
        {done && (
          <span className="rounded border border-blue-400 bg-blue-50 px-2 py-0.5 text-sm font-bold text-blue-900 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-50">
            完了（閲覧のみ）
          </span>
        )}
      </div>
      {site.clientName && <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{site.clientName}</p>}

      <div className="mt-4">
        <SiteSummary site={site} heads={heads} today={today} issues={issues} />
        <ReportCalendar siteId={siteId} heads={heads} today={today} />
      </div>

      <Link
        href={`/sites/${siteId}/summary`}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-lg border border-blue-700 text-base font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400"
      >
        集計を見る
      </Link>

      {profile.isAdmin && <SiteStatusButton siteId={siteId} status={site.status} />}
    </main>
  );
}
