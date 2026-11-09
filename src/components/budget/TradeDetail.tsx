'use client';

import { useState } from 'react';
import type { PerformerRow, TradeDay } from '@/lib/budget/budget-model';
import { manDaysText, yenText } from '@/lib/budget/budget-view';
import { jpDate } from '@/lib/calc/format';
import { smallTextClass } from './budget-parts';

const DAYS_FIRST = 20;

/** 施工者の行の「予算・実績」の文字（例「¥900,000（45.0 人工）」）。 */
export function performerBudgetText(p: PerformerRow): string {
  return p.budgetManDays !== null ? `${yenText(p.budgetAmount)}（${manDaysText(p.budgetManDays)}）` : yenText(p.budgetAmount);
}
export function performerActualText(p: PerformerRow): string {
  return `${yenText(p.actualAmount)}（${manDaysText(p.actualManDays)}）`;
}

/** 施工者の名前と、協力会社の請負金額の注記（現場全体の額。工種に分けていない）。 */
export function PerformerName({ p }: { p: PerformerRow }) {
  return (
    <>
      <span className="font-medium">{p.performer === 'partner' ? `${p.name}（協力会社）` : p.name}</span>
      {p.partnerContract !== null && (
        <span className={smallTextClass}>請負金額 {yenText(p.partnerContract)}（現場全体の額。工種に分けていません）</span>
      )}
    </>
  );
}

/** 施工者ごとの予算と実績（カード・予算外の行で使う一覧）。 */
function PerformerList({ performers }: { performers: PerformerRow[] }) {
  if (performers.length === 0) return <p className="text-sm text-gray-600 dark:text-gray-400">施工者の行はありません。</p>;
  return (
    <ul className="space-y-2">
      {performers.map((p) => (
        <li key={`${p.performer}:${p.supplierId ?? ''}`} className="rounded-lg bg-gray-50 p-2 text-sm dark:bg-gray-900">
          <PerformerName p={p} />
          <span className="mt-1 flex flex-wrap justify-between gap-x-3">
            <span>実行予算</span>
            <span className="tabular-nums">{performerBudgetText(p)}</span>
          </span>
          <span className="flex flex-wrap justify-between gap-x-3">
            <span>実績</span>
            <span className="tabular-nums">{performerActualText(p)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 日報の作業（日付・作業内容の行・振り分けた人工・労務費）。新しい日から。 */
function DayList({ days }: { days: TradeDay[] }) {
  const [all, setAll] = useState(false);
  if (days.length === 0) return <p className="text-sm text-gray-600 dark:text-gray-400">日報の作業はまだありません。</p>;
  const sorted = [...days].reverse();
  const shown = all ? sorted : sorted.slice(0, DAYS_FIRST);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {shown.map((d) => (
          <li key={d.date} className="p-2 text-sm">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-bold">{jpDate(d.date)}</span>
              <span className="tabular-nums">
                {manDaysText(d.manDays)}・{yenText(d.amount)}
              </span>
            </span>
            {d.lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-gray-700 dark:text-gray-300">
                {d.lines.map((l, i) => (
                  <li key={i} className="break-words">
                    {[l.trade.trim() || '（工種の文字なし）', l.description.trim()].filter(Boolean).join('：')}
                    {l.qty !== null && `　${l.qty} ${l.unit}`}
                    {`　投入 ${manDaysText(l.manDays)}`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {sorted.length > DAYS_FIRST && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="min-h-11 rounded-lg border border-gray-400 px-3 text-sm font-medium dark:border-gray-600"
        >
          {all ? `新しい ${DAYS_FIRST} 日だけ表示` : `すべての日を表示（${sorted.length} 日）`}
        </button>
      )}
    </div>
  );
}

/**
 * 工種（または予算外の作業）を開いたときの中身：施工者ごとの予算と実績（showPerformers のとき。パソコンの表は
 * 表の行で出すので出さない）と、その工種の日報の作業。人工・労務費は工種に振り分けた分。
 */
export function TradeDetail({
  performers,
  days,
  showPerformers,
}: {
  performers: PerformerRow[];
  days: TradeDay[];
  showPerformers: boolean;
}) {
  return (
    <div className="space-y-3">
      {showPerformers && (
        <section className="space-y-2">
          <h4 className="text-sm font-bold">施工者ごと</h4>
          <PerformerList performers={performers} />
        </section>
      )}
      <section className="space-y-2">
        <h4 className="text-sm font-bold">日報の作業</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          人工・金額は、1 日の労務費・人工を作業内容の行の投入人工の比などで振り分けた分です。
        </p>
        <DayList days={days} />
      </section>
    </div>
  );
}
