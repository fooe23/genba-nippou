'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setSiteStatus } from '@/lib/db/sites-actions';
import { ErrorText, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';

/**
 * 管理者向けの「完了にする」／「進行中に戻す」。ブラウザの確認ダイアログは使わず、
 * 1 回目で確認ボタンに切り替わる 2 段階にする。
 */
export function SiteStatusButton({ siteId, status }: { siteId: string; status: 'active' | 'done' }) {
  const router = useRouter();
  const { pending, error, runResult } = useRunner();
  const [confirming, setConfirming] = useState(false);
  const next = status === 'active' ? 'done' : 'active';
  const label = next === 'done' ? '完了にする' : '進行中に戻す';
  const question = next === 'done' ? '本当に完了にしますか？' : '本当に進行中に戻しますか？';
  const note =
    next === 'done'
      ? '完了にすると、この現場の日報は閲覧のみになります（承認・差戻しはできます）。'
      : '進行中に戻すと、この現場の日報をまた入力・編集できます。';

  function confirm() {
    runResult(
      () => setSiteStatus(siteId, next),
      () => {
        setConfirming(false);
        router.refresh();
      },
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <p className="mb-2 text-sm font-bold">管理者の操作</p>
      {confirming ? (
        <div className="space-y-2">
          <p className="font-bold">{question}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">{note}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={confirm} disabled={pending} className={primaryButtonClass}>
              {pending ? '変更中…' : `${label}（確定）`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={secondaryButtonClass}>
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => setConfirming(true)} className={`${secondaryButtonClass} w-full sm:w-auto`}>
            {label}
          </button>
          <p className="text-sm text-gray-600 dark:text-gray-400">{note}</p>
        </div>
      )}
      <ErrorText message={error} />
    </div>
  );
}
