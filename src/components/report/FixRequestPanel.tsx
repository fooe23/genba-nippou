'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { jpDateTime } from '@/lib/calc/format';
import type { ReportFixRequest } from '@/lib/db/reports';
import { requestReportFix, type ReportStateResult } from '@/lib/db/reports-actions';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const btn = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

/**
 * 日報の修正申請。出ている申請（だれが・いつ・理由）を琥珀色の枠で見せ、canRequest のときは「修正を申請」（理由必須・500 文字まで） を出す（申請が出ているあいだは出さない）。
 * 確認者・承認者・管理者が差戻しか承認解除で下書きに戻すと、申請は解決になり枠から消える（DB のトリガー）。
 */
export function FixRequestPanel({
  reportId,
  requests,
  canRequest,
}: {
  reportId: string;
  requests: ReportFixRequest[];
  canRequest: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // 未解決の申請は 1 つの日報に 1 つまで（DB の一意索引）。出ていれば申請のボタンは出さず、出ている申請を見せる。
  const showRequest = canRequest && requests.length === 0;

  if (requests.length === 0 && !canRequest && !result) return null;

  function submit() {
    if (reason.trim() === '') {
      setResult({ ok: false, text: '修正の理由を入力してください' });
      return;
    }
    setResult(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await requestReportFix(reportId, reason);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (res.ok) {
        setResult({ ok: true, text: '修正を申請しました。確認者・承認者が下書きに戻したら、直してもう一度提出してください。' });
        setEditing(false);
        setReason('');
        router.refresh();
      } else {
        setResult({ ok: false, text: res.error });
      }
    });
  }

  return (
    <section aria-label="修正申請" className="mb-4">
      {requests.length > 0 && (
        <div className="mb-2 rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50">
          <p className="font-bold">修正申請（{requests.length} 件）</p>
          <ul className="mt-1 space-y-1 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="break-words">
                <span className="font-bold">{r.requestedByName || '—'}</span>（{jpDateTime(r.requestedAt)}）：
                <span className="whitespace-pre-wrap">{r.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">確認者・承認者が差戻しか承認解除で下書きに戻すと、申請は終わります。</p>
        </div>
      )}

      {showRequest && !editing && (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setEditing(true);
          }}
          disabled={pending}
          className={`${btn} w-full border border-amber-600 text-amber-800 sm:w-auto dark:border-amber-500 dark:text-amber-300`}
        >
          修正を申請
        </button>
      )}

      {showRequest && editing && (
        <div className="rounded-lg border border-amber-500 p-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">修正の理由（必須・500文字まで）</span>
            <textarea
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：写真の付け忘れ、人工の入力間違い"
              className="w-full rounded-lg border border-gray-400 bg-background px-3 py-2 text-base dark:border-gray-600"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={submit} disabled={pending} className={`${btn} flex-1 bg-amber-700 text-white`}>
              申請する
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
              className={`${btn} border border-gray-400 font-medium dark:border-gray-600`}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-2 text-sm font-bold ${result.ok ? '' : 'text-red-700 dark:text-red-400'}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
