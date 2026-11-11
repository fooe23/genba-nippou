import { isInstructionMethod, isIssueKind, isIssueStatus, isSettlementMethod } from '@/lib/report/change-labels';
import { isEstimatePending, isEstimateRequirement } from '@/lib/report/estimate-requirement';
import type { EstimateRequirement, InstructionMethod, IssueKind, IssueStatus, SettlementMethod } from '@/lib/types';

// 件（gn_report_issues）の行を Issue にする純関数（server-only を読まない。読み取り本体は src/lib/db/reports.ts）。

export interface Issue {
  id: string;
  siteId: string;
  reportId: string;
  reportDate: string;
  body: string;
  /** 見積中・対応中・完了。見積中と対応中は完了まで日報の上の枠に出続ける。 */
  status: IssueStatus;
  doneAt: string | null;
  /** 種別（追加指示・増（数量増）・仕様変更・減・客先都合・やり直し・その他・現場判断（要協議））。表示名は ISSUE_KIND_LABELS。 */
  kind: IssueKind;
  /** 指示者（未入力は null）。 */
  instructedBy: string | null;
  instructionMethod: InstructionMethod | null;
  /** 金額見込み（円。未入力は null）。 */
  amountEstimate: number | null;
  /** 精算の方法（未定・一式・見積・常用）。表示名は SETTLEMENT_METHOD_LABELS。 */
  settlementMethod: SettlementMethod;
  /** 確定額（円。一式・見積のとき。見積は見積額。それ以外は null）。 */
  fixedAmount: number | null;
  /** 常用単価（客先請求・円／人工。常用のとき。それ以外は null）。 */
  dailyRate: number | null;
  /** 確定日（YYYY-MM-DD。未入力は null）。 */
  fixedOn: string | null;
  /**
   * 見積提出の日（YYYY-MM-DD。記録なしは null。2026-11-14）。見積書の PDF を付けずにメール・紙で出したときの記録。
   * 協力会社のアカウントで読んだときは常に null（見積書の印と同じく協力会社には見せない。hideEstimateDates）。
   */
  estimateSubmittedOn: string | null;
  /**
   * 見積書（要［先に出す］・要［後出し］・不要。2026-11-20）。DB に列が無い（SQL の前）ときは 'none'。
   */
  estimateRequirement: EstimateRequirement;
  /**
   * 見積書が要で、見積提出の記録が無いか（赤い印）。提出の日を消す前に決めるので、協力会社のアカウントでも正しい。
   */
  estimatePending: boolean;
}

export interface IssueRow {
  id: string;
  site_id: string;
  report_id: string;
  body: string;
  status: string;
  done_at: string | null;
  kind: string | null;
  instructed_by: string | null;
  instruction_method: string | null;
  amount_estimate: number | string | null;
  settlement_method: string | null;
  fixed_amount: number | string | null;
  daily_rate: number | string | null;
  fixed_on: string | null;
  estimate_submitted_on: string | null;
  /** 2026-11-20 の列。SQL の前は読まない（undefined）。 */
  estimate_requirement?: string | null;
  gn_daily_reports: { report_date: string } | { report_date: string }[] | null;
}

const ISSUE_FIELDS =
  'id, site_id, report_id, body, status, done_at, kind, instructed_by, instruction_method, amount_estimate, settlement_method, fixed_amount, daily_rate, fixed_on, estimate_submitted_on';

/** 件を読む列。estimateReady（DB に estimate_requirement がある）なら見積書の列も読む。 */
export function issueColumns(estimateReady: boolean): string {
  return `${ISSUE_FIELDS}${estimateReady ? ', estimate_requirement' : ''}, gn_daily_reports(report_date)`;
}

function one<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function amountOrNull(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function issueFromRow(r: IssueRow): Issue {
  const estimateSubmittedOn = r.estimate_submitted_on || null;
  const estimateRequirement: EstimateRequirement = isEstimateRequirement(r.estimate_requirement) ? r.estimate_requirement : 'none';
  return {
    id: r.id,
    siteId: r.site_id,
    reportId: r.report_id,
    reportDate: one(r.gn_daily_reports)?.report_date ?? '',
    body: r.body,
    // 知らない値は対応中として扱う（完了扱いにして枠から消さない）
    status: isIssueStatus(r.status) ? r.status : 'open',
    doneAt: r.done_at ?? null,
    kind: isIssueKind(r.kind) ? r.kind : 'other',
    instructedBy: r.instructed_by || null,
    instructionMethod: isInstructionMethod(r.instruction_method) ? r.instruction_method : null,
    amountEstimate: amountOrNull(r.amount_estimate),
    settlementMethod: isSettlementMethod(r.settlement_method) ? r.settlement_method : 'undecided',
    fixedAmount: amountOrNull(r.fixed_amount),
    dailyRate: amountOrNull(r.daily_rate),
    fixedOn: r.fixed_on || null,
    estimateSubmittedOn,
    estimateRequirement,
    estimatePending: isEstimatePending({ estimateRequirement, estimateSubmittedOn }),
  };
}

/** 協力会社に渡す件：見積提出の日だけ消す（赤い印に使う estimatePending と見積書の欄は残す）。 */
export function hideEstimateDates(list: Issue[]): Issue[] {
  return list.map((i) => (i.estimateSubmittedOn === null ? i : { ...i, estimateSubmittedOn: null }));
}

/** 現場ごとの未提出の件の数（ホーム・管理者の現場の一覧）。 */
export function countBySite(rows: readonly { site_id: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.site_id] = (out[r.site_id] ?? 0) + 1;
  return out;
}
