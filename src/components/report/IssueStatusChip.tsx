'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setEstimateRequirement, setIssueStatus, type ReportStateResult } from '@/lib/db/reports-actions';
import { ISSUE_STATUSES } from '@/lib/report/change-labels';
import {
  ESTIMATE_REQUIRED_FIRST_MESSAGE,
  ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE,
  statusBlockFor,
} from '@/lib/report/estimate-requirement';
import { ISSUE_STATUS_CHIP_CLASS, issueStatusLabel } from '@/lib/report/issue-status';
import type { EstimateRequirement, IssueStatus } from '@/lib/types';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const chipBase = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-base font-bold disabled:opacity-50';

/**
 * 件の状態の札（見積中＝紫・対応中＝青・完了＝緑）。押すと 3 つの状態のボタンが出て、どれにでも直接変えられる。
 * 変えたら onChanged（省略時は画面の再読み込み）。readOnly（完了現場など）は札を見せるだけ。
 * estimate（2026-11-20）：見積書が要（先に出す）で見積提出の記録が無い件は、対応中・完了のボタンを押せなくし、
 * 開いたときに赤い枠で理由を出す。社員・管理者には枠の中に「見積書を後出しにする」を出す（DB も同じ止め方）。
 */
export function IssueStatusChip({
  issueId,
  body,
  status,
  readOnly = false,
  onChanged,
  estimate,
}: {
  issueId: string;
  /** 読み上げ用（「〇〇：状態を変える」）。 */
  body: string;
  status: IssueStatus;
  readOnly?: boolean;
  onChanged?: () => void;
  /** 件の見積書（止める判定）。省略・不要の件は今までどおり。 */
  estimate?: { requirement: EstimateRequirement; pending: boolean; isStaff: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (readOnly) {
    return <span className={`${chipBase} shrink-0 ${ISSUE_STATUS_CHIP_CLASS[status]}`}>{issueStatusLabel(status)}</span>;
  }

  const blockedFor = (next: IssueStatus) =>
    estimate !== undefined &&
    statusBlockFor({ estimateRequirement: estimate.requirement, estimatePending: estimate.pending, status }, next) !== null;
  const blocked = blockedFor('open') || blockedFor('done');

  function run(action: () => Promise<ReportStateResult>) {
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await action();
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      if (onChanged) onChanged();
      else router.refresh();
    });
  }

  function choose(next: IssueStatus) {
    setError(null);
    if (next === status) {
      setOpen(false);
      return;
    }
    run(() => setIssueStatus(issueId, next));
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        disabled={pending}
        aria-expanded={open}
        aria-label={`${body}：${issueStatusLabel(status)}（押すと状態を変えられます）`}
        className={`${chipBase} ${ISSUE_STATUS_CHIP_CLASS[status]}`}
      >
        {issueStatusLabel(status)}
        <span aria-hidden="true" className="ml-1 text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div role="group" aria-label="件の状態を選ぶ" className="flex gap-1">
          {ISSUE_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => choose(s)}
              disabled={pending || (s !== status && blockedFor(s))}
              aria-pressed={s === status}
              className={`${chipBase} ${s === status ? `${ISSUE_STATUS_CHIP_CLASS[s]} ring-2 ring-current` : ISSUE_STATUS_CHIP_CLASS[s]}`}
            >
              {issueStatusLabel(s)}
            </button>
          ))}
        </div>
      )}
      {open && blocked && estimate && (
        <div
          role="note"
          className="max-w-72 rounded-lg border-2 border-red-600 bg-red-50 p-2 text-left text-sm text-red-900 dark:border-red-400 dark:bg-red-950 dark:text-red-50"
        >
          <p>{estimate.isStaff ? ESTIMATE_REQUIRED_FIRST_MESSAGE : ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE}</p>
          {estimate.isStaff && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                run(() => setEstimateRequirement(issueId, 'after'));
              }}
              disabled={pending}
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-red-700 bg-white px-3 text-sm font-bold text-red-800 disabled:opacity-50 dark:border-red-400 dark:bg-red-900 dark:text-red-50"
            >
              見積書を後出しにする
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-64 text-right text-sm font-bold text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
