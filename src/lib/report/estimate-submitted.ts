import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import type { EstimateRequirement, IssueStatus } from '@/lib/types';

// 件の見積提出の記録（2026-11-14）。見積書の PDF を付けずにメール・紙で見積を出したとき、出した日を件に残す。
// 記録・取り消しは社員・管理者だけ（協力会社には印もボタンも出さない。DB のガードは not_employee）。
// 日報の状態（提出済み・承認済み）に関係なくいつでも変えられる。完了現場は変えられない（site_closed）。
//
// 印（社員・管理者だけ）：
//   * 見積書（ファイル）が付いている →「見積書あり」。提出の記録もあれば、その横に「提出 MM/DD」も出す（2 つの印）。
//     PDF は付いたが出した日はメールで別の日、という場合に両方わかるようにするため（1 つにまとめると長くなる）。
//   * ファイルは無いが提出の記録がある →「見積提出 MM/DD」。
//   * どちらも無く、件が見積中 →「見積書なし」（見積の出し忘れに気づくため。今までどおり）。
//     ただし赤い印（見積書が要で未提出。2026-11-20）が出る件では出さない（同じことを 2 回言わない）。
//   * それ以外 → 印なし。

/** 見積提出の日（YYYY-MM-DD）。null は取り消し。 */
export const estimateSubmittedOnSchema = z.union([dateSchema, z.null()], { error: '見積提出の日の指定が正しくありません' });

/** 協力会社のアカウントが記録・取り消しをしようとしたとき（画面には出さないが、直接呼ばれたときのため）。 */
export const ESTIMATE_SUBMITTED_STAFF_ONLY_MESSAGE = '見積提出の記録は社員・管理者のアカウントだけができます。';

export type EstimateBadgeKind = 'file' | 'submitted' | 'missing';
export interface EstimateBadge {
  kind: EstimateBadgeKind;
  label: string;
}

const md = (date: string) => date.slice(5).replace('-', '/');

/** 件の見積の印（社員・管理者だけ。協力会社は常に空）。並びは表示順。 */
export function estimateBadges(input: {
  hasFile: boolean;
  estimateSubmittedOn: string | null;
  status: IssueStatus;
  isStaff: boolean;
  /** 赤い印（estimatePendingBadge）が出る件か。true なら「見積書なし」を出さない。 */
  pendingBadge?: boolean;
}): EstimateBadge[] {
  const { hasFile, estimateSubmittedOn, status, isStaff, pendingBadge = false } = input;
  if (!isStaff) return [];
  if (hasFile) {
    const out: EstimateBadge[] = [{ kind: 'file', label: '見積書あり' }];
    if (estimateSubmittedOn) out.push({ kind: 'submitted', label: `提出 ${md(estimateSubmittedOn)}` });
    return out;
  }
  if (estimateSubmittedOn) return [{ kind: 'submitted', label: `見積提出 ${md(estimateSubmittedOn)}` }];
  if (status === 'estimating' && !pendingBadge) return [{ kind: 'missing', label: '見積書なし' }];
  return [];
}

/**
 * 「見積提出を記録」のボタンを出すか：社員・管理者で、完了現場でなく、まだ記録が無く、件が完了していないとき。
 * 見積書が要（先に出す・後出し）の件は完了していても出す（後出しの見積を記録して赤い印を消すため。2026-11-20）。
 * 記録があるときは「取り消す」を出す（canClearEstimateSubmitted）。
 */
export function canRecordEstimateSubmitted(
  issue: { status: IssueStatus; estimateSubmittedOn: string | null; estimateRequirement?: EstimateRequirement },
  viewer: { isStaff: boolean; siteClosed: boolean },
): boolean {
  const required = issue.estimateRequirement !== undefined && issue.estimateRequirement !== 'none';
  return (
    viewer.isStaff && !viewer.siteClosed && issue.estimateSubmittedOn === null && (issue.status !== 'done' || required)
  );
}

/** 「取り消す」を出すか：社員・管理者で、完了現場でなく、記録があるとき（件が完了していても取り消せる）。 */
export function canClearEstimateSubmitted(
  issue: { estimateSubmittedOn: string | null },
  viewer: { isStaff: boolean; siteClosed: boolean },
): boolean {
  return viewer.isStaff && !viewer.siteClosed && issue.estimateSubmittedOn !== null;
}
