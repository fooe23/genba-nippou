'use client';

import { useState } from 'react';
import { setSiteMasters } from '@/lib/db/sites-actions';
import type { SiteMasters } from '@/lib/db/sites';
import { EmptyText, ErrorText, primaryButtonClass, useRunner } from '@/components/masters/common';

export interface CheckItem { id: string; name: string; sub?: string | null; active: boolean; }

interface Props {
  siteId: string;
  selected: SiteMasters;
  workers: CheckItem[];
  suppliers: CheckItem[];
  vehicles: CheckItem[];
  leaseItems: CheckItem[];
}

type Key = keyof SiteMasters;

const smallButtonClass =
  'min-h-11 rounded-lg border border-gray-400 px-3 text-sm font-medium disabled:opacity-50 dark:border-gray-600';

function Checklist({
  title,
  items,
  checked,
  onToggle,
  onSetAll,
}: {
  title: string;
  items: CheckItem[];
  checked: Set<string>;
  onToggle: (id: string) => void;
  /** すべて選択（有効なものだけ）／すべて外す */
  onSetAll: (ids: string[]) => void;
}) {
  const activeIds = items.filter((i) => i.active).map((i) => i.id);
  return (
    <fieldset className="space-y-1">
      <legend className="mb-1 font-bold">
        {title}
        <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">（{checked.size}件選択中）</span>
      </legend>
      {items.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-2">
          <button type="button" onClick={() => onSetAll(activeIds)} className={smallButtonClass}>
            すべて選択（有効な{activeIds.length}件）
          </button>
          <button type="button" onClick={() => onSetAll([])} disabled={checked.size === 0} className={smallButtonClass}>
            すべて外す
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyText>選べる項目がありません。マスター管理で登録してください。</EmptyText>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.id} className="border-b border-gray-300 dark:border-gray-700">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={checked.has(i.id)}
                  onChange={() => onToggle(i.id)}
                  className="size-6 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.name}</span>
                  {i.sub ? <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{i.sub}</span> : null}
                </span>
                {!i.active && (
                  <span className="shrink-0 rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                    無効
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** ③ この現場で使うマスター: 作業員・取引先・車両・リース品をチェックして保存。 */
export function SiteMastersSection({ siteId, selected, workers, suppliers, vehicles, leaseItems }: Props) {
  const { pending, error, run } = useRunner();
  const [sel, setSel] = useState<Record<Key, Set<string>>>({
    workerIds: new Set(selected.workerIds),
    supplierIds: new Set(selected.supplierIds),
    vehicleIds: new Set(selected.vehicleIds),
    leaseItemIds: new Set(selected.leaseItemIds),
  });
  const [saved, setSaved] = useState(false);

  function toggle(key: Key, id: string) {
    setSaved(false);
    setSel((prev) => {
      const next = new Set(prev[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  }

  function setAll(key: Key, ids: string[]) {
    setSaved(false);
    setSel((prev) => ({ ...prev, [key]: new Set(ids) }));
  }

  // 既存の並び（保存済みの順）を保ち、新しく選んだものは一覧順で末尾に足す。
  function ordered(key: Key, items: CheckItem[]): string[] {
    const keep = selected[key].filter((id) => sel[key].has(id));
    const keepSet = new Set(keep);
    const added = items.filter((i) => sel[key].has(i.id) && !keepSet.has(i.id)).map((i) => i.id);
    return [...keep, ...added];
  }

  function save() {
    setSaved(false);
    run(
      () =>
        setSiteMasters(siteId, {
          workerIds: ordered('workerIds', workers),
          supplierIds: ordered('supplierIds', suppliers),
          vehicleIds: ordered('vehicleIds', vehicles),
          leaseItemIds: ordered('leaseItemIds', leaseItems),
        }),
      () => setSaved(true),
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        ここで選んだものだけが、この現場の日報のプルダウンに出ます。何も選んでいない種類は、有効なもの全部が出ます。
      </p>
      <Checklist title="作業員" items={workers} checked={sel.workerIds} onToggle={(id) => toggle('workerIds', id)} onSetAll={(ids) => setAll('workerIds', ids)} />
      <Checklist title="取引先" items={suppliers} checked={sel.supplierIds} onToggle={(id) => toggle('supplierIds', id)} onSetAll={(ids) => setAll('supplierIds', ids)} />
      <Checklist title="車両" items={vehicles} checked={sel.vehicleIds} onToggle={(id) => toggle('vehicleIds', id)} onSetAll={(ids) => setAll('vehicleIds', ids)} />
      <Checklist title="リース品" items={leaseItems} checked={sel.leaseItemIds} onToggle={(id) => toggle('leaseItemIds', id)} onSetAll={(ids) => setAll('leaseItemIds', ids)} />
      <ErrorText message={error} />
      {saved && !error && (
        <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
          保存しました
        </p>
      )}
      <button type="button" disabled={pending} onClick={save} className={`${primaryButtonClass} w-full`}>
        {pending ? '保存中…' : 'マスターを保存'}
      </button>
    </div>
  );
}
