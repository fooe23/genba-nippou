'use client';

import { useState } from 'react';
import type { AttendanceRow, PerformerRow, TradeDay } from '@/lib/budget/budget-model';
import { attendanceText, manDaysText, performerForecastNote, performerLabel, subcontractTag, yenText } from '@/lib/budget/budget-view';
import { jpDate } from '@/lib/calc/format';
import { Tag, smallTextClass } from './budget-parts';

const DAYS_FIRST = 20;

/** 施工者の行の「予算・実績」の文字（例「¥900,000（45.0 人工）」。請負の行は金額だけ）。 */
export function performerBudgetText(p: PerformerRow): string {
  return p.budgetManDays !== null ? `${yenText(p.budgetAmount)}（${manDaysText(p.budgetManDays)}）` : yenText(p.budgetAmount);
}
export function performerActualText(p: PerformerRow): string {
  return p.item === 'subcontract' ? yenText(p.actualAmount) : `${yenText(p.actualAmount)}（${manDaysText(p.actualManDays)}）`;
}

/** 施工者の行の鍵（同じ会社の請負と常用は別の行）。 */
export function performerKey(p: PerformerRow): string {
  return `${p.item}:${p.supplierId ?? p.name}`;
}

/** 施工者の見出し（「東北建興・請負」など）と、請負の札。 */
export function PerformerName({ p }: { p: PerformerRow }) {
  const tag = p.item === 'subcontract' ? subcontractTag(p) : null;
  return (
    <>
      <span className="font-medium">{performerLabel(p)}</span>
      {tag && (
        <span className="mt-0.5 block">
          <Tag {...tag} />
        </span>
      )}
    </>
  );
}

function Pair({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <span className="flex flex-wrap justify-between gap-x-3">
      <span>{label}</span>
      <span className="text-right tabular-nums">
        {value}
        {note && <span className={smallTextClass}>{note}</span>}
      </span>
    </span>
  );
}

/** 請負の行のカード：請負額／支払い（うち追加の発注）／見込み。 */
function SubcontractCard({ p, showForecast }: { p: PerformerRow; showForecast: boolean }) {
  return (
    <li className="rounded-lg bg-gray-50 p-2 text-sm dark:bg-gray-900">
      <PerformerName p={p} />
      <span className="mt-1 block space-y-0.5">
        <Pair label="請負額（実行予算）" value={yenText(p.budgetAmount)} />
        <Pair
          label="支払い（外注の買掛）"
          value={yenText(p.actualAmount)}
          note={p.issuePaid !== 0 ? `うち追加の発注（件） ${yenText(p.issuePaid)}` : undefined}
        />
        {showForecast && <Pair label="見込み" value={yenText(p.forecast)} note={performerForecastNote(p)} />}
      </span>
    </li>
  );
}

/** 労務・常用の行のカード：実行予算／実績／見込み。 */
function LaborCard({ p, showForecast }: { p: PerformerRow; showForecast: boolean }) {
  return (
    <li className="rounded-lg bg-gray-50 p-2 text-sm dark:bg-gray-900">
      <PerformerName p={p} />
      <span className="mt-1 block space-y-0.5">
        <Pair label="実行予算" value={performerBudgetText(p)} />
        <Pair label="実績" value={performerActualText(p)} />
        {showForecast && <Pair label="見込み" value={yenText(p.forecast)} note={p.forecast !== null ? performerForecastNote(p) : undefined} />}
      </span>
    </li>
  );
}

/** 施工者ごとの予算と実績（カード・予算外で使う）。請負と人工（自社・常用）を 2 つのまとまりに分ける。 */
function PerformerList({ performers, attendance, showForecast }: { performers: PerformerRow[]; attendance: AttendanceRow[]; showForecast: boolean }) {
  if (performers.length === 0) return <p className="text-sm text-gray-600 dark:text-gray-400">施工者の行はありません。</p>;
  const subs = performers.filter((p) => p.item === 'subcontract');
  const labor = performers.filter((p) => p.item !== 'subcontract');
  const att = attendanceText(attendance);
  return (
    <div className="space-y-3">
      {subs.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300">請負（外注の支払い）</h5>
          <ul className="space-y-2">
            {subs.map((p) => (
              <SubcontractCard key={performerKey(p)} p={p} showForecast={showForecast} />
            ))}
          </ul>
        </div>
      )}
      {labor.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-xs font-bold text-gray-700 dark:text-gray-300">人工（自社・常用）</h5>
          <ul className="space-y-2">
            {labor.map((p) => (
              <LaborCard key={performerKey(p)} p={p} showForecast={showForecast} />
            ))}
          </ul>
        </div>
      )}
      {att && <p className="text-xs text-gray-700 dark:text-gray-300">{att}（請負の人工は出面だけで、原価に数えません）</p>}
    </div>
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
                {d.subcontract !== 0 && `・外注 ${yenText(d.subcontract)}`}
              </span>
            </span>
            {d.lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-gray-700 dark:text-gray-300">
                {d.lines.map((l, i) => (
                  <li key={i} className="break-words">
                    {[l.trade.trim() || '（工種の文字なし）', l.description.trim()].filter(Boolean).join('：')}
                    {l.qty !== null && `　${l.qty} ${l.unit}`}
                    {`　投入 ${l.manDays === null ? '—' : manDaysText(l.manDays)}`}
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
  attendance,
  days,
  showPerformers,
  showForecast = true,
}: {
  performers: PerformerRow[];
  attendance: AttendanceRow[];
  days: TradeDay[];
  showPerformers: boolean;
  /** 施工者の見込みを出すか（予算外の作業は見込みを出さない）。 */
  showForecast?: boolean;
}) {
  return (
    <div className="space-y-3">
      {showPerformers && (
        <section className="space-y-2">
          <h4 className="text-sm font-bold">施工者ごと</h4>
          <PerformerList performers={performers} attendance={attendance} showForecast={showForecast} />
        </section>
      )}
      <section className="space-y-2">
        <h4 className="text-sm font-bold">日報の作業</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          人工・金額は、1 日の労務費・人工を作業内容の行の投入人工の比などで振り分けた分です（請負の人工は原価に数えません）。外注は、その日の外注の買掛のうちこの工種の分です。
        </p>
        <DayList days={days} />
      </section>
    </div>
  );
}
