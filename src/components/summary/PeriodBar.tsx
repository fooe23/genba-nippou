'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { nextMonth, prevMonth } from '@/lib/calc/calendar';

const navButtonClass =
  'min-h-11 rounded-lg border border-gray-400 px-3 text-base font-medium dark:border-gray-600';

/** 集計の期間切替。月送り（◀ 前月 / 翌月 ▶）と「工期全体」の切替。?period= を書き換え、?tab= は保つ。 */
export function PeriodBar({ period, currentMonth }: { period: string; currentMonth: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const isAll = period === 'all';

  function go(next: string) {
    const q = new URLSearchParams(params.toString());
    q.set('period', next);
    router.replace(`${pathname}?${q.toString()}`);
  }

  const [y, m] = isAll ? [0, 0] : period.split('-').map(Number);

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(prevMonth(period))} disabled={isAll} className={`${navButtonClass} disabled:opacity-40`}>
          ◀ 前月
        </button>
        <h2 className="text-lg font-bold" aria-live="polite">
          {isAll ? '工期全体' : `${y}年${m}月`}
        </h2>
        <button type="button" onClick={() => go(nextMonth(period))} disabled={isAll} className={`${navButtonClass} disabled:opacity-40`}>
          翌月 ▶
        </button>
      </div>
      <button
        type="button"
        aria-pressed={isAll}
        onClick={() => go(isAll ? currentMonth : 'all')}
        className={`min-h-11 w-full rounded-lg border px-4 text-base font-bold ${
          isAll
            ? 'border-blue-700 bg-blue-700 text-white'
            : 'border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400'
        }`}
      >
        {isAll ? '月別に戻す' : '工期全体を表示'}
      </button>
    </div>
  );
}
