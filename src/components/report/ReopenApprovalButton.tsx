'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reopenReport, type ReportStateResult } from '@/lib/db/reports-actions';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
export const REOPENED_MESSAGE = '承認を解除しました（下書きに戻りました）';

/**
 * 日報画面の「承認済み」の帯に出す、承認解除（下書きに戻す）。出すのはその現場の確認者・承認者と管理者（最終判定は DB のガード）。
 * 成功すると画面を再読み込みする。日報の updated_at が進むので ReportForm が入力欄を作り直し、編集できる画面になる。
 * onDone は作り直しの前に呼ぶ（作り直しで消えないところに完了の表示を残すため）。
 */
export function ReopenApprovalButton({ reportId, onDone }: { reportId: string; onDone?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function reopen() {
    if (!window.confirm('承認を解除して下書きに戻します。よろしいですか？')) return;
    setResult(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await reopenReport(reportId);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (res.ok) {
        setResult({ ok: true, text: REOPENED_MESSAGE });
        onDone?.();
        router.refresh();
      } else {
        setResult({ ok: false, text: res.error });
      }
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={reopen}
        disabled={pending}
        className="min-h-11 w-full rounded-lg border border-gray-400 bg-background px-4 text-base font-bold text-foreground disabled:opacity-50 sm:w-auto dark:border-gray-600"
      >
        承認解除（下書きに戻す）
      </button>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-bold ${result.ok ? '' : 'text-red-700 dark:text-red-400'}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}
