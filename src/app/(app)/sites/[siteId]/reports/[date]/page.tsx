import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { pdfViewerHref } from '@/lib/pdf-viewer';
import { SITE_CLOSED_NOTICE } from '@/lib/constants';
import { dateSchema } from '@/lib/db/masters-schemas';
import { requireProfile } from '@/lib/db/profile';
import { getReport } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { loadReportFormProps } from '@/lib/report/form-props';
import { ReportForm } from '@/components/report/ReportForm';

export const metadata = { title: '日報' };
// この画面から呼ぶ Server Action（お客様のサインの保存は写真入りの PDF を作る）の上限時間（秒）。
export const maxDuration = 60;

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
  // PDF は「開く」（アプリの中の PDF ビューアー /pdf。同じ画面で開き、「戻る」でこの日報に戻る）と保存（ダウンロード）の 2 つ。
  const exportHref = (format: 'pdf' | 'csv') =>
    `/api/reports/daily?site=${encodeURIComponent(siteId)}&date=${encodeURIComponent(date)}&format=${format}`;
  const back = `/sites/${siteId}/reports/${date}`;
  const viewer = (src: string, title: string) => pdfViewerHref({ src, title, back }) ?? src;
  const exportLinks =
    report.head && profile.accountType !== 'partner'
      ? {
          pdfPreview: viewer(`${exportHref('pdf')}&disposition=inline`, `日報 ${site.name} ${date}`),
          pdf: exportHref('pdf'),
          csv: exportHref('csv'),
          // 現場日報（お客様用）：金額・氏名・連絡事項を出さない PDF（開くと保存）。
          clientPdfPreview: viewer(`${exportHref('pdf')}&audience=client&disposition=inline`, `日報（お客様用） ${site.name} ${date}`),
          clientPdf: `${exportHref('pdf')}&audience=client`,
        }
      : undefined;

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
