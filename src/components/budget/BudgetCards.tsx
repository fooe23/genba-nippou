'use client';

import { useState, type ReactNode } from 'react';
import type { TradeRow } from '@/lib/budget/budget-model';
import { budgetManDaysSummary, manDaysText, outsideTag, profitClass, statusNote, statusTag, yenText } from '@/lib/budget/budget-view';
import { BudgetTable, totalContractNote, type BudgetViewProps } from './BudgetTable';
import { ProgressOverride } from './ProgressOverride';
import { TradeDetail } from './TradeDetail';
import { ProgressCell, Tag, smallTextClass } from './budget-parts';

const cardClass = 'rounded-lg border border-gray-300 p-3 dark:border-gray-700';

function Line({ label, children, valueClass = '' }: { label: ReactNode; children: ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="min-w-0 break-words">{label}</span>
      <span className={`min-w-0 break-words text-right tabular-nums ${valueClass}`}>{children}</span>
    </div>
  );
}

function OpenButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-blue-700 px-3 text-sm font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400"
    >
      {open ? '閉じる' : label}
    </button>
  );
}

function TradeCard({ t, siteId, history, canOverride, readOnly }: { t: TradeRow } & Omit<BudgetViewProps, 'model'>) {
  const [open, setOpen] = useState(false);
  const tag = statusTag(t.status);
  const summary = budgetManDaysSummary(t.budget.byPerformer);
  return (
    <li className={cardClass}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-base font-bold">{t.name}</h3>
        <span className="shrink-0 text-right">
          <Tag {...tag} />
          {statusNote(t) && <span className={smallTextClass}>{statusNote(t)}</span>}
        </span>
      </div>
      <div className="mt-1 text-sm">
        <Line label="内訳の金額">{yenText(t.contractAmount)}</Line>
        <Line label="実行予算">
          {yenText(t.budget.amount)}
          {summary && <span className={smallTextClass}>{summary}</span>}
        </Line>
        <Line label={`実績（${manDaysText(t.actual.manDays)}）`}>{yenText(t.actual.amount)}</Line>
        <Line label="進み具合">
          <ProgressCell progress={t.progress} />
        </Line>
        <Line label="このままの見込み">{yenText(t.forecast)}</Line>
        <Line label="見込みの粗利" valueClass={profitClass(t.forecastProfit)}>
          {yenText(t.forecastProfit)}
        </Line>
      </div>
      <OpenButton open={open} onClick={() => setOpen((v) => !v)} label="施工者・% の上書き・日報の作業を開く" />
      {open && (
        <div className="mt-3 space-y-3">
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
          <TradeDetail performers={t.budget.byPerformer} days={t.days} showPerformers />
        </div>
      )}
    </li>
  );
}

/** スマホのカード（md 未満）。中身はパソコンの表と同じ。 */
export function BudgetCards(props: BudgetViewProps) {
  const { model } = props;
  const { outside, siteWide, total } = model;
  const [outsideOpen, setOutsideOpen] = useState(false);
  const outTag = outsideTag(outside.amount);
  return (
    <ul className="space-y-3">
      {model.trades.map((t) => (
        <TradeCard key={t.tradeId} t={t} siteId={props.siteId} history={props.history} canOverride={props.canOverride} readOnly={props.readOnly} />
      ))}

      <li className={cardClass}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-base font-bold">
            予算外の作業
            <span className={`${smallTextClass} font-normal`}>常用・契約外・現場判断の件</span>
          </h3>
          {outTag && <Tag {...outTag} />}
        </div>
        <div className="mt-1 text-sm">
          <Line label="実行予算">{outside.budget.amount !== 0 ? yenText(outside.budget.amount) : '—'}</Line>
          <Line label={`実績（${manDaysText(outside.manDays)}）`}>{yenText(outside.amount)}</Line>
          {outside.amount !== 0 && (
            <Line label="見込みの粗利" valueClass={profitClass(-outside.amount)}>
              {yenText(-outside.amount)}
            </Line>
          )}
          {outside.carryover && (
            <Line
              label={
                <>
                  繰越（工種なし・{manDaysText(outside.carryover.manDays)}）
                  <span className={smallTextClass}>Excel から移したときの初期値</span>
                </>
              }
            >
              {yenText(outside.carryover.amount)}
            </Line>
          )}
        </div>
        <OpenButton open={outsideOpen} onClick={() => setOutsideOpen((v) => !v)} label="施工者・日報の作業を開く" />
        {outsideOpen && (
          <div className="mt-3">
            <TradeDetail performers={outside.byPerformer} days={outside.days} showPerformers />
          </div>
        )}
      </li>

      <li className={cardClass}>
        <h3 className="text-base font-bold">現場全体（材料・リース・燃料・その他）</h3>
        <div className="mt-1 text-sm">
          <Line label="内訳の経費">{yenText(siteWide.contractExpense)}</Line>
          <Line label="実行予算">
            {yenText(siteWide.budget.amount)}
            <span className={smallTextClass}>
              材料 {yenText(siteWide.budget.material)}・リース {yenText(siteWide.budget.lease)}・その他 {yenText(siteWide.budget.other)}
            </span>
          </Line>
          <Line label="実績">
            {yenText(siteWide.actual.amount)}
            <span className={smallTextClass}>
              燃料 {yenText(siteWide.actual.fuel)}・リース {yenText(siteWide.actual.lease)}
            </span>
            <span className={smallTextClass}>
              現金 {yenText(siteWide.actual.cash)}・掛け {yenText(siteWide.actual.credit)}
            </span>
          </Line>
        </div>
      </li>

      <li className={`${cardClass} border-2 border-blue-900 dark:border-blue-300`}>
        <h3 className="text-base font-bold">合計</h3>
        <div className="mt-1 text-sm font-bold">
          <Line label="内訳の金額">
            {yenText(total.contractAmount)}
            {totalContractNote(total) && <span className={`${smallTextClass} font-normal`}>{totalContractNote(total)}</span>}
          </Line>
          <Line label="実行予算">{yenText(total.budgetAmount)}</Line>
          <Line label={`実績（${manDaysText(total.actualManDays)}）`}>{yenText(total.actualAmount)}</Line>
        </div>
      </li>
    </ul>
  );
}

/** パソコンの表（md 以上）とスマホのカード（md 未満）。中身（model）を 1 回だけ渡すためにまとめる。 */
export function BudgetView(props: BudgetViewProps) {
  return (
    <>
      <div className="hidden md:block">
        <BudgetTable {...props} />
      </div>
      <div className="md:hidden">
        <BudgetCards {...props} />
      </div>
    </>
  );
}
