import { z } from 'zod';
import type { EstimateRequirement, IssueKind, IssueStatus } from '@/lib/types';

// 件の見積書（要［先に出す］・要［お客様の指示で先に対応・後出し］・不要）と、現場の「見積提出が必須のお客様」（2026-11-20）。
// 画面・Server Action・テストで同じ判定を使う純関数。DB の最終判定は gn_report_issues_guard（estimate_required_first）。
//
// 「未提出」＝見積書が before か after で、見積提出の日（estimate_submitted_on）が無いこと。見積書の PDF を付けただけでは
// 提出とみなさない（出した日は「見積提出を記録」で残す）。

export const ESTIMATE_REQUIREMENTS = ['before', 'after', 'none'] as const satisfies readonly EstimateRequirement[];

export const ESTIMATE_REQUIREMENT_LABELS: Record<EstimateRequirement, string> = {
  before: '要（先に出す）',
  after: '要（お客様の指示で先に対応・後出し）',
  none: '不要',
};

export function isEstimateRequirement(v: unknown): v is EstimateRequirement {
  return typeof v === 'string' && (ESTIMATE_REQUIREMENTS as readonly string[]).includes(v);
}

export const estimateRequirementSchema = z.enum(ESTIMATE_REQUIREMENTS, { error: '見積書の指定が正しくありません' });

/**
 * 新しい件の見積書の既定。必須の現場は、種別が「やり直し」なら不要、それ以外は要（先に出す）。
 * 必須でない現場は種別に関係なく不要（利用者 2026-11-12）。DB が協力会社の件に入れる値も同じ決め方。
 */
export function defaultEstimateRequirement(siteRequired: boolean, kind?: IssueKind | null): EstimateRequirement {
  if (!siteRequired) return 'none';
  return kind === 'rework' ? 'none' : 'before';
}

/** 見積書が要で、見積提出の記録が無いか（赤い印を出す件）。 */
export function isEstimatePending(i: { estimateRequirement: EstimateRequirement; estimateSubmittedOn: string | null }): boolean {
  return i.estimateRequirement !== 'none' && i.estimateSubmittedOn === null;
}

const isOpenOrDone = (s: IssueStatus) => s === 'open' || s === 'done';

/** 状態を next にするのを止めるか：要（先に出す）・未提出の件を対応中・完了にするとき。 */
export function blockedStatusChange(
  i: { estimateRequirement: EstimateRequirement; estimateSubmittedOn: string | null; status: IssueStatus },
  next: IssueStatus,
): 'estimate_required_first' | null {
  return i.estimateRequirement === 'before' && i.estimateSubmittedOn === null && isOpenOrDone(next)
    ? 'estimate_required_first'
    : null;
}

/** 見積書を next に変えるのを止めるか：対応中・完了で未提出の件を要（先に出す）にするとき。 */
export function blockedRequirementChange(
  i: { status: IssueStatus; estimateSubmittedOn: string | null },
  next: EstimateRequirement,
): 'estimate_required_first' | null {
  return next === 'before' && i.estimateSubmittedOn === null && isOpenOrDone(i.status) ? 'estimate_required_first' : null;
}

/** 見積提出の記録の取り消しを止めるか：要（先に出す）の対応中・完了の件（取り消すと止めの条件に入るため）。 */
export function blockedEstimateClear(i: { estimateRequirement: EstimateRequirement; status: IssueStatus }): boolean {
  return i.estimateRequirement === 'before' && isOpenOrDone(i.status);
}

/** 新しい件の状態：要（先に出す）なら常に見積中。それ以外は渡したまま（省略は対応中）。 */
export function newIssueStatusFor(
  requirement: EstimateRequirement,
  requested: 'estimating' | 'open' | undefined,
): 'estimating' | 'open' {
  if (requirement === 'before') return 'estimating';
  return requested ?? 'open';
}

/**
 * 件を作るときの見積書と状態（addIssue）。send は DB に送る見積書（null＝送らない）。
 * - DB に列が無い（ready=false）：送らない。状態は渡したまま。
 * - 社員・管理者：渡した値（省略は現場の既定と種別）を送る。
 * - 協力会社：送らない（DB が現場の設定と種別から決める）。状態は同じ決め方の見積書で決める。
 * 要（先に出す）なら状態は見積中（DB も対応中を見積中にする）。
 */
export function planNewIssueEstimate(p: {
  ready: boolean;
  isStaff: boolean;
  siteRequired: boolean;
  kind: IssueKind;
  requested: EstimateRequirement | undefined;
  status: 'estimating' | 'open';
}): { send: EstimateRequirement | null; status: 'estimating' | 'open' } {
  if (!p.ready) return { send: null, status: p.status };
  const fallback = defaultEstimateRequirement(p.siteRequired, p.kind);
  const requirement = p.isStaff ? (p.requested ?? fallback) : fallback;
  return { send: p.isStaff ? requirement : null, status: newIssueStatusFor(requirement, p.status) };
}

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** 依頼の日（件を書いた日報の日付）から今日（日本時間の YYYY-MM-DD）までの日数。負は 0。 */
export function daysSinceRequest(reportDate: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(reportDate));
}

export interface EstimatePendingBadgeInfo {
  tone: 'red';
  label: string;
  days: number;
  daysLabel: string;
}

/** 赤い印（未提出のあいだ。協力会社にも出す）。未提出でなければ null。 */
export function estimatePendingBadge(
  i: { estimateRequirement: EstimateRequirement; estimatePending: boolean; reportDate: string },
  today: string,
): EstimatePendingBadgeInfo | null {
  if (!i.estimatePending || i.estimateRequirement === 'none') return null;
  const days = daysSinceRequest(i.reportDate, today);
  return {
    tone: 'red',
    label: i.estimateRequirement === 'before' ? '必須の見積書が未提出' : '見積書が未提出（後出し）',
    days,
    daysLabel: days === 0 ? '依頼の当日' : `依頼から ${days} 日`,
  };
}

/**
 * 「完了」を押したときにお客様のサインを勧めるか（第 2 段階）。後出しの件を完了にするときだけ（やり直しは除く）。
 * サインできる（日報が保存済み・まだサインが無い・承認の画面でない）なら offer、できなければ「あとで」だけの later_only。
 */
export function shouldOfferSignature(p: {
  requirement: EstimateRequirement;
  next: IssueStatus;
  current: IssueStatus;
  kind: IssueKind | null;
  canSign: boolean;
}): 'offer' | 'later_only' | 'no' {
  if (p.requirement !== 'after' || p.next !== 'done' || p.current === 'done' || p.kind === 'rework') return 'no';
  return p.canSign ? 'offer' : 'later_only';
}

export const ESTIMATE_REQUIRED_FIRST_MESSAGE =
  '見積提出が必須の件です。見積提出を記録するまで、対応中・完了にはできません。お客様の指示で先に対応するときは、見積書を『要（お客様の指示で先に対応・後出し）』に変えてください。';
export const ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE =
  '見積提出が必須の件です。社員が見積提出を記録するまで、対応中・完了にはできません。';
export const ESTIMATE_CLEAR_BLOCKED_MESSAGE =
  '対応中・完了の件です。見積提出の記録を取り消すときは、先に見積書を『後出し』に変えてください。';
export const ESTIMATE_REQUIREMENT_BLOCKED_MESSAGE =
  '対応中・完了で見積提出の記録が無い件は、見積書を『要（先に出す）』にできません。';
export const ESTIMATE_REQUIREMENT_STAFF_ONLY_MESSAGE = '見積書の欄は社員・管理者のアカウントだけが変えられます。';
export const ESTIMATE_REQUIREMENT_NOT_READY_MESSAGE = 'まだ使えません（管理者に SQL の実行を頼んでください）';

/** DB の estimate_required_first を操作ごとの文言に。該当しなければ null。 */
export function estimateRequirementErrorMessage(
  dbMessage: string,
  op: 'status' | 'requirement' | 'clear',
  isStaff: boolean,
): string | null {
  if (!dbMessage.includes('estimate_required_first')) return null;
  if (op === 'clear') return ESTIMATE_CLEAR_BLOCKED_MESSAGE;
  if (op === 'requirement') return ESTIMATE_REQUIREMENT_BLOCKED_MESSAGE;
  return isStaff ? ESTIMATE_REQUIRED_FIRST_MESSAGE : ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE;
}
