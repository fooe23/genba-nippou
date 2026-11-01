'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { restoreSite } from '@/lib/db/sites-actions';
import { ErrorText, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';

/** 削除済みの現場を元に戻す。1 回目で確認ボタンに切り替わる 2 段階。 */
export function RestoreSiteButton({ siteId, siteName }: { siteId: string; siteName: string }) {
  const router = useRouter();
  const { pending, error, runResult } = useRunner();
  const [confirming, setConfirming] = useState(false);

  function confirm() {
    runResult(
      () => restoreSite(siteId),
      () => {
        setConfirming(false);
        router.refresh();
      },
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            aria-label={`${siteName}を復元する（確定）`}
            className={primaryButtonClass}
          >
            {pending ? '復元中…' : '復元する'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className={secondaryButtonClass}>
            やめる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`${siteName}を復元`}
          className={secondaryButtonClass}
        >
          復元
        </button>
      )}
      <ErrorText message={error} />
    </div>
  );
}
