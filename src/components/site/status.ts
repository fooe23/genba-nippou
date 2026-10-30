import type { ReportStatus } from '@/lib/types';

export type DayStatus = ReportStatus | 'none';

export const STATUS_LABEL: Record<DayStatus, string> = {
  none: '未入力',
  draft: '下書き',
  rejected: '差戻し',
  submitted: '提出済',
  approved: '承認済',
};

/** 凡例・並び順の標準順（未入力を先頭に）。ホームのカード並びにも使う。 */
export const STATUS_ORDER: DayStatus[] = ['none', 'draft', 'rejected', 'submitted', 'approved'];

/** 色で状態を示すクラス（カレンダーのマス・バッジ共通）。色だけに頼らずラベルも併記する。 */
export const STATUS_COLOR: Record<DayStatus, string> = {
  none: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600',
  draft: 'bg-yellow-100 text-yellow-900 border-yellow-400 dark:bg-yellow-900 dark:text-yellow-50 dark:border-yellow-600',
  rejected: 'bg-red-100 text-red-900 border-red-400 dark:bg-red-900 dark:text-red-50 dark:border-red-600',
  submitted: 'bg-blue-100 text-blue-900 border-blue-400 dark:bg-blue-900 dark:text-blue-50 dark:border-blue-600',
  approved: 'bg-green-100 text-green-900 border-green-400 dark:bg-green-900 dark:text-green-50 dark:border-green-600',
};
