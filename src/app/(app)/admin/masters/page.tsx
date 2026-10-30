import Link from 'next/link';
import { Suspense } from 'react';
import { todayJst } from '@/lib/calc/format';
import {
  listLeaseItems,
  listSuppliers,
  listUnitOptions,
  listVehicles,
  listWeatherOptions,
  listWorkers,
} from '@/lib/db/masters';
import { requireAdmin } from '@/lib/db/profile';
import { MastersTabs } from '@/components/masters/MastersTabs';

export const metadata = { title: 'マスター管理' };

export default async function MastersPage() {
  await requireAdmin();

  const [workers, suppliers, vehicles, leaseItems, units, weather] = await Promise.all([
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listUnitOptions(),
    listWeatherOptions(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <nav aria-label="管理メニュー" className="mb-4 flex gap-2">
        <Link
          href="/admin/sites"
          className="flex min-h-11 items-center rounded-lg border border-gray-400 px-4 text-base font-medium dark:border-gray-600"
        >
          現場
        </Link>
        <Link
          href="/admin/masters"
          aria-current="page"
          className="flex min-h-11 items-center rounded-lg bg-blue-700 px-4 text-base font-bold text-white"
        >
          マスター
        </Link>
      </nav>
      <h1 className="mb-4 text-xl font-bold">マスター管理</h1>
      <Suspense>
        <MastersTabs data={{ today: todayJst(), workers, suppliers, vehicles, leaseItems, units, weather }} />
      </Suspense>
    </main>
  );
}
