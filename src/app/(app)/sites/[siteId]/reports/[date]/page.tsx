import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { SITE_CLOSED_NOTICE } from '@/lib/constants';
import { dateSchema } from '@/lib/db/masters-schemas';
import { requireProfile } from '@/lib/db/profile';
import { getReport } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { loadReportFormProps } from '@/lib/report/form-props';
import { ReportForm } from '@/components/report/ReportForm';

export const metadata = { title: '日報' };

export default async function ReportPage({ params }: PageProps<'/sites/[siteId]/reports/[date]'>) {
  const profile = await requireProfile();
  const { siteId, date } = await params;
  if (!isUuid(siteId) || !dateSchema.safeParse(date).success) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const closed = site.status === 'done';

  const report = await getReport(siteId, date);
  const props = await loadReportFormProps(profile, site, date, report);
  // 帳票（PDF・CSV）は保存済みの日報だけ。協力会社は出力できない（/api/reports/daily も 403）。
  const exportHref = (format: 'pdf' | 'csv') =>
    `/api/reports/daily?site=${encodeURIComponent(siteId)}&date=${encodeURIComponent(date)}&format=${format}`;
  const exportLinks =
    report.head && profile.accountType !== 'partner' ? { pdf: exportHref('pdf'), csv: exportHref('csv') } : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <ReportForm
        key={`${siteId}:${date}`}
        {...props}
        readOnly={report.head?.status === 'approved' || closed}
        siteClosed={closed}
        readOnlyNotice={closed ? SITE_CLOSED_NOTICE : undefined}
        exportLinks={exportLinks}
      />
    </main>
  );
}
