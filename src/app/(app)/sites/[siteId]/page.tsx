import Link from 'next/link';
import { notFound } from 'next/navigation';
import { todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listReportHeads } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { ReportCalendar } from '@/components/site/ReportCalendar';
import { SiteSummary } from '@/components/site/SiteSummary';

export const metadata = { title: '現場' };

export default async function SiteDetailPage({ params }: PageProps<'/sites/[siteId]'>) {
  await requireProfile();
  const { siteId } = await params;
  const site = await getSite(siteId);
  if (!site) notFound();
  const heads = await listReportHeads(siteId);
  const today = todayJst();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link href="/" className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← ホーム
      </Link>
      <h1 className="text-xl font-bold">{site.name}</h1>
      {site.clientName && <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{site.clientName}</p>}

      <div className="mt-4">
        <SiteSummary site={site} heads={heads} today={today} />
        <ReportCalendar siteId={siteId} heads={heads} today={today} />
      </div>

      <Link
        href={`/sites/${siteId}/summary`}
        className="mt-6 flex min-h-12 w-full items-center justify-center rounded-lg border border-blue-700 text-base font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400"
      >
        集計を見る
      </Link>
    </main>
  );
}
