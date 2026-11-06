import Link from 'next/link';
import { jpDate, jpDateTime, yen } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listFixRequests, listSubmittedReports, type FixRequest, type SubmittedReport } from '@/lib/db/reports';
import { Chevron, linkTitleClass, rowLinkClass } from '@/components/ui/tappable';

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
  const [reports, fixRequests] = await Promise.all([listSubmittedReports(), listFixRequests()]);
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
                    className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border border-gray-300 p-3 dark:border-gray-700 ${rowLinkClass}`}
                  >
                    <span className="min-w-0">
                      <span className={`block font-bold ${linkTitleClass}`}>{jpDate(r.reportDate)}</span>
                      <span className="block truncate text-sm text-gray-600 dark:text-gray-400">
                        作成者／責任者：{r.createdByName || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      <span className="block">出来高 {yen(r.outputTotal)}</span>
                      <span className="block text-gray-600 dark:text-gray-400">本日原価 {yen(r.costTotal)}</span>
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <FixRequestSection requests={fixRequests} />
    </main>
  );
}

/**
 * 修正申請（提出済み・承認済みの日報に、担当者などが理由を付けて出したもの）。自分が確認者・承認者の現場（管理者は全部）だけ。
 * 日報画面を開き、差戻しか承認解除で下書きに戻すと申請は終わる。申請が無ければ何も出さない。
 */
function FixRequestSection({ requests }: { requests: FixRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section aria-label="修正申請" className="mt-8">
      <h2 className="mb-1 border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">
        修正申請
        <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">{requests.length}件</span>
      </h2>
      <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
        日報を開き、承認待ちなら「差戻し」、承認済みなら「承認解除（下書きに戻す）」で担当者に戻してください。戻すと申請は終わります。
      </p>
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id}>
            <Link
              href={`/approvals/${r.reportId}`}
              className={`flex min-h-14 items-center justify-between gap-3 rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50 ${rowLinkClass}`}
            >
              <span className="min-w-0">
                <span className={`block font-bold ${linkTitleClass}`}>
                  {r.siteName}　{r.reportDate ? jpDate(r.reportDate) : ''}
                </span>
                <span className="block text-sm">
                  {r.requestedByName || '—'}（{jpDateTime(r.requestedAt)}）
                </span>
                <span className="block whitespace-pre-wrap break-words text-sm">理由：{r.reason}</span>
              </span>
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
