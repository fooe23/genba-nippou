'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setEstimateRequirement, type ReportStateResult } from '@/lib/db/reports-actions';
import { blockedRequirementChange, ESTIMATE_REQUIREMENT_LABELS, ESTIMATE_REQUIREMENTS } from '@/lib/report/estimate-requirement';
import type { EstimateRequirement, IssueStatus } from '@/lib/types';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const button = 'inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-bold disabled:opacity-50';

/**
 * 件の「見積書：〇〇 ▾」（2026-11-20）。社員・管理者は押すと 3 つのボタン（要［先に出す］・要［後出し］・不要）が出て変えられる。
 * 対応中・完了で見積提出の記録が無い件は「要（先に出す）」を押せない（理由を小さく出す）。協力会社・完了現場は表示だけ。
 * DB に列が無い（ready=false）ときは何も出さない。
 */
export function IssueEstimateRequirement({
  issue,
  ready,
  isStaff,
  readOnly = false,
  onChanged,
}: {
  issue: { id: string; body: string; status: IssueStatus; estimateRequirement: EstimateRequirement; estimateSubmittedOn: string | null };
  ready: boolean;
  isStaff: boolean;
  readOnly?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!ready) return null;
  const label = `見積書：${ESTIMATE_REQUIREMENT_LABELS[issue.estimateRequirement]}`;

  if (!isStaff || readOnly) {
    return <p className="mt-1 text-xs font-medium text-gray-700 dark:text-gray-300">{label}</p>;
  }

  function choose(next: EstimateRequirement) {
    setError(null);
    if (next === issue.estimateRequirement) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await setEstimateRequirement(issue.id, next);
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

  const blocked = blockedRequirementChange(issue, 'before') !== null;
  return (
    <div className="mt-1 text-sm">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((o) => !o);
        }}
        disabled={pending}
        aria-expanded={open}
        aria-label={`${issue.body}：${label}（押すと変えられます）`}
        className={`${button} border-gray-400 text-gray-900 dark:border-gray-500 dark:text-gray-100`}
      >
        {label}
        <span aria-hidden="true" className="ml-1 text-xs">
          ▾
        </span>
      </button>
      {open && (
        <div role="group" aria-label="見積書を選ぶ" className="mt-1 flex flex-col items-start gap-1">
          {ESTIMATE_REQUIREMENTS.map((r) => {
            const disabled = pending || (r === 'before' && blocked && issue.estimateRequirement !== 'before');
            return (
              <button
                key={r}
                type="button"
                onClick={() => choose(r)}
                disabled={disabled}
                aria-pressed={r === issue.estimateRequirement}
                className={`${button} text-left ${
                  r === issue.estimateRequirement
                    ? 'border-blue-700 bg-blue-50 text-blue-900 ring-2 ring-blue-700 dark:bg-blue-950 dark:text-blue-50'
                    : 'border-gray-400 text-gray-900 dark:border-gray-500 dark:text-gray-100'
                }`}
              >
                {ESTIMATE_REQUIREMENT_LABELS[r]}
              </button>
            );
          })}
          {blocked && issue.estimateRequirement !== 'before' && (
            <p className="text-xs text-gray-700 dark:text-gray-300">
              対応中・完了で見積提出の記録が無い件は「要（先に出す）」にできません。
            </p>
          )}
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
