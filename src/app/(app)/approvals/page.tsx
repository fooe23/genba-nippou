import Link from 'next/link';
import { jpDate, yen } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listSubmittedReports, type SubmittedReport } from '@/lib/db/reports';

export const metadata = { title: '承認' };

function groupBySite(reports: SubmittedReport[]): { siteId: string; siteName: string; reports: SubmittedReport[] }[] {
  const groups = new Map<string, { siteId: string; siteName: string; reports: SubmittedReport[] }>();
  for (const r of reports) {
    const g = groups.get(r.siteId) ?? { siteId: r.siteId, siteName: r.siteName, reports: [] };
    g.reports.push(r);
    groups.set(r.siteId, g);
  }
  return [...groups.values()].sort((a, b) => a.siteName.localeCompare(b.siteName, 'ja'));
}

export default async function ApprovalsPage() {
  await requireProfile();
  const reports = await listSubmittedReports();
  const groups = groupBySite(reports);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-bold">承認待ちの日報</h1>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-gray-300 p-6 text-center text-gray-600 dark:border-gray-700 dark:text-gray-400">
          承認待ちの日報はありません
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.siteId} aria-label={g.siteName} className="mb-6">
            <h2 className="mb-2 border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">
              {g.siteName}
              <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">{g.reports.length}件</span>
            </h2>
            <ul className="space-y-2">
              {g.reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/approvals/${r.id}`}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-gray-300 p-3 dark:border-gray-700"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold">{jpDate(r.reportDate)}</span>
                      <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                        作成者／責任者：{r.createdByName || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      <span className="block">出来高 {yen(r.outputTotal)}</span>
                      <span className="block text-gray-600 dark:text-gray-400">本日原価 {yen(r.costTotal)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
