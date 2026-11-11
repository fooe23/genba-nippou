import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { monthKey, todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listReportHeads } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { ExportPanel, type ExportMonthOption } from '@/components/export/ExportPanel';

export const metadata = { title: '出力' };

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

/** 日報のある月（新しい順）と、それぞれの日報の件数。 */
async function exportMonths(siteId: string): Promise<ExportMonthOption[]> {
  const heads = await listReportHeads(siteId);
  const counts = new Map<string, number>();
  for (const h of heads) {
    const m = monthKey(h.reportDate);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort()
    .reverse()
    .map((month) => ({ month, label: monthLabel(month), reportCount: counts.get(month)! }));
}

export default async function ExportPage({ params }: PageProps<'/sites/[siteId]/export'>) {
  const profile = await requireProfile();
  // 協力会社は出力しない（/api/export も 403）。
  if (profile.accountType === 'partner') notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  // 完了した現場も出力できる。削除済みは出さない。
  if (!site || site.deletedAt !== null) notFound();

  const months = await exportMonths(siteId);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {site.name}
      </Link>
      <h1 className="mb-3 text-xl font-bold">出力</h1>
      {months.length === 0 ? (
        <p className="text-base text-gray-600 dark:text-gray-400">日報がありません</p>
      ) : (
        <ExportPanel siteId={siteId} months={months} today={todayJst()} />
      )}
    </main>
  );
}
