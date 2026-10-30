import { notFound } from 'next/navigation';
import { dateSchema } from '@/lib/db/masters-schemas';
import { requireProfile } from '@/lib/db/profile';
import { getReport } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { loadReportFormProps } from '@/lib/report/form-props';
import { ReportForm } from '@/components/report/ReportForm';

export const metadata = { title: '日報' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReportPage({ params }: PageProps<'/sites/[siteId]/reports/[date]'>) {
  const profile = await requireProfile();
  const { siteId, date } = await params;
  if (!UUID.test(siteId) || !dateSchema.safeParse(date).success) notFound();
  const site = await getSite(siteId);
  if (!site) notFound();

  const report = await getReport(siteId, date);
  const props = await loadReportFormProps(profile, site, date, report);

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <ReportForm key={`${siteId}:${date}`} {...props} readOnly={report.head?.status === 'approved'} />
    </main>
  );
}
