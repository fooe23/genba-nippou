import { Suspense } from 'react';
import { todayJst } from '@/lib/calc/format';
import {
  listLeaseItems,
  listSuppliers,
  listUnitOptions,
  listVehicles,
  listWeatherOptions,
  listUsedWorkerIds,
  listWorkers,
} from '@/lib/db/masters';
import { listImportLog } from '@/lib/db/import';
import { requireAdmin } from '@/lib/db/profile';
import { getSettings } from '@/lib/db/settings';
import { listProfiles } from '@/lib/db/sites';
import { AdminNav } from '@/components/accounts/AdminNav';
import { MastersTabs } from '@/components/masters/MastersTabs';

export const metadata = { title: 'マスター管理' };

/** 更新者の表示名（id → 氏名、無ければメール）。読めなければ空（更新者は表示しない）。 */
async function loadUpdaters(): Promise<Record<string, string>> {
  try {
    const profiles = await listProfiles();
    const map: Record<string, string> = {};
    for (const p of profiles) {
      const label = p.name.trim() || p.email.trim();
      if (label) map[p.id] = label;
    }
    return map;
  } catch (e) {
    console.error('[masters] profiles', e);
    return {};
  }
}

/** 日報・繰越で使っている作業員の ID。読めなければ null（削除ボタンを出さない。削除の可否は DB でも確かめる）。 */
async function loadUsedWorkerIds(): Promise<string[] | null> {
  try {
    return [...(await listUsedWorkerIds())];
  } catch (e) {
    console.error('[masters] used workers', e);
    return null;
  }
}

export default async function MastersPage() {
  await requireAdmin();

  const [workers, suppliers, vehicles, leaseItems, units, weather, settings, importLog, updaters, usedWorkerIds] = await Promise.all([
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listUnitOptions(),
    listWeatherOptions(),
    getSettings(),
    listImportLog(50),
    loadUpdaters(),
    loadUsedWorkerIds(),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <AdminNav current="masters" />
      <h1 className="mb-4 text-xl font-bold">マスター管理</h1>
      <Suspense>
        <MastersTabs
          data={{ today: todayJst(), workers, suppliers, vehicles, leaseItems, units, weather, settings, importLog, updaters, usedWorkerIds }}
        />
      </Suspense>
    </main>
  );
}
