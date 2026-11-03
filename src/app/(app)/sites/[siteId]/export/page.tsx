import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { monthKey, todayJst } from '@/lib/calc/format';
import { loadExportInput, loadMonthReports } from '@/lib/db/export';
import { requireProfile } from '@/lib/db/profile';
import { listReportHeads } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { buildExportPayload } from '@/lib/export/payload';
import { overflowNotice } from '@/lib/export/query';
import type { ExportInput } from '@/lib/export/types';
import { ExportPanel, type ExportMonthOption } from '@/components/export/ExportPanel';

export const metadata = { title: '出力' };

function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
}

/**
 * 日報のある月（新しい順）と、それぞれ原本 Excel に入りきるか。
 * 月によらない部分（現場・設定・マスター・全日報の原価と労務行・繰越）は 1 回だけ読み、月ごとには日報だけ読む。
 */
async function exportMonths(siteId: string): Promise<ExportMonthOption[]> {
  const heads = await listReportHeads(siteId);
  const months = [...new Set(heads.map((h) => monthKey(h.reportDate)))].sort().reverse();
  if (months.length === 0) return [];
  const [base, rest] = await Promise.all([
    loadExportInput(siteId, months[0]),
    Promise.all(months.slice(1).map((m) => loadMonthReports(siteId, m))),
  ]);
  const inputs: ExportInput[] = [base, ...months.slice(1).map((month, i) => ({ ...base, month, reports: rest[i] }))];
  return inputs.map((input) => ({
    month: input.month,
    label: monthLabel(input.month),
    reportCount: input.reports.length,
    notice: overflowNotice(buildExportPayload(input).warnings),
  }));
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
