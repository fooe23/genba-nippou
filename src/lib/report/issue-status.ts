import type { IssueStatus, ReportStatus, SiteRole } from '@/lib/types';

// 件の状態の札（表示名・色・並び）と、日報画面の操作を出すかの判定（画面で共通の純関数）。

const LABELS = { estimating: '見積中', open: '対応中', done: '完了' } as const satisfies Record<IssueStatus, string>;

/** 件の状態の表示名（見積中・対応中・完了）。ISSUE_STATUS_LABELS と同じ。 */
export function issueStatusLabel(s: IssueStatus): (typeof LABELS)[IssueStatus] {
  return LABELS[s];
}

/** 札の色の系統：見積中＝紫、対応中＝青、完了＝緑。 */
export type IssueStatusTone = 'purple' | 'blue' | 'green';
const TONES: Record<IssueStatus, IssueStatusTone> = { estimating: 'purple', open: 'blue', done: 'green' };
export function issueStatusTone(s: IssueStatus): IssueStatusTone {
  return TONES[s];
}

/** 札の Tailwind のクラス（枠・背景・文字。ダークモードも）。 */
export const ISSUE_STATUS_CHIP_CLASS: Record<IssueStatus, string> = {
  estimating: 'border-purple-600 bg-purple-50 text-purple-900 dark:border-purple-400 dark:bg-purple-950 dark:text-purple-50',
  open: 'border-blue-600 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-50',
  done: 'border-green-600 bg-green-50 text-green-900 dark:border-green-400 dark:bg-green-950 dark:text-green-50',
};

/** 並びの順位：見積中 → 対応中 → 完了。 */
export function issueStatusOrder(s: IssueStatus): number {
  return s === 'estimating' ? 0 : s === 'open' ? 1 : 2;
}

/**
 * 件を状態の順（見積中 → 対応中 → 完了）に並べる。同じ状態の中は渡した並び（日報の日付順・同じ日報は件番号順）のまま。
 * 元の配列は変えない。
 */
export function sortIssuesByStatus<T extends { status: IssueStatus }>(issues: readonly T[]): T[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => issueStatusOrder(a.issue.status) - issueStatusOrder(b.issue.status) || a.index - b.index)
    .map((x) => x.issue);
}

/** その現場の確認者・承認者か管理者か（承認・差戻し・承認解除ができる人。最終判定は DB）。 */
export function canReviewSite(isAdmin: boolean, role: SiteRole | null): boolean {
  return isAdmin || role === 'reviewer' || role === 'approver';
}

/**
 * 日報画面に「修正を申請」を出すか。提出済み・承認済みの日報で、完了していない現場のとき。
 * 社員・管理者はだれの日報でも、協力会社のアカウントは自分が作った日報だけ（最終判定は DB）。
 */
export function canRequestReportFix(p: {
  status: ReportStatus | 'none';
  siteClosed: boolean;
  isAdmin: boolean;
  accountType: 'employee' | 'partner';
  createdBy: string | null;
  currentUserId: string;
}): boolean {
  if (p.status !== 'submitted' && p.status !== 'approved') return false;
  if (p.siteClosed) return false;
  if (p.isAdmin || p.accountType !== 'partner') return true;
  return p.createdBy !== null && p.createdBy === p.currentUserId;
}
