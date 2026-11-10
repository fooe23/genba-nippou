'use client';

import { useMemo } from 'react';
import { productivity, workAmount } from '@/lib/calc/report';
import type { SiteTrade } from '@/lib/budget/types';
import type { Issue } from '@/lib/db/reports';
import { CHANGE_KINDS, CHANGE_KIND_LABELS, INSTRUCTION_METHODS, INSTRUCTION_METHOD_LABELS, isChangeKind, isInstructionMethod } from '@/lib/report/change-labels';
import { issueInstruction, issueInstructionText } from '@/lib/report/issue-instructions';
import type { WorkLine } from '@/lib/types';
import { decimal, isManualRow, money, newLine, patchRow, removeRow, row, selectRow, type Row } from '../form-state';
import { Computed, fieldClass, NumInput, Select, TextInput, type SelectOption } from '../inputs';
import { LineTable, type Column } from '../LineTable';
import { IssuePicker } from './IssuePicker';
import { LineIssueCreator } from './LineIssueCreator';
import { issueOptions } from '@/lib/report/issue-options';
import { missingSettlementAmount } from '@/lib/report/contract-work';
import { MISSING_AMOUNT_NOTE, MISSING_AMOUNT_WARNING } from '@/lib/reports/settlement-breakdown';

const MANUAL_TRADE = '__manual__';

const methodOptions: SelectOption[] = INSTRUCTION_METHODS.map((m) => ({ value: m, label: INSTRUCTION_METHOD_LABELS[m] }));

/**
 * 工種の欄（現場に実行予算の工種があるとき）：工種の選択＋「（手入力）」の文字の欄。
 * 工種を選ぶと siteTradeId と工種の文字（工種の名前）を入れる。手入力にすると siteTradeId を外し、文字はそのまま直せる。
 * いまの工種に無い参照の行（工種が消えた下書きなど）は文字の欄と注記を出す（文字を直すと参照を外す）。
 */
function TradeCell({
  line,
  index,
  row: r,
  trades,
  select,
}: {
  line: WorkLine;
  index: number;
  row: Row<WorkLine>;
  trades: SiteTrade[];
  select: (i: number, patch: Partial<WorkLine>, manual: boolean) => void;
}) {
  const known = line.siteTradeId !== null && trades.some((t) => t.id === line.siteTradeId);
  const stale = line.siteTradeId !== null && !known;
  const manual = stale || isManualRow(r, line.siteTradeId, line.trade);
  const options: SelectOption[] = [...trades.map((t) => ({ value: t.id, label: t.name })), { value: MANUAL_TRADE, label: '（手入力）' }];
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="sr-only">工種（{index + 1}行目）</span>
        <Select
          value={line.siteTradeId ?? (manual ? MANUAL_TRADE : '')}
          options={options}
          missingLabel="（実行予算に無い工種）"
          onChange={(v) => {
            const t = trades.find((x) => x.id === v);
            if (t) select(index, { siteTradeId: t.id, trade: t.name }, false);
            else if (v === MANUAL_TRADE) select(index, { siteTradeId: null }, true);
            else select(index, { siteTradeId: null, trade: '' }, false);
          }}
        />
      </label>
      {manual && (
        <label className="block">
          <span className="sr-only">工種の文字（{index + 1}行目）</span>
          <TextInput value={line.trade} maxLength={200} placeholder="工種" onChange={(v) => select(index, { trade: v, siteTradeId: null }, true)} />
        </label>
      )}
      {stale && (
        <p className="text-xs text-amber-800 dark:text-amber-300">選んでいた工種が実行予算にありません。工種を選び直すか、手入力にしてください。</p>
      )}
    </div>
  );
}

/** 作業内容の行の id（提出を断られたときのスクロール先）。 */
export function workRowId(index: number): string {
  return `work-row-${index}`;
}

function SubField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

/**
 * 作業内容（出来高）の表。歩掛 = 施工数量 ÷ 投入人工、合計金額 = 施工数量 × 施工単価。
 * 区分が追加・増・変更・減の行は、行の下に「精算が必要」の印と、指示者・指示方法・指示日・根拠の件の欄を出す（契約内に戻しても値は消さず、欄を隠すだけ）。
 * 根拠の件を選んだ行は、指示者・指示方法・指示日を件から入れ、欄の代わりに「指示：…（件から）」を出す（2026-11-08）。
 */
export function WorkTable({
  rows,
  onChange,
  units,
  issues,
  flagged,
  reportId,
  onIssueCreated,
  readOnly = false,
  trades = [],
}: {
  rows: Row<WorkLine>[];
  onChange: (update: (rows: Row<WorkLine>[]) => Row<WorkLine>[]) => void;
  units: string[];
  /** 根拠の件の候補（この日報の件と、現場の対応中の件）。 */
  issues: Issue[];
  /** 赤枠で示す行（作業内容の行の添字）。提出を断られた、件を選んでいない追加・増・変更・減の行。 */
  flagged?: ReadonlySet<number>;
  /** 保存済みの日報の id（「この行の件を作る」に使う。未保存なら null）。 */
  reportId: string | null;
  /** 行から件を作ったあと（件の候補を読み直す）。 */
  onIssueCreated: () => void;
  /** 提出済み・承認済みなど、日報を直せないとき。「この行の件を作る」を出さない。 */
  readOnly?: boolean;
  /** 現場の実行予算の工種。1 つ以上あれば工種の欄を選択（＋手入力）にする。空なら文字の欄だけ。 */
  trades?: SiteTrade[];
}) {
  const set = (i: number, patch: Partial<WorkLine>) => onChange((rs) => patchRow(rs, i, patch));
  // 工種の選び直しと手入力の文字：「（手入力）」の印（Row.manual）も一緒に付け外しする。
  const select = (i: number, patch: Partial<WorkLine>, manual: boolean) => onChange((rs) => selectRow(rs, i, patch, manual));
  const unitOptions = units.map((u) => ({ value: u, label: u }));
  const issueChoices = useMemo(() => issueOptions(issues), [issues]);
  const issuesById = new Map(issues.map((x) => [x.id, x]));
  // 根拠の件を選んだら、指示者・指示方法・指示日を件から入れる（保存時もサーバーが同じ値で上書きする）。
  const pickIssue = (i: number, id: string) => {
    const issue = id === '' ? undefined : issuesById.get(id);
    set(i, id === '' ? { issueId: null } : issue ? { issueId: id, ...issueInstruction(issue) } : { issueId: id });
  };

  const columns: Column<WorkLine>[] = [
    trades.length > 0
      ? {
          label: '工種',
          wide: true,
          // 選択と手入力の文字の 2 つの欄になるので、それぞれに label を付ける。
          input: false,
          cell: (l, i, r) => <TradeCell line={l} index={i} row={r} trades={trades} select={select} />,
        }
      : { label: '工種', wide: true, cell: (l, i) => <TextInput value={l.trade} maxLength={200} onChange={(v) => set(i, { trade: v })} /> },
    {
      label: '区分',
      wide: true,
      cell: (l, i) => (
        <select
          value={l.changeKind}
          onChange={(e) => set(i, { changeKind: isChangeKind(e.target.value) ? e.target.value : 'contract' })}
          className={fieldClass}
        >
          {CHANGE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHANGE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      ),
    },
    { label: '施工内容', wide: true, cell: (l, i) => <TextInput value={l.description} maxLength={200} onChange={(v) => set(i, { description: v })} /> },
    { label: '施工数量', cell: (l, i) => <NumInput value={l.qty} onChange={(v) => set(i, { qty: v })} /> },
    { label: '単位', cell: (l, i) => <Select value={l.unit} options={unitOptions} placeholder="—" onChange={(v) => set(i, { unit: v })} /> },
    { label: '投入人工', cell: (l, i) => <NumInput value={l.manDays} onChange={(v) => set(i, { manDays: v })} /> },
    { label: '施工単価', cell: (l, i) => <NumInput value={l.unitPrice} onChange={(v) => set(i, { unitPrice: v })} /> },
    { label: '歩掛', input: false, cell: (l) => <Computed>{decimal(productivity(l.qty, l.manDays))}</Computed> },
    { label: '合計金額', input: false, cell: (l) => <Computed>{money(workAmount(l))}</Computed> },
  ];

  return (
    <LineTable
      title="作業内容"
      rows={rows}
      columns={columns}
      gridClass="md:grid-cols-[minmax(7rem,1fr)_5.5rem_minmax(9rem,2fr)_6rem_5rem_5.5rem_6.5rem_4.5rem_6.5rem_4.5rem]"
      minWidthClass="md:min-w-[65rem]"
      rowId={workRowId}
      rowClass={(_, i) => (flagged?.has(i) ? 'outline-2 -outline-offset-2 outline-red-600 md:rounded-lg md:px-2 dark:outline-red-500' : '')}
      rowExtra={(l, i) => {
        if (l.changeKind === 'contract') return null;
        // 根拠の件が候補にある行は、指示者・指示方法・指示日の欄を出さず件の値を見せる（候補に無い件なら欄を出す）。
        const linkedIssue = l.issueId ? issuesById.get(l.issueId) : undefined;
        return (
          <div role="group" aria-label={`${i + 1}行目の${CHANGE_KIND_LABELS[l.changeKind]}の指示`}>
            {/* 契約外の行（あとで件ごとに精算する）を目立たせる。 */}
            <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-amber-600 bg-amber-100 px-2.5 py-0.5 font-bold text-amber-900 dark:border-amber-400 dark:bg-amber-900 dark:text-amber-50">
                精算が必要
              </span>
              <span className="text-gray-700 dark:text-gray-300">契約外（{CHANGE_KIND_LABELS[l.changeKind]}）の作業です。</span>
            </p>
            {/* 件の精算の労務は施工金額（数量 × 施工単価）から出すので、無ければ知らせる（保存は止めない）。 */}
            {missingSettlementAmount(l, linkedIssue) && (
              <p role="note" className="mb-2 flex items-start gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-300">
                <span aria-hidden="true">⚠</span>
                <span>
                  {MISSING_AMOUNT_WARNING}。<span className="font-normal">{MISSING_AMOUNT_NOTE}</span>
                </span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {linkedIssue ? null : (
                <>
                  <SubField label="指示者">
                    <TextInput value={l.instructedBy} maxLength={100} placeholder="例：施主 山田様" onChange={(v) => set(i, { instructedBy: v })} />
                  </SubField>
                  <SubField label="指示方法">
                    <Select
                      value={l.instructionMethod ?? ''}
                      options={methodOptions}
                      placeholder="—"
                      onChange={(v) => set(i, { instructionMethod: isInstructionMethod(v) ? v : null })}
                    />
                  </SubField>
                  <SubField label="指示日">
                    <input
                      type="date"
                      value={l.instructedOn ?? ''}
                      onChange={(e) => set(i, { instructedOn: e.target.value === '' ? null : e.target.value })}
                      className={fieldClass}
                    />
                  </SubField>
                </>
              )}
              <SubField label="根拠の件">
                <IssuePicker value={l.issueId} options={issueChoices} onChange={(v) => pickIssue(i, v ?? '')} />
                {flagged?.has(i) && <span className="mt-0.5 block text-sm font-bold text-red-700 dark:text-red-400">件を選んでください</span>}
              </SubField>
              {linkedIssue && (
                <p className="col-span-2 self-end pb-2 text-sm text-gray-700 md:col-span-3 dark:text-gray-300">{issueInstructionText(linkedIssue)}</p>
              )}
            </div>
            {!l.issueId && !readOnly && (
              <LineIssueCreator
                line={l}
                rowNumber={i + 1}
                reportId={reportId}
                onCreated={(id) => {
                  set(i, { issueId: id });
                  onIssueCreated();
                }}
              />
            )}
          </div>
        );
      }}
      onAdd={() => onChange((rs) => [...rs, row(newLine.work())])}
      onRemove={(i) => onChange((rs) => removeRow(rs, i))}
      subtotalLabel="出来高 小計"
      subtotal={money(rows.reduce((s, r) => s + workAmount(r.line), 0))}
      emptyText="作業内容はまだありません。"
    />
  );
}
