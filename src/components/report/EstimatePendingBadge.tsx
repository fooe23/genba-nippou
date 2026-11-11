import { estimatePendingBadge } from '@/lib/report/estimate-requirement';
import type { EstimateRequirement } from '@/lib/types';

/**
 * 件の赤い印（2026-11-20）：「必須の見積書が未提出」「見積書が未提出（後出し）」と「依頼から N 日」。
 * 見積書が要で、見積提出の記録が無いあいだ出す（完了した後出しの件も）。協力会社にも出す（止まる理由が分かるように）。
 * DB に列が無い（SQL の前）と estimatePending が false なので出ない。
 */
export function EstimatePendingBadge({
  issue,
  today,
}: {
  issue: { estimateRequirement: EstimateRequirement; estimatePending: boolean; reportDate: string };
  today: string;
}) {
  const b = estimatePendingBadge(issue, today);
  if (!b) return null;
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-x-1 rounded-full border border-red-600 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-800 dark:border-red-400 dark:bg-red-950 dark:text-red-200">
      <span>{b.label}</span>
      <span className="font-medium">（{b.daysLabel}）</span>
    </span>
  );
}
