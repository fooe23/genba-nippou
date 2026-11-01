import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { jpDateTime, yen } from '@/lib/calc/format';
import { listLeaseItems, listSuppliers, listVehicles, listWorkers } from '@/lib/db/masters';
import { requireAdmin } from '@/lib/db/profile';
import { getSite, getSiteMasters, listCarryovers, listProfiles, listSiteMembers } from '@/lib/db/sites';
import { CarryoverSection } from '@/components/sites/CarryoverSection';
import { DeleteSiteButton } from '@/components/sites/DeleteSiteButton';
import { MembersSection } from '@/components/sites/MembersSection';
import { SiteForm } from '@/components/sites/SiteForm';
import { SiteMastersSection, type CheckItem } from '@/components/sites/SiteMastersSection';

export const metadata = { title: '現場の編集' };

// 有効な項目 + すでに選択済みの無効な項目（外し忘れに気づけるよう表示する）。
function visible<T extends { id: string; active: boolean }>(items: T[], selectedIds: string[]): T[] {
  const selected = new Set(selectedIds);
  return items.filter((i) => i.active || selected.has(i.id));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 border-b border-gray-300 pb-2 text-lg font-bold dark:border-gray-700">{title}</h2>
      {children}
    </section>
  );
}

export default async function SiteEditPage({ params }: PageProps<'/admin/sites/[siteId]'>) {
  await requireAdmin();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site) notFound();

  const [members, profiles, masters, carryovers, workers, suppliers, vehicles, leaseItems] = await Promise.all([
    listSiteMembers(siteId),
    listProfiles(),
    getSiteMasters(siteId),
    listCarryovers(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
  ]);

  const workerItems: CheckItem[] = visible(workers, masters.workerIds).map((w) => ({
    id: w.id,
    name: w.name,
    sub: w.trade,
    active: w.active,
  }));
  const supplierItems: CheckItem[] = visible(suppliers, masters.supplierIds).map((s) => ({
    id: s.id,
    name: s.name,
    sub: s.category,
    active: s.active,
  }));
  const vehicleItems: CheckItem[] = visible(vehicles, masters.vehicleIds).map((v) => ({
    id: v.id,
    name: v.name,
    sub: v.kind,
    active: v.active,
  }));
  const leaseItemItems: CheckItem[] = visible(leaseItems, masters.leaseItemIds).map((l) => ({
    id: l.id,
    name: l.name,
    sub: l.spec,
    active: l.active,
  }));

  const workerNames = new Map(workers.map((w) => [w.id, w.name]));
  const carryoverWorkers = masters.workerIds.map((id) => ({ id, name: workerNames.get(id) ?? '（不明な作業員）' }));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link href="/admin/sites" className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← 現場一覧
      </Link>
      {site.deletedAt !== null && (
        <p role="status" className="mb-3 rounded-lg border border-red-500 bg-red-50 p-3 font-bold text-red-900 dark:bg-red-950 dark:text-red-50">
          この現場は削除済みです（{jpDateTime(site.deletedAt).slice(0, 10)}）。復元は現場一覧の『削除済み』から行えます。
        </p>
      )}
      <h1 className="text-xl font-bold">{site.name}</h1>
      {site.contractAmount !== null && (
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">工事総請負金額 {yen(site.contractAmount)}</p>
      )}

      <div className="mt-4">
        <Section title="① 現場情報">
          <SiteForm site={site} />
        </Section>
        <Section title="② 担当者">
          <MembersSection siteId={siteId} members={members} profiles={profiles} />
        </Section>
        <Section title="③ この現場で使うマスター">
          <SiteMastersSection
            siteId={siteId}
            selected={masters}
            workers={workerItems}
            suppliers={supplierItems}
            vehicles={vehicleItems}
            leaseItems={leaseItemItems}
          />
        </Section>
        <Section title="④ 繰越初期値">
          <CarryoverSection siteId={siteId} workers={carryoverWorkers} carryovers={carryovers} />
        </Section>
        {site.deletedAt === null && (
          <Section title="⑤ 現場の削除">
            <p className="mb-3 text-sm">
              削除すると、この現場と日報は全員の画面から消えます（データは残り、管理者が復元できます）。削除した人・日時・理由は削除ログに記録されます。
            </p>
            <DeleteSiteButton siteId={siteId} siteName={site.name} />
          </Section>
        )}
      </div>
    </main>
  );
}
