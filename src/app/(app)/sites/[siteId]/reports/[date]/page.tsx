import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { dateSchema } from '@/lib/db/masters-schemas';
import { requireProfile } from '@/lib/db/profile';
import { getReport } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { loadReportFormProps } from '@/lib/report/form-props';
import { ReportForm } from '@/components/report/ReportForm';

export const metadata = { title: '日報' };

const CLOSED_NOTICE = 'この現場は完了しているため閲覧のみです。直す必要があるときは管理者が『進行中に戻す』を押してください。';

export default async function ReportPage({ params }: PageProps<'/sites/[siteId]/reports/[date]'>) {
  const profile = await requireProfile();
  const { siteId, date } = await params;
  if (!isUuid(siteId) || !dateSchema.safeParse(date).success) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const closed = site.status === 'done';

  const report = await getReport(siteId, date);
  const props = await loadReportFormProps(profile, site, date, report);

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <ReportForm
        key={`${siteId}:${date}`}
        {...props}
        readOnly={report.head?.status === 'approved' || closed}
        siteClosed={closed}
        readOnlyNotice={closed ? CLOSED_NOTICE : undefined}
      />
    </main>
  );
}
