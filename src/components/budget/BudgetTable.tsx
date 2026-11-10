'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type { AttendanceRow, BudgetModel, PerformerRow, TradeRow } from '@/lib/budget/budget-model';
import {
  attendanceText,
  budgetManDaysSummary,
  performerForecastNote,
  tradeSubcontractTag,
  manDaysText,
  outsideTag,
  profitClass,
  statusNote,
  statusTag,
  yenText,
  type ProgressHistoryEntry,
} from '@/lib/budget/budget-view';
import { ProgressOverride } from './ProgressOverride';
import { PerformerName, TradeDetail, performerActualText, performerBudgetText, performerKey } from './TradeDetail';
import { ProgressCell, Tag, smallTextClass } from './budget-parts';

export interface BudgetViewProps {
  siteId: string;
  model: BudgetModel;
  /** 工種ごとの進み具合の上書きの履歴（新しい順）。 */
  history: Record<string, ProgressHistoryEntry[]>;
  canOverride: boolean;
  readOnly: boolean;
}

const OUTSIDE_KEY = '__outside__';
const COLS = 8;
const td = 'border-b border-gray-200 px-2 py-2 text-right align-top tabular-nums whitespace-nowrap dark:border-gray-700';
const tdFirst = 'border-b border-gray-200 px-2 py-2 text-left align-top dark:border-gray-700';
const subTd = `${td} bg-gray-50 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300`;
const subTdFirst = `${tdFirst} bg-gray-50 pl-6 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300`;

/** 工種名のボタン（押すと施工者の行と日報の作業を開く）。 */
function ToggleName({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="flex min-h-11 w-full items-start gap-1 text-left font-bold text-blue-800 underline-offset-2 hover:underline dark:text-blue-300"
    >
      <span aria-hidden="true" className="w-4 shrink-0">
        {open ? '▾' : '▸'}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </button>
  );
}

function Amount({ value, sub }: { value: string; sub?: string }) {
  return (
    <>
      {value}
      {sub && <span className={smallTextClass}>{sub}</span>}
    </>
  );
}

/** 施工者の行（請負：請負額／支払い／見込み、労務・常用：予算／実績／見込み）と出面の 1 行。 */
function PerformerSubRows({ performers, attendance, showForecast }: { performers: PerformerRow[]; attendance: AttendanceRow[]; showForecast: boolean }) {
  const att = attendanceText(attendance);
  return (
    <>
      {performers.map((p) => (
        <tr key={performerKey(p)}>
          <td className={subTdFirst}>
            <PerformerName p={p} />
          </td>
          <td className={subTd} />
          <td className={subTd}>
            <Amount value={performerBudgetText(p)} sub={p.item === 'subcontract' ? '請負額' : undefined} />
          </td>
          <td className={subTd}>
            <Amount
              value={performerActualText(p)}
              sub={p.item === 'subcontract' ? (p.issuePaid !== 0 ? `支払い（うち追加の発注 ${yenText(p.issuePaid)}）` : '支払い（外注の買掛）') : undefined}
            />
          </td>
          <td className={subTd} />
          <td className={subTd}>{showForecast && <Amount value={yenText(p.forecast)} sub={p.forecast !== null ? performerForecastNote(p) : undefined} />}</td>
          <td className={subTd} colSpan={2} />
        </tr>
      ))}
      {att && (
        <tr>
          <td colSpan={COLS} className={`${subTdFirst} text-xs`}>
            {att}（請負の人工は出面だけで、原価に数えません）
          </td>
        </tr>
      )}
    </>
  );
}

function DetailRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={COLS} className="border-b border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
        <div className="grid gap-3 xl:grid-cols-2">{children}</div>
      </td>
    </tr>
  );
}

/**
 * パソコンの表（md 以上）：工種ごとに 内訳の金額・実行予算・実績・進み具合・このままの見込み・見込みの粗利・判定。
 * 工種名を押すと施工者の行・進み具合の上書き・日報の作業を開く。幅が足りなければ表の中で横に動かす。
 */
export function BudgetTable({ siteId, model, history, canOverride, readOnly }: BudgetViewProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { outside, siteWide, total } = model;
  const outTag = outsideTag(outside.amount);

  const tradeRow = (t: TradeRow) => {
    const isOpen = open.has(t.tradeId);
    const tag = statusTag(t.status);
    const subTag = tradeSubcontractTag(t);
    return (
      <Fragment key={t.tradeId}>
        <tr>
          <td className={`${tdFirst} min-w-40`}>
            <ToggleName open={isOpen} onClick={() => toggle(t.tradeId)}>
              {t.name}
            </ToggleName>
          </td>
          <td className={td}>{yenText(t.contractAmount)}</td>
          <td className={td}>
            <Amount value={yenText(t.budget.amount)} sub={budgetManDaysSummary(t.budget.byPerformer) || undefined} />
          </td>
          <td className={td}>
            <Amount value={yenText(t.actual.amount)} sub={manDaysText(t.actual.manDays)} />
          </td>
          <td className={td}>
            <ProgressCell progress={t.progress} />
          </td>
          <td className={td}>{yenText(t.forecast)}</td>
          <td className={`${td} ${profitClass(t.forecastProfit)}`}>{yenText(t.forecastProfit)}</td>
          <td className={`${td} text-left`}>
            <Tag {...tag} />
            {statusNote(t) && <span className={smallTextClass}>{statusNote(t)}</span>}
            {subTag && (
              <span className="mt-1 block">
                <Tag {...subTag} />
              </span>
            )}
          </td>
        </tr>
        {isOpen && (
          <>
            <PerformerSubRows performers={t.budget.byPerformer} attendance={t.attendance} showForecast />
            <DetailRow>
              <ProgressOverride
                siteId={siteId}
                tradeId={t.tradeId}
                tradeName={t.name}
                override={t.progress.override}
                fromQty={t.progress.fromQty}
                history={history[t.tradeId] ?? []}
                canOverride={canOverride}
                readOnly={readOnly}
              />
              <TradeDetail performers={t.budget.byPerformer} attendance={t.attendance} days={t.days} showPerformers={false} />
            </DetailRow>
          </>
        )}
      </Fragment>
    );
  };

  const outsideOpen = open.has(OUTSIDE_KEY);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-gray-700">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100 text-xs dark:bg-slate-800">
            <th scope="col" className="px-2 py-2 text-left">工種</th>
            <th scope="col" className="px-2 py-2 text-right">内訳の金額</th>
            <th scope="col" className="px-2 py-2 text-right">実行予算</th>
            <th scope="col" className="px-2 py-2 text-right">実績（いままで）</th>
            <th scope="col" className="px-2 py-2 text-right">進み具合</th>
            <th scope="col" className="px-2 py-2 text-right">このままの見込み</th>
            <th scope="col" className="px-2 py-2 text-right">見込みの粗利</th>
            <th scope="col" className="px-2 py-2 text-left">
              <span className="sr-only">判定</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {model.trades.map(tradeRow)}

          <tr>
            <td className={tdFirst}>
              <ToggleName open={outsideOpen} onClick={() => toggle(OUTSIDE_KEY)}>
                予算外の作業
              </ToggleName>
              <span className={`${smallTextClass} pl-5`}>常用・契約外・現場判断の件</span>
              {outside.subcontractPaid !== 0 && (
                <span className={`${smallTextClass} pl-5`}>
                  工種なしの外注 {yenText(outside.subcontractPaid)}（日報の外注の行で工種を選んでください）
                </span>
              )}
            </td>
            <td className={td}>—</td>
            <td className={td}>{outside.budget.amount !== 0 ? yenText(outside.budget.amount) : '—'}</td>
            <td className={td}>
              <Amount value={yenText(outside.amount)} sub={manDaysText(outside.manDays)} />
            </td>
            <td className={td} />
            <td className={td} />
            <td className={`${td} ${outside.amount !== 0 ? profitClass(-outside.amount) : ''}`}>
              {outside.amount !== 0 ? yenText(-outside.amount) : ''}
            </td>
            <td className={`${td} text-left`}>{outTag && <Tag {...outTag} />}</td>
          </tr>
          {outsideOpen && (
            <>
              <PerformerSubRows performers={outside.byPerformer} attendance={outside.attendance} showForecast={false} />
              <tr>
                <td colSpan={COLS} className="border-b border-gray-200 bg-gray-50 px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                  <TradeDetail performers={outside.byPerformer} attendance={outside.attendance} days={outside.days} showPerformers={false} />
                </td>
              </tr>
            </>
          )}
          {outside.carryover && (
            <tr>
              <td className={subTdFirst}>
                繰越（工種なし）
                <span className={smallTextClass}>Excel から移したときの初期値</span>
              </td>
              <td className={subTd} />
              <td className={subTd} />
              <td className={subTd}>
                <Amount value={yenText(outside.carryover.amount)} sub={manDaysText(outside.carryover.manDays)} />
              </td>
              <td className={subTd} colSpan={4} />
            </tr>
          )}

          <tr>
            <td className={`${tdFirst} font-bold`}>現場全体（材料・リース・燃料・その他）</td>
            <td className={td}>経費 {yenText(siteWide.contractExpense)}</td>
            <td className={td}>
              <Amount
                value={yenText(siteWide.budget.amount)}
                sub={`材料 ${yenText(siteWide.budget.material)}・リース ${yenText(siteWide.budget.lease)}・その他 ${yenText(siteWide.budget.other)}`}
              />
            </td>
            <td className={td}>
              <Amount
                value={yenText(siteWide.actual.amount)}
                sub={`燃料 ${yenText(siteWide.actual.fuel)}・リース ${yenText(siteWide.actual.lease)}・現金 ${yenText(siteWide.actual.cash)}・買掛（仕入） ${yenText(siteWide.actual.credit)}`}
              />
            </td>
            <td className={td} colSpan={4} />
          </tr>

          <tr className="border-t-2 border-blue-900 font-bold dark:border-blue-300">
            <td className={tdFirst}>合計</td>
            <td className={td}>
              <Amount value={yenText(total.contractAmount)} sub={totalContractNote(total) || undefined} />
            </td>
            <td className={td}>{yenText(total.budgetAmount)}</td>
            <td className={td}>
              <Amount value={yenText(total.actualAmount)} sub={manDaysText(total.actualManDays)} />
            </td>
            <td className={td} colSpan={4} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 合計の内訳の金額の注記（減分・工種を付けていない行があれば）。 */
export function totalContractNote(total: BudgetModel['total']): string {
  const parts: string[] = [];
  if (total.contractReduction !== 0) parts.push(`減分 ${yenText(total.contractReduction)}`);
  if (total.contractUnassigned !== 0) parts.push(`工種なし ${yenText(total.contractUnassigned)}`);
  return parts.join('・');
}
