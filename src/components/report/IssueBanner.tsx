'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { jpDate } from '@/lib/calc/format';
import type { Issue } from '@/lib/db/reports';
import { setIssueDone } from '@/lib/db/reports-actions';

/** 現場の対応中の重要事項（この日報の件は除く）。日報入力画面の最上部に出す。なければ何も出さない。 */
export function IssueBanner({
  issues,
  currentReportId,
  readOnly = false,
}: {
  issues: Issue[];
  currentReportId: string | null;
  /** 完了現場など、件を変更できないとき。「完了にする」ボタンを出さない。 */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = issues.filter((i) => i.status === 'open' && i.reportId !== currentReportId);
  if (shown.length === 0) return null;

  function done(id: string) {
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof setIssueDone>>;
      try {
        res = await setIssueDone(id, true);
      } catch {
        res = { ok: false, error: '処理に失敗しました。通信状況を確認してもう一度お試しください。' };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-label="対応中の重要事項"
      className="mb-4 rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50"
    >
      <h2 className="font-bold">対応中の重要事項（{shown.length}件）</h2>
      <ul className="mt-2 space-y-2">
        {shown.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 basis-48 whitespace-pre-wrap break-words text-sm">
              <span className="font-bold">{jpDate(i.reportDate)}</span>　{i.body}
            </p>
            {!readOnly && (
              <button
                type="button"
                onClick={() => done(i.id)}
                disabled={pending}
                aria-label={`${i.body}：完了にする`}
                className="min-h-11 shrink-0 rounded-lg border border-yellow-700 bg-white px-4 text-base font-bold text-yellow-950 disabled:opacity-50 dark:bg-yellow-900 dark:text-yellow-50"
              >
                完了にする
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500 bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
    </section>
  );
}
