import type { Issue } from '@/lib/db/reports';
import type { LineKind } from '@/lib/types';

// 日報の帳票（PDF・CSV）で共通に使うラベル。並びは雛形の日報シートと同じ。

/** 明細の種別（CSV の「種別」列、PDF の表の見出し）。 */
export const LINE_KIND_LABELS: Record<LineKind, string> = {
  labor: '作業員',
  fuel: '車両',
  lease: 'リース',
  cash: '現金購入',
  credit: '買掛',
  work: '作業内容',
};

/** 明細以外の欄の見出し。 */
export const DAILY_SECTION_TITLES = {
  costs: '本日原価集計',
  output: '本日出来高',
  issues: '重要事項',
  notes: '連絡事項',
} as const;

/** 重要事項の件の状態（日報画面と同じ言い方）。 */
export const ISSUE_STATUS_LABELS: Record<Issue['status'], string> = { open: '対応中', done: '完了' };

/** マスターの参照が無い（手入力の）名前に付ける。 */
export const MANUAL_SUFFIX = '（手入力）';

export function withManual(name: string, manual: boolean): string {
  return manual ? `${name}${MANUAL_SUFFIX}` : name;
}

/** CSV の列（明細 1 行 1 レコード）。 */
export const DAILY_CSV_COLUMNS = [
  '日付', '回目(当月)', '通算', '種別', '名前', '規格', '単位', '数量', '単価', '金額',
  '開始', '終了', '休憩分', '中抜分', '実働H', '人工', '残業H', '取引先', '工種', '施工内容', '備考',
] as const;
