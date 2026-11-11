'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { jpDate, todayJst } from '@/lib/calc/format';
import { attachmentBadgeCounts } from '@/lib/calc/image-resize';
import { setEstimateSubmitted, type ReportStateResult } from '@/lib/db/reports-actions';
import { estimateBadges, type EstimateBadgeKind } from '@/lib/report/estimate-submitted';
import type { IssueStatus } from '@/lib/types';
import { AttachmentPanel } from './AttachmentPanel';
import type { AttachmentView, AttachmentViewer } from './types';

const badge = 'inline-block rounded border px-1.5 text-xs font-medium';
const ESTIMATE_BADGE_CLASS: Record<EstimateBadgeKind, string> = {
  file: 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  submitted: 'border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  missing: 'border-orange-400 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
};

/**
 * 件の添付の印（見積書あり／見積提出 MM/DD／見積書なし・写真 N・リンク N）。協力会社（isStaff=false）には見積の印を出さない。
 * 見積の印の決め方は estimateBadges（「見積書なし」は見積中でファイルも提出の記録も無い件だけ。見積の出し忘れに気づくため）。
 */
export function IssueAttachmentBadges({
  attachments,
  status,
  isStaff,
  estimateSubmittedOn = null,
  pendingBadge = false,
}: {
  attachments: AttachmentView[];
  status: IssueStatus;
  isStaff: boolean;
  /** 見積提出の日（2026-11-14。協力会社には読み込みの段階で null が来る）。 */
  estimateSubmittedOn?: string | null;
  /** 赤い印（見積書が要で未提出。2026-11-20）が出る件か。出る件には「見積書なし」を出さない。 */
  pendingBadge?: boolean;
}) {
  const c = attachmentBadgeCounts(isStaff ? attachments : attachments.filter((a) => a.kind !== 'file'));
  const estimate = estimateBadges({ hasFile: c.hasFile, estimateSubmittedOn, status, isStaff, pendingBadge });
  if (estimate.length === 0 && c.photos === 0 && c.links === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {estimate.map((b) => (
        <span key={b.kind} className={`${badge} ${ESTIMATE_BADGE_CLASS[b.kind]}`}>
          {b.label}
        </span>
      ))}
      {c.photos > 0 && <span className={`${badge} border-slate-300 bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100`}>写真 {c.photos}</span>}
      {c.links > 0 && <span className={`${badge} border-slate-300 bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100`}>リンク {c.links}</span>}
    </span>
  );
}

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const promptButton = 'inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-bold disabled:opacity-50';

/**
 * 件ごとの添付：印・付けたもの・「＋ 写真・見積書・リンクを付ける」。件が完了するまで足せる（日報の提出・承認とは関係ない）。
 * 社員・管理者がファイル（見積書）を付けたとき、まだ見積提出の記録が無ければ「見積提出も記録しますか？」と聞く
 * （利用者 2026-11-12）。「記録する」は今日（日本時間）の日で記録する。ファイルを付けただけでは提出とみなさない。
 */
export function IssueAttachments({
  issueId,
  status,
  attachments,
  viewer,
  estimateSubmittedOn = null,
}: {
  issueId: string;
  status: IssueStatus;
  attachments: AttachmentView[];
  viewer: AttachmentViewer;
  /** 見積提出の日（記録があれば「見積提出も記録しますか？」を出さない）。 */
  estimateSubmittedOn?: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = status === 'done' || viewer.siteClosed;
  if (locked && attachments.length === 0) return null;
  const canAsk = viewer.isStaff && !viewer.siteClosed && estimateSubmittedOn === null;
  const today = todayJst();

  function record() {
    setError(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await setEstimateSubmitted(issueId, today);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAsking(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-1 w-full min-w-0 basis-full">
      <AttachmentPanel
        target={{ siteId: viewer.siteId, issueId }}
        attachments={attachments}
        canAddFiles={viewer.isStaff}
        locked={locked}
        viewer={viewer}
        collapsible
        onFilesAdded={() => {
          if (canAsk) {
            setError(null);
            setAsking(true);
          }
        }}
      />
      {asking && canAsk && (
        <div
          role="group"
          aria-label="見積提出も記録しますか？"
          className="mt-2 rounded-lg border border-emerald-600 bg-emerald-50 p-2 text-sm text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-50"
        >
          <p className="font-bold">見積提出も記録しますか？</p>
          <p className="mt-0.5 text-xs">ファイルを付けただけでは「提出」になりません。お客様に出したら記録してください。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={record}
              disabled={pending}
              className={`${promptButton} border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-600`}
            >
              {pending ? '記録中…' : `記録する（${jpDate(today)}）`}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={pending}
              className={`${promptButton} border-gray-400 bg-white text-gray-800 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-200`}
            >
              今はしない
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-1 text-sm font-bold text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
