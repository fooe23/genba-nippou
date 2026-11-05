import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { addablePartnerSuppliers, partnerWorkerChoices } from '@/lib/calc/affiliation';
import { listSuppliers, listWorkers } from '@/lib/db/masters';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { getSite, getSiteMasters, listMySites, listSitePartners } from '@/lib/db/sites';
import { SitePartnersEditor, type PartnerWorkerChoice } from '@/components/sites/SitePartnersEditor';

export const metadata = { title: '協力会社と作業員' };

/**
 * 現場の「協力会社と作業員」。社員・管理者が、現場に入る協力会社（請負金額・メモは任意）と、会社ごとにこの現場で働く
 * 作業員を登録する。協力会社のアカウントには出さない（gn_site_partners も RLS で読めない）。完了現場は閲覧のみ。
 */
export default async function SitePartnersPage({ params }: PageProps<'/sites/[siteId]/partners'>) {
  const profile = await requireProfile();
  if (!isEmployeeOrAdmin(profile)) notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const readOnly = site.status === 'done';

  const [partners, masters, workers, suppliers, sites] = await Promise.all([
    listSitePartners(siteId),
    getSiteMasters(siteId),
    listWorkers(),
    listSuppliers(),
    listMySites(),
  ]);

  const workersBySupplier: Record<string, PartnerWorkerChoice[]> = Object.fromEntries(
    partners.map((p) => [
      p.supplierId,
      partnerWorkerChoices(workers, p.supplierId).map((w) => ({ id: w.id, name: w.name, trade: w.trade })),
    ]),
  );
  const addable = addablePartnerSuppliers(
    suppliers,
    partners.map((p) => p.supplierId),
  ).map((s) => ({ id: s.id, name: s.name }));
  const otherSites = sites.filter((s) => s.id !== siteId).map((s) => ({ id: s.id, name: s.name, done: s.status === 'done' }));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {site.name}
      </Link>
      <h1 className="mb-2 text-xl font-bold">協力会社と作業員</h1>
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
        この現場に入る協力会社と、会社ごとにこの現場で働く作業員を登録します。登録した作業員は日報の作業員のプルダウンに出ます（自社の作業員と手入力はいつでも選べます）。請負金額は社内用で、協力会社には見えません。
      </p>
      {readOnly && (
        <p role="status" className="mb-4 rounded-lg border border-blue-500 bg-blue-50 p-3 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-50">
          この現場は完了しているため閲覧のみです。変更するときは管理者が『進行中に戻す』を押してください。
        </p>
      )}
      <SitePartnersEditor
        siteId={siteId}
        readOnly={readOnly}
        partners={partners.map((p) => ({ id: p.id, supplierId: p.supplierId, supplierName: p.supplierName, amount: p.amount, note: p.note }))}
        workersBySupplier={workersBySupplier}
        registeredWorkerIds={masters.workerIds}
        addable={addable}
        otherSites={otherSites}
      />
    </main>
  );
}
