'use client';

import { attachmentBadgeCounts } from '@/lib/calc/image-resize';
import type { IssueStatus } from '@/lib/types';
import { AttachmentPanel } from './AttachmentPanel';
import type { AttachmentView, AttachmentViewer } from './types';

const badge = 'inline-block rounded border px-1.5 text-xs font-medium';

/**
 * 件の添付の印（見積書あり／なし・写真 N・リンク N）。協力会社（isStaff=false）には見積書の印を出さない。
 * 「見積書なし」は見積中の件だけに出す（見積の出し忘れに気づくため）。
 */
export function IssueAttachmentBadges({ attachments, status, isStaff }: { attachments: AttachmentView[]; status: IssueStatus; isStaff: boolean }) {
  const c = attachmentBadgeCounts(isStaff ? attachments : attachments.filter((a) => a.kind !== 'file'));
  const showFile = isStaff && (c.hasFile || status === 'estimating');
  if (!showFile && c.photos === 0 && c.links === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {showFile &&
        (c.hasFile ? (
          <span className={`${badge} border-emerald-400 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100`}>見積書あり</span>
        ) : (
          <span className={`${badge} border-orange-400 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-100`}>見積書なし</span>
        ))}
      {c.photos > 0 && <span className={`${badge} border-slate-300 bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100`}>写真 {c.photos}</span>}
      {c.links > 0 && <span className={`${badge} border-slate-300 bg-slate-50 text-slate-900 dark:bg-slate-800 dark:text-slate-100`}>リンク {c.links}</span>}
    </span>
  );
}

/** 件ごとの添付：印・付けたもの・「＋ 写真・見積書・リンクを付ける」。件が完了するまで足せる（日報の提出・承認とは関係ない）。 */
export function IssueAttachments({
  issueId,
  status,
  attachments,
  viewer,
}: {
  issueId: string;
  status: IssueStatus;
  attachments: AttachmentView[];
  viewer: AttachmentViewer;
}) {
  const locked = status === 'done' || viewer.siteClosed;
  if (locked && attachments.length === 0) return null;
  return (
    <div className="mt-1 w-full min-w-0 basis-full">
      <AttachmentPanel
        target={{ siteId: viewer.siteId, issueId }}
        attachments={attachments}
        canAddFiles={viewer.isStaff}
        locked={locked}
        viewer={viewer}
        collapsible
      />
    </div>
  );
}
