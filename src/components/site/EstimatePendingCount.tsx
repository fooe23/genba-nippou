import { estimatePendingCountLabel } from '@/lib/report/estimate-requirement';

/** 現場の一覧の赤い字「見積が未提出の件 N 件」（2026-11-20。社員・管理者だけに渡す。0 件は何も出さない）。 */
export function EstimatePendingCount({ count }: { count: number | undefined }) {
  const label = estimatePendingCountLabel(count);
  if (!label) return null;
  return <span className="block text-sm font-bold text-red-700 dark:text-red-400">{label}</span>;
}
