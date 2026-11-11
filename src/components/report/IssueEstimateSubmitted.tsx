'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { todayJst } from '@/lib/calc/format';
import { setEstimateSubmitted, type ReportStateResult } from '@/lib/db/reports-actions';
import { canClearEstimateSubmitted, canRecordEstimateSubmitted } from '@/lib/report/estimate-submitted';
import { blockedEstimateClear, ESTIMATE_CLEAR_BLOCKED_MESSAGE } from '@/lib/report/estimate-requirement';
import type { EstimateRequirement, IssueStatus } from '@/lib/types';
import { fieldClass } from './inputs';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const smallButton = 'inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-bold disabled:opacity-50';

/**
 * 件の「見積提出を記録」（2026-11-14）。見積書の PDF を付けずにメール・紙で出したとき、出した日を件に残す。
 * 押すと日付（既定は今日・日本時間）と「記録」「やめる」が出る。記録があるときは小さな「取り消す」（確かめてから）。
 * 印（「見積提出 MM/DD」など）は IssueAttachmentBadges が出す。社員・管理者だけ、完了現場では出さない。
 * 2026-11-20：見積書が要の件は完了していても記録できる。要（先に出す）の対応中・完了の件は取り消せない（理由を出す）。
 */
export function IssueEstimateSubmitted({
  issue,
  viewer,
  onChanged,
}: {
  issue: { id: string; body: string; status: IssueStatus; estimateSubmittedOn: string | null; estimateRequirement?: EstimateRequirement };
  viewer: { isStaff: boolean; siteClosed: boolean };
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canRecord = canRecordEstimateSubmitted(issue, viewer);
  const canClear = canClearEstimateSubmitted(issue, viewer);
  if (!canRecord && !canClear) return null;
  const clearBlocked =
    canClear && issue.estimateRequirement !== undefined && blockedEstimateClear({ estimateRequirement: issue.estimateRequirement, status: issue.status });

  function run(value: string | null) {
    setError(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await setEstimateSubmitted(issue.id, value);
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

  function clear() {
    if (!window.confirm('見積提出の記録を取り消します。よろしいですか？')) return;
    run(null);
  }

  return (
    <div className="mt-1 w-full min-w-0 basis-full text-sm">
      {canClear && clearBlocked && <p className="text-xs text-gray-700 dark:text-gray-300">{ESTIMATE_CLEAR_BLOCKED_MESSAGE}</p>}
      {canClear && !clearBlocked && (
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          aria-label={`${issue.body}：見積提出の記録を取り消す`}
          className={`${smallButton} border-gray-400 text-gray-800 dark:border-gray-500 dark:text-gray-200`}
        >
          {pending ? '取り消し中…' : '取り消す'}
        </button>
      )}
      {canRecord && !open && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setDate(todayJst());
            setOpen(true);
          }}
          className={`${smallButton} border-emerald-600 text-emerald-800 dark:border-emerald-400 dark:text-emerald-200`}
        >
          見積提出を記録
        </button>
      )}
      {canRecord && open && (
        <div role="group" aria-label="見積提出を記録" className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">見積を出した日</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className={`${fieldClass} w-44`}
            />
          </label>
          <button
            type="button"
            onClick={() => run(date)}
            disabled={pending || date === ''}
            className={`${smallButton} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-600`}
          >
            {pending ? '記録中…' : '記録'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            disabled={pending}
            className={`${smallButton} border-gray-400 text-gray-800 dark:border-gray-500 dark:text-gray-200`}
          >
            やめる
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm font-bold text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
