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
import { AdminNav } from '@/components/accounts/AdminNav';
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
      <AdminNav current="masters" />
      <h1 className="mb-4 text-xl font-bold">マスター管理</h1>
      <Suspense>
        <MastersTabs data={{ today: todayJst(), workers, suppliers, vehicles, leaseItems, units, weather }} />
      </Suspense>
    </main>
  );
}
