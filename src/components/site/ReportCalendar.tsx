'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { monthGrid, nextMonth, prevMonth } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import { visitNumbers } from '@/lib/calc/visit';
import type { ReportHead } from '@/lib/db/reports';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, type DayStatus } from './status';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const navButtonClass =
  'min-h-11 rounded-lg border border-gray-400 px-3 text-base font-medium dark:border-gray-600';

/** 日報カレンダー。日をタップするとその日の日報入力画面へ移動する。 */
export function ReportCalendar({ siteId, heads, today }: { siteId: string; heads: ReportHead[]; today: string }) {
  const [month, setMonth] = useState(monthKey(today));
  const byDate = useMemo(() => new Map(heads.map((h) => [h.reportDate, h])), [heads]);
  const allDates = useMemo(() => heads.map((h) => h.reportDate), [heads]);
  const { dates } = monthGrid(month);
  const [y, m] = month.split('-').map(Number);

  return (
    <section aria-label="日報カレンダー">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setMonth(prevMonth(month))} className={navButtonClass}>
          ◀ 前月
        </button>
        <h2 className="text-lg font-bold">
          {y}年{m}月
        </h2>
        <button type="button" onClick={() => setMonth(nextMonth(month))} className={navButtonClass}>
          翌月 ▶
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-1 text-center text-sm font-bold ${
              i === 0 ? 'text-red-700 dark:text-red-400' : i === 6 ? 'text-blue-700 dark:text-blue-400' : ''
            }`}
          >
            {w}
          </div>
        ))}
        {dates.map((date, i) => {
          if (date === null) return <div key={`blank-${i}`} aria-hidden="true" />;
          const head = byDate.get(date);
          const status: DayStatus = head ? head.status : 'none';
          const day = Number(date.slice(8, 10));
          const isToday = date === today;
          const visit = head ? visitNumbers(allDates, date).monthIndex : null;
          return (
            <Link
              key={date}
              href={`/sites/${siteId}/reports/${date}`}
              aria-label={`${m}月${day}日 ${STATUS_LABEL[status]}${visit !== null ? ` 当月${visit}回目` : ''}${isToday ? ' 今日' : ''}`}
              className={`flex min-h-14 flex-col items-center justify-start rounded-md border px-0.5 py-1 ${STATUS_COLOR[status]} ${
                isToday ? 'ring-2 ring-offset-1 ring-gray-900 dark:ring-white' : ''
              }`}
            >
              <span className="text-base font-bold leading-tight">{day}</span>
              {visit !== null && <span className="text-[11px] leading-tight">{visit}回目</span>}
            </Link>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="凡例">
        {STATUS_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block size-4 rounded border ${STATUS_COLOR[s]}`} />
            {STATUS_LABEL[s]}
          </li>
        ))}
      </ul>
    </section>
  );
}
