'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { yen } from '@/lib/calc/format';
import { firstError } from '@/lib/db/masters-schemas';
import { upsertCarryover } from '@/lib/db/sites-actions';
import type { Carryover } from '@/lib/db/sites';
import { carryoverSchema } from '@/lib/db/sites-schemas';
import { EmptyText, ErrorText, Field, inputClass, numOrNull, secondaryButtonClass, str, useRunner } from '@/components/masters/common';

export interface CarryoverWorker { id: string; name: string; }

function CarryoverRow({ siteId, worker, value }: { siteId: string; worker: CarryoverWorker; value: Carryover | null }) {
  const { pending, error, setError, run } = useRunner();
  const [saved, setSaved] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const manDays = numOrNull(str(fd, 'manDays'));
    const laborCost = numOrNull(str(fd, 'laborCost'));
    const input: Carryover = {
      workerId: worker.id,
      manDays: manDays ?? NaN,
      laborCost: laborCost ?? NaN,
      beforeDate: str(fd, 'beforeDate'),
    };
    const message = firstError(carryoverSchema, input);
    if (message) {
      setError(message);
      return;
    }
    run(() => upsertCarryover(siteId, input), () => setSaved(true));
  }

  return (
    <li className="border-b border-gray-300 py-3 dark:border-gray-700">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold">{worker.name}</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {value ? `登録済み（労務費 ${yen(value.laborCost)}）` : '未登録'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="人工">
            <input
              name="manDays"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              defaultValue={value?.manDays ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label="労務費（円）">
            <input
              name="laborCost"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              defaultValue={value?.laborCost ?? ''}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="基準日">
          <input name="beforeDate" type="date" defaultValue={value?.beforeDate ?? ''} className={inputClass} />
        </Field>
        <ErrorText message={error} />
        {saved && !error && (
          <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
            保存しました
          </p>
        )}
        <button type="submit" disabled={pending} className={`${secondaryButtonClass} w-full`}>
          {pending ? '保存中…' : `${worker.name}の繰越を保存`}
        </button>
      </form>
    </li>
  );
}

/** ④ 繰越初期値: この現場の作業員ごとに、基準日までの人工・労務費の累計を登録する。 */
export function CarryoverSection({
  siteId,
  workers,
  carryovers,
}: {
  siteId: string;
  workers: CarryoverWorker[];
  carryovers: Carryover[];
}) {
  const byWorker = new Map(carryovers.map((c) => [c.workerId, c]));
  return (
    <div className="space-y-2">
      <p className="text-sm">
        途中から日報アプリを使い始める現場で、それまでの人工・労務費を引き継ぎます。
        <Link href="/guide/carryover" className="ml-1 font-medium text-blue-700 underline dark:text-blue-400">
          前月繰越とは？
        </Link>
      </p>
      {workers.length === 0 ? (
        <EmptyText>先に「この現場で使うマスター」で作業員を選んで保存してください。</EmptyText>
      ) : (
        <ul>
          {workers.map((w) => {
            const v = byWorker.get(w.id) ?? null;
            return <CarryoverRow key={w.id} siteId={siteId} worker={w} value={v} />;
          })}
        </ul>
      )}
    </div>
  );
}
