'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { approveReport, rejectReport, reopenReport, type ReportStateResult } from '@/lib/db/reports-actions';
import type { ReportStatus } from '@/lib/types';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const btn = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

/** 承認画面の操作（承認・差戻し・承認解除）。canReview は reviewer/approver/管理者のとき true（承認解除も同じ人ができる）。 */
export function ApprovalActions({
  reportId,
  status,
  canReview,
  siteClosed = false,
}: {
  reportId: string;
  status: ReportStatus;
  canReview: boolean;
  /** 完了・削除済みの現場では承認解除（下書きに戻す）は DB が拒否するのでボタンを出さない。 */
  siteClosed?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<ReportStateResult>, doneText: string, after?: () => void) {
    setResult(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await action();
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (res.ok) {
        setResult({ ok: true, text: doneText });
        after?.();
        router.refresh();
      } else {
        setResult({ ok: false, text: res.error });
      }
    });
  }

  const approve = () => {
    if (!window.confirm('この日報を承認します。承認すると担当者は編集できなくなります。よろしいですか？')) return;
    run(() => approveReport(reportId), '承認しました');
  };
  const reject = () => {
    if (reason.trim() === '') {
      setResult({ ok: false, text: '差戻しの理由を入力してください' });
      return;
    }
    run(() => rejectReport(reportId, reason), '差戻しました', () => {
      setRejecting(false);
      setReason('');
    });
  };
  const reopen = () => {
    if (!window.confirm('承認を解除して下書きに戻します。よろしいですか？')) return;
    run(() => reopenReport(reportId), '承認を解除しました（下書きに戻りました）');
  };

  const showReview = canReview && status === 'submitted';
  const showReopen = canReview && status === 'approved' && !siteClosed;

  return (
    <section aria-label="承認の操作" className="mt-6">
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`mb-3 rounded-lg border p-3 font-bold ${
            result.ok
              ? 'border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-50'
              : 'border-red-500 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-50'
          }`}
        >
          {result.text}
        </p>
      )}

      {status !== 'submitted' && status !== 'approved' && (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">この日報は承認待ちではありません。</p>
      )}
      {status === 'submitted' && !canReview && (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">この現場の確認者・承認者ではないため、承認や差戻しはできません。</p>
      )}

      {showReview && !rejecting && (
        <div className="flex gap-2">
          <button type="button" onClick={approve} disabled={pending} className={`${btn} flex-1 bg-green-700 text-white`}>
            承認
          </button>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setRejecting(true);
            }}
            disabled={pending}
            className={`${btn} flex-1 border border-red-600 text-red-700 dark:text-red-400`}
          >
            差戻し
          </button>
        </div>
      )}

      {showReview && rejecting && (
        <div className="rounded-lg border border-red-500 p-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">差戻しの理由（必須）</span>
            <textarea
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-gray-400 bg-background px-3 py-2 text-base dark:border-gray-600"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={reject} disabled={pending} className={`${btn} flex-1 bg-red-700 text-white`}>
              差戻しする
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              disabled={pending}
              className={`${btn} border border-gray-400 font-medium dark:border-gray-600`}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {showReopen && (
        <button type="button" onClick={reopen} disabled={pending} className={`${btn} w-full border border-gray-400 dark:border-gray-600`}>
          承認解除（下書きに戻す）
        </button>
      )}
    </section>
  );
}
