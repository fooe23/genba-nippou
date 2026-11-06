import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { requireProfile } from '@/lib/db/profile';
import { getReportById } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { loadReportFormProps } from '@/lib/report/form-props';
import { ApprovalActions } from '@/components/approval/ApprovalActions';
import { ReportForm } from '@/components/report/ReportForm';

export const metadata = { title: '日報の確認' };

export default async function ApprovalDetailPage({ params }: PageProps<'/approvals/[reportId]'>) {
  const profile = await requireProfile();
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const found = await getReportById(reportId);
  if (!found || !found.detail.head) notFound();
  const site = await getSite(found.siteId);
  // 削除済みの現場の日報は承認画面にも出さない。
  if (!site || site.deletedAt !== null) notFound();

  const props = await loadReportFormProps(profile, site, found.date, found.detail);
  // 承認・差戻し・承認解除ができるのは、その現場の確認者・承認者と管理者（props.canReopen と同じ判定）。
  const canReview = props.canReopen;

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <ReportForm key={reportId} {...props} readOnly review siteClosed={site.status === 'done'} />
      <ApprovalActions reportId={reportId} status={found.detail.head.status} canReview={canReview} siteClosed={site.status === 'done'} />
    </main>
  );
}
