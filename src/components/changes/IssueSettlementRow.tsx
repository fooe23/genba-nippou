'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { jpDate } from '@/lib/calc/format';
import { updateIssueSettlement } from '@/lib/db/reports-actions';
import { issueSettlementSchema } from '@/lib/db/issue-schemas';
import { INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS, SETTLEMENT_METHODS, SETTLEMENT_METHOD_LABELS, isSettlementMethod } from '@/lib/report/change-labels';
import type { ChangesIssueRow } from '@/lib/reports/changes-page';
import type { SettlementMethod } from '@/lib/types';
import { money } from '@/components/report/form-state';
import { NumInput, fieldClass } from '@/components/report/inputs';
import { ErrorText, primaryButtonClass, useRunner } from '@/components/masters/common';
import { CHANGES_GRID, CHANGES_ROW, Cell, ComputedCells, InputCell, KindTag } from '@/components/changes/cells';

/**
 * 件 1 つの行。精算の方法・確定額（一式）または常用単価（常用）・確定日を入れて保存する。
 * 精算額などの計算値はサーバーの値を出し、保存のあと router.refresh() で取り直す。
 */
export function IssueSettlementRow({
  row,
  siteId,
  defaultDailyRate,
  readOnly,
}: {
  row: ChangesIssueRow;
  siteId: string;
  defaultDailyRate: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, error, setError, runResult } = useRunner();
  const [method, setMethod] = useState<SettlementMethod>(row.settlementMethod);
  const [fixedAmount, setFixedAmount] = useState<number | null>(row.fixedAmount);
  const [dailyRate, setDailyRate] = useState<number | null>(row.dailyRate);
  const [fixedOn, setFixedOn] = useState<string | null>(row.fixedOn);
  const [saved, setSaved] = useState(false);

  /** 入力を変えたら「保存しました」とエラーを消す。 */
  function edited() {
    setSaved(false);
    setError(null);
  }

  function changeMethod(v: string) {
    if (!isSettlementMethod(v)) return;
    edited();
    setMethod(v);
    // 常用にしたとき、常用単価が空なら現場の既定を入れる
    if (v === 'daily_rate' && dailyRate === null) setDailyRate(defaultDailyRate);
  }

  function save() {
    const input = {
      settlementMethod: method,
      fixedAmount: method === 'lump_sum' ? fixedAmount : null,
      dailyRate: method === 'daily_rate' ? dailyRate : null,
      fixedOn,
    };
    const parsed = issueSettlementSchema.safeParse(input);
    const message = parsed.success ? null : (parsed.error.issues[0]?.message ?? '入力内容が正しくありません');
    setSaved(false);
    if (message) {
      setError(message);
      return;
    }
    runResult(
      () => updateIssueSettlement(row.id, input),
      () => {
        setSaved(true);
        router.refresh();
      },
    );
  }

  const instruction = [row.instructedBy, row.instructionMethod ? INSTRUCTION_METHOD_LABELS[row.instructionMethod] : null]
    .filter((v): v is string => Boolean(v))
    .join('／');
  const amountLabel = method === 'daily_rate' ? '常用単価（円／人工）' : '確定額（円）';

  return (
    <li className={`${CHANGES_ROW} ${CHANGES_GRID}`}>
      <Cell label="日付">
        <Link
          href={`/sites/${siteId}/reports/${row.reportDate}`}
          className="inline-flex min-h-11 items-center font-medium text-blue-700 underline dark:text-blue-400"
        >
          {jpDate(row.reportDate)}
        </Link>
      </Cell>
      <Cell label="種別">
        <KindTag muted={!row.countsToward}>{ISSUE_KIND_LABELS[row.kind]}</KindTag>
      </Cell>
      <Cell label="本文" wide>
        <p className="whitespace-pre-wrap break-words">{row.body}</p>
      </Cell>
      <Cell label="指示者／方法">{instruction || '—'}</Cell>
      <Cell label="見込み額" num>
        {money(row.amountEstimate)}
      </Cell>
      <InputCell label="精算方法">
        <select value={method} onChange={(e) => changeMethod(e.target.value)} disabled={readOnly} className={fieldClass}>
          {SETTLEMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {SETTLEMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </InputCell>
      {method === 'undecided' ? (
        <Cell label="確定額／常用単価">—</Cell>
      ) : (
        <InputCell label={amountLabel}>
          <NumInput
            key={method}
            integer
            value={method === 'lump_sum' ? fixedAmount : dailyRate}
            onChange={(v) => {
              edited();
              if (method === 'lump_sum') setFixedAmount(v);
              else setDailyRate(v);
            }}
            disabled={readOnly}
          />
        </InputCell>
      )}
      <InputCell label="確定日">
        <input
          type="date"
          value={fixedOn ?? ''}
          onChange={(e) => {
            edited();
            setFixedOn(e.target.value === '' ? null : e.target.value);
          }}
          disabled={readOnly}
          className={fieldClass}
        />
      </InputCell>
      <ComputedCells row={row} />
      <div className="col-span-2 xl:col-span-1">
        <button type="button" onClick={save} disabled={readOnly || pending} className={`${primaryButtonClass} w-full px-2`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      {(saved || error) && (
        <div className="col-span-2 xl:col-span-full xl:text-right">
          {saved && !error && (
            <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">
              保存しました
            </p>
          )}
          <ErrorText message={error} />
        </div>
      )}
    </li>
  );
}
