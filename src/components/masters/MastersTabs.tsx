'use client';

import { useSearchParams } from 'next/navigation';
import type { LeaseItem, MasterOption, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { ImportLogEntry } from '@/lib/db/import';
import type { Settings } from '@/lib/db/settings';
import type { Updaters } from './common';
import { ImportPanel } from './ImportPanel';
import { LeaseItemsPanel } from './LeaseItemsPanel';
import { OptionsPanel } from './OptionsPanel';
import { SettingsPanel } from './SettingsPanel';
import { SuppliersPanel } from './SuppliersPanel';
import { VehiclesPanel } from './VehiclesPanel';
import { WorkersPanel } from './WorkersPanel';
import { upsertUnit, upsertWeather } from '@/lib/db/masters-actions';

const TABS = [
  { key: 'workers', label: '作業員' },
  { key: 'suppliers', label: '取引先' },
  { key: 'vehicles', label: '車両' },
  { key: 'lease', label: 'リース品' },
  { key: 'units', label: '単位' },
  { key: 'weather', label: '天候' },
  { key: 'import', label: '取り込み' },
  { key: 'settings', label: '労務の設定' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function isTabKey(v: string | null): v is TabKey {
  return TABS.some((t) => t.key === v);
}

export interface MastersData {
  today: string;
  workers: Worker[];
  suppliers: Supplier[];
  vehicles: Vehicle[];
  leaseItems: LeaseItem[];
  units: MasterOption[];
  weather: MasterOption[];
  settings: Settings;
  /** 取り込み履歴（新しい順、最大 50 件）。 */
  importLog: ImportLogEntry[];
  /** 更新者の表示名（profiles.id → 氏名、無ければメール）。 */
  updaters: Updaters;
}

export function MastersTabs({ data }: { data: MastersData }) {
  const params = useSearchParams();
  const raw = params.get('tab');
  const active: TabKey = isTabKey(raw) ? raw : 'workers';

  function select(key: TabKey) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    // サーバーへ再取得せず、URL だけ更新する（useSearchParams も追従する）
    window.history.replaceState(null, '', url);
  }

  return (
    <div>
      <div role="tablist" aria-label="マスターの種類" className="-mx-4 mb-4 flex overflow-x-auto border-b border-gray-300 px-4 dark:border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={active === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => select(t.key)}
            className={`min-h-11 shrink-0 border-b-2 px-4 text-base font-bold ${
              active === t.key
                ? 'border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
        {active === 'workers' && (
          <WorkersPanel
            workers={data.workers}
            suppliers={data.suppliers}
            today={data.today}
            rule={data.settings.rule}
            updaters={data.updaters}
          />
        )}
        {active === 'suppliers' && <SuppliersPanel suppliers={data.suppliers} updaters={data.updaters} />}
        {active === 'vehicles' && <VehiclesPanel vehicles={data.vehicles} updaters={data.updaters} />}
        {active === 'lease' && <LeaseItemsPanel items={data.leaseItems} today={data.today} updaters={data.updaters} />}
        {active === 'units' && <OptionsPanel title="単位" options={data.units} onSave={upsertUnit} />}
        {active === 'weather' && <OptionsPanel title="天候" options={data.weather} onSave={upsertWeather} />}
        {active === 'import' && (
          <ImportPanel
            today={data.today}
            current={{ workers: data.workers, suppliers: data.suppliers, vehicles: data.vehicles, leaseItems: data.leaseItems }}
            importLog={data.importLog}
          />
        )}
        {active === 'settings' && <SettingsPanel settings={data.settings} updaters={data.updaters} />}
      </div>
    </div>
  );
}
