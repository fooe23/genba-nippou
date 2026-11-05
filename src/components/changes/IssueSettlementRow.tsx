'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { jpDate } from '@/lib/calc/format';
import { updateIssueSettlement } from '@/lib/db/reports-actions';
import { issueSettlementSchema } from '@/lib/db/issue-schemas';
import { INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS, SETTLEMENT_METHODS, SETTLEMENT_METHOD_LABELS, isSettlementMethod, usesFixedAmount } from '@/lib/report/change-labels';
import type { ChangesIssueRow, PossibleDuplicate } from '@/lib/reports/changes-page';
import type { SettlementMethod } from '@/lib/types';
import { money } from '@/components/report/form-state';
import { NumInput, fieldClass } from '@/components/report/inputs';
import { ErrorText, primaryButtonClass, useRunner } from '@/components/masters/common';
import { AffiliationNote, CHANGES_GRID, CHANGES_ROW, Cell, ComputedCells, InputCell, KindTag } from '@/components/changes/cells';

/** 'YYYY-MM-DD' → 'MM/DD'。 */
const md = (date: string) => date.slice(5).replace('-', '/');

/**
 * 重複の可能性の注意（琥珀色）：「重複の可能性：11/03 と 11/06 に同じ工種・施工内容「大工／…」があります。…」（工種が空なら「同じ施工内容「…」」）。日付はその日の日報へのリンク。
 * 2xl 以上は行の幅いっぱい、未満はカードの中。
 */
function DuplicateNotes({ siteId, items }: { siteId: string; items: PossibleDuplicate[] }) {
  return (
    <div className="col-span-2 space-y-1 2xl:col-span-full">
      {items.map((d) => (
        <p
          key={`${d.trade}:${d.description}`}
          className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100"
        >
          <span className="font-bold">重複の可能性：</span>
          {d.dates.map((date, i) => (
            <span key={date}>
              {i > 0 ? (i === d.dates.length - 1 ? ' と ' : '、') : null}
              <Link href={`/sites/${siteId}/reports/${date}`} className="font-medium underline">
                {md(date)}
              </Link>
            </span>
          ))}
          {d.trade
            ? ` に同じ工種・施工内容「${d.trade}／${d.description}」があります。続けて作業した場合はそのままで構いません。`
            : ` に同じ施工内容「${d.description}」があります。続けて作業した場合はそのままで構いません。`}
        </p>
      ))}
    </div>
  );
}

/**
 * 件 1 つの行。精算の方法・確定額（一式）・見積額（見積）または常用単価（常用）・確定日を入れて保存する。
 * 精算額などの計算値はサーバーの値を出し、保存のあと router.refresh() で取り直す。
 */
export function IssueSettlementRow({
  row,
  siteId,
  defaultDailyRate,
  duplicates = [],
  readOnly,
}: {
  row: ChangesIssueRow;
  siteId: string;
  defaultDailyRate: number | null;
  /** この件の重複の可能性（無ければ空）。 */
  duplicates?: PossibleDuplicate[];
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
      fixedAmount: usesFixedAmount(method) ? fixedAmount : null,
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
  const amountLabel = method === 'daily_rate' ? '常用単価（円／人工）' : method === 'estimate' ? '見積額（円）' : '確定額（円）';
  // 見積の日付は見積日（保存先は同じ確定日 fixedOn）
  const dateLabel = method === 'estimate' ? '見積日' : '確定日';

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
            value={usesFixedAmount(method) ? fixedAmount : dailyRate}
            onChange={(v) => {
              edited();
              if (usesFixedAmount(method)) setFixedAmount(v);
              else setDailyRate(v);
            }}
            disabled={readOnly}
          />
        </InputCell>
      )}
      <InputCell label={dateLabel}>
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
      <div className="col-span-2 2xl:col-span-1">
        <button type="button" onClick={save} disabled={readOnly || pending} className={`${primaryButtonClass} w-full px-2`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
      <AffiliationNote row={row} />
      {duplicates.length > 0 && <DuplicateNotes siteId={siteId} items={duplicates} />}
      {(saved || error) && (
        <div className="col-span-2 2xl:col-span-full 2xl:text-right">
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
