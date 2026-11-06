'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setIssueStatus, type ReportStateResult } from '@/lib/db/reports-actions';
import { ISSUE_STATUSES } from '@/lib/report/change-labels';
import { ISSUE_STATUS_CHIP_CLASS, issueStatusLabel } from '@/lib/report/issue-status';
import type { IssueStatus } from '@/lib/types';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const chipBase = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-base font-bold disabled:opacity-50';

/**
 * 件の状態の札（見積中＝紫・対応中＝青・完了＝緑）。押すと 3 つの状態のボタンが出て、どれにでも直接変えられる。
 * 変えたら onChanged（省略時は画面の再読み込み）。readOnly（完了現場など）は札を見せるだけ。
 */
export function IssueStatusChip({
  issueId,
  body,
  status,
  readOnly = false,
  onChanged,
}: {
  issueId: string;
  /** 読み上げ用（「〇〇：状態を変える」）。 */
  body: string;
  status: IssueStatus;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (readOnly) {
    return <span className={`${chipBase} shrink-0 ${ISSUE_STATUS_CHIP_CLASS[status]}`}>{issueStatusLabel(status)}</span>;
  }

  function choose(next: IssueStatus) {
    setError(null);
    if (next === status) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await setIssueStatus(issueId, next);
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
              disabled={pending}
              aria-pressed={s === status}
              className={`${chipBase} ${s === status ? `${ISSUE_STATUS_CHIP_CLASS[s]} ring-2 ring-current` : ISSUE_STATUS_CHIP_CLASS[s]}`}
            >
              {issueStatusLabel(s)}
            </button>
          ))}
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
