'use client';

import { jpDate, yen } from '@/lib/calc/format';
import type { Issue } from '@/lib/db/reports';
import { ISSUE_KIND_LABELS, isUnfinishedIssue } from '@/lib/report/change-labels';
import { sortIssuesByStatus } from '@/lib/report/issue-status';
import { IssueAttachmentBadges, IssueAttachments } from '@/components/attachments/IssueAttachments';
import type { AttachmentView, AttachmentViewer } from '@/components/attachments/types';
import { IssueStatusChip } from './IssueStatusChip';

const NO_ATTACHMENTS: AttachmentView[] = [];

/** 件の種別の小さな札（と金額見込み）。件の一覧と対応中のバナーで使う。 */
export function IssueKindTag({ issue }: { issue: Issue }) {
  return (
    <>
      <span className="mr-1 inline-block rounded border border-current px-1 text-xs font-bold">{ISSUE_KIND_LABELS[issue.kind]}</span>
      {issue.amountEstimate !== null && <span className="mr-1 text-xs font-bold tabular-nums">見込み {yen(issue.amountEstimate)}</span>}
    </>
  );
}

/**
 * 現場の完了していない（見積中・対応中の）重要事項（この日報の件は除く）。日報入力画面の最上部に出す。なければ何も出さない。
 * 並びは見積中 → 対応中、同じ状態の中は日報の日付順・件番号順。札を押すと見積中・対応中・完了のどれにでも変えられる。
 */
export function IssueBanner({
  issues,
  currentReportId,
  readOnly = false,
  attachmentsByIssue,
  viewer,
}: {
  issues: Issue[];
  currentReportId: string | null;
  /** 完了現場など、件を変更できないとき。札を見せるだけにする。 */
  readOnly?: boolean;
  /** 件ごとの添付（印と「＋ 写真・見積書・リンクを付ける」）。viewer と一緒に渡したときだけ出す。 */
  attachmentsByIssue?: Record<string, AttachmentView[]>;
  viewer?: AttachmentViewer;
}) {
  const shown = sortIssuesByStatus(issues.filter((i) => isUnfinishedIssue(i) && i.reportId !== currentReportId));
  if (shown.length === 0) return null;

  return (
    <section
      aria-label="対応中・見積中の重要事項"
      className="mb-4 rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50"
    >
      <h2 className="font-bold">対応中・見積中の重要事項（{shown.length} 件）</h2>
      <ul className="mt-2 divide-y divide-yellow-300 dark:divide-yellow-800">
        {shown.map((i) => {
          const atts = attachmentsByIssue?.[i.id] ?? NO_ATTACHMENTS;
          return (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-48 self-center text-sm">
                <p className="whitespace-pre-wrap break-words">
                  <span className="font-bold">{jpDate(i.reportDate)}</span>　<IssueKindTag issue={i} />
                  {i.body}
                </p>
                {viewer && <IssueAttachmentBadges attachments={atts} status={i.status} isStaff={viewer.isStaff} />}
              </div>
              <IssueStatusChip issueId={i.id} body={i.body} status={i.status} readOnly={readOnly} />
              {viewer && <IssueAttachments issueId={i.id} status={i.status} attachments={atts} viewer={viewer} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
