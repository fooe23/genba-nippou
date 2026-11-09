'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { parsePercentInput, percentText, type ProgressHistoryEntry } from '@/lib/budget/budget-view';
import { jpDateTime } from '@/lib/calc/format';
import { setTradeProgress } from '@/lib/db/budget-actions';
import { ErrorText, inputClass, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';

function whoText(e: ProgressHistoryEntry): string {
  return e.setByName || (e.setBy === null ? '記録なし' : '（氏名を表示できません）');
}

/**
 * 工種の進み具合の % の上書き：いまの上書き（入れた人・日時）と履歴（新しい 5 件）。入力欄は canOverride
 * （管理者と、その現場の確認・承認の人［社員］）だけ。完了した現場は readOnly。書き込みは setTradeProgress（RLS が正）。
 */
export function ProgressOverride({
  siteId,
  tradeId,
  tradeName,
  override,
  fromQty,
  history,
  canOverride,
  readOnly,
}: {
  siteId: string;
  tradeId: string;
  tradeName: string;
  override: number | null;
  fromQty: number | null;
  history: ProgressHistoryEntry[];
  canOverride: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, error, setError, runResult } = useRunner();
  const [raw, setRaw] = useState('');
  const latest = history[0];
  const inputId = `progress-${tradeId}`;

  function save(percent: number | null) {
    runResult(
      () => setTradeProgress(siteId, tradeId, percent),
      () => {
        setRaw('');
        router.refresh();
      },
    );
  }

  return (
    <section className="space-y-2 rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <h4 className="text-sm font-bold">進み具合の % の上書き</h4>
      <p className="text-sm">
        {override !== null ? (
          <>
            いまの上書き：<b>{percentText(override)}</b>
            {latest && latest.percent !== null && (
              <span className="text-gray-700 dark:text-gray-300">
                （{whoText(latest)}・{jpDateTime(latest.setAt)}）
              </span>
            )}
          </>
        ) : (
          <>上書きはありません（{fromQty !== null ? `数量から ${percentText(fromQty)} を使っています` : '数量からも出せないため、見込みは出ません'}）。</>
        )}
      </p>

      {canOverride && !readOnly && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const p = parsePercentInput(raw);
            if (!p.ok) {
              setError(p.error);
              return;
            }
            save(p.value);
          }}
        >
          <label htmlFor={inputId} className="block w-32">
            <span className="mb-1 block text-sm font-medium">{tradeName}の %</span>
            <input
              id={inputId}
              type="text"
              inputMode="decimal"
              value={raw}
              placeholder="0〜100"
              onChange={(e) => setRaw(e.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            % を上書き
          </button>
          {override !== null && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`「${tradeName}」の進み具合の上書きを外しますか？（数量からの % に戻ります）`)) save(null);
              }}
              className={secondaryButtonClass}
            >
              上書きを外す
            </button>
          )}
        </form>
      )}
      {canOverride && readOnly && <p className="text-sm text-gray-700 dark:text-gray-300">完了した現場のため変更できません。</p>}
      {!canOverride && (
        <p className="text-xs text-gray-600 dark:text-gray-400">% を上書きできるのは、管理者と、この現場の確認者・承認者だけです。</p>
      )}
      <ErrorText message={error} />

      {history.length > 0 && (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-blue-700 dark:text-blue-400">
            上書きの履歴（新しい {history.length} 件）
          </summary>
          <ul className="space-y-1 text-sm">
            {history.map((h, i) => (
              <li key={`${h.setAt}-${i}`} className="break-words">
                {jpDateTime(h.setAt)}　{h.percent === null ? '上書きを外した' : percentText(h.percent)}　{whoText(h)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
