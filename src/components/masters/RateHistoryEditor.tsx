'use client';

import { useState } from 'react';
import { yen, jpDate, todayJst } from '@/lib/calc/format';
import type { RateHistory } from '@/lib/calc/rates';
import { amountSchema, dateSchema, firstError } from '@/lib/db/masters-schemas';
import { ErrorText, Field, inputClass, secondaryButtonClass, useRunner } from './common';

/** 単価の改定履歴（適用開始日・金額）と「改定を追加」フォーム。作業員・リース品で共用。 */
export function RateHistoryEditor({
  rates,
  amountLabel,
  onAdd,
}: {
  rates: RateHistory[];
  amountLabel: string;
  onAdd: (amount: number, effectiveFrom: string) => Promise<void>;
}) {
  const { pending, error, setError, run } = useRunner();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayJst());
  const sorted = [...rates].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));

  function submit() {
    const value = amount.trim() === '' ? NaN : Number(amount);
    const message = firstError(amountSchema, value) ?? firstError(dateSchema, date);
    if (message) {
      setError(message);
      return;
    }
    run(
      () => onAdd(value, date),
      () => setAmount(''),
    );
  }

  return (
    <section className="space-y-3 border-t border-gray-300 pt-4 dark:border-gray-700">
      <h3 className="font-bold">単価の改定履歴</h3>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">単価は未設定です。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left dark:border-gray-700">
                <th className="py-2 pr-3 font-medium">適用開始日</th>
                <th className="py-2 text-right font-medium">{amountLabel}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.effectiveFrom} className="border-b border-gray-200 dark:border-gray-800">
                  <td className="py-2 pr-3">{jpDate(r.effectiveFrom)}</td>
                  <td className="py-2 text-right">{yen(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="space-y-3 rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
        <p className="text-sm font-bold">改定を追加</p>
        <Field label="適用開始日">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label={`${amountLabel}（円）`}>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </Field>
        <p className="text-xs text-gray-600 dark:text-gray-400">同じ適用開始日がある場合は金額を上書きします。</p>
        <ErrorText message={error} />
        <button type="button" onClick={submit} disabled={pending} className={secondaryButtonClass}>
          {pending ? '追加中…' : '改定を追加'}
        </button>
      </div>
    </section>
  );
}
