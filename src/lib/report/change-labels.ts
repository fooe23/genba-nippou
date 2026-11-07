import type { ChangeLedgerKind } from '@/lib/reports/types';
import type { ChangeKind, InstructionMethod, IssueKind, IssueStatus, SettlementMethod, WorkLine } from '@/lib/types';

// 追加・増・変更・減の記録の選択肢と表示名（画面・帳票・検証で共通）。

export const CHANGE_KINDS = ['contract', 'extra', 'increase', 'change', 'minus'] as const satisfies readonly ChangeKind[];
export const INSTRUCTION_METHODS = ['oral', 'phone', 'email', 'document', 'other', 'site'] as const satisfies readonly InstructionMethod[];
export const ISSUE_KINDS = ['extra', 'increase', 'change', 'minus', 'site_judgment', 'client_delay', 'rework', 'other'] as const satisfies readonly IssueKind[];
export const SETTLEMENT_METHODS = ['undecided', 'lump_sum', 'estimate', 'daily_rate'] as const satisfies readonly SettlementMethod[];
/** 件の状態（見積中・対応中・完了）。札で直接どれにでも変えられる。 */
export const ISSUE_STATUSES = ['estimating', 'open', 'done'] as const satisfies readonly IssueStatus[];
/** 件を追加するときに選べる状態（既定は対応中）。 */
export const NEW_ISSUE_STATUSES = ['estimating', 'open'] as const satisfies readonly IssueStatus[];
/** 完了していない件の状態（日報の上の枠・現場の一覧・繰り越しに出す）。 */
export const UNFINISHED_ISSUE_STATUSES = ['estimating', 'open'] as const satisfies readonly IssueStatus[];

/** 作業内容の区分。追加＝新しく別の仕事が増えた、増＝同じ流れの中で数量が増えた（計算・集計は追加と同じ）。 */
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = { contract: '契約内', extra: '追加', increase: '増', change: '変更', minus: '減' };
/**
 * 作業内容の施工内容に区分を付ける：追加・増・変更・減は頭に【追加】【増】【変更】【減】、契約内はそのまま。
 * 日報の帳票（PDF・CSV）と原本 Excel の payload で共通に使う。
 */
export function withChangeKindPrefix(changeKind: ChangeKind, description: string): string {
  return changeKind === 'contract' ? description : `【${CHANGE_KIND_LABELS[changeKind]}】${description}`;
}
/** 指示方法。 */
export const INSTRUCTION_METHOD_LABELS: Record<InstructionMethod, string> = {
  oral: '口頭',
  phone: '電話',
  email: 'メール',
  document: '書面',
  other: 'その他',
  site: '指示なし（現場判断）',
};
/** お客様に見せる帳票（お客様用の日報・精算のご提案）の指示方法。「現場判断」は言い換える。 */
export const CLIENT_INSTRUCTION_METHOD_LABELS: Record<InstructionMethod, string> = {
  ...INSTRUCTION_METHOD_LABELS,
  site: '指示なし（現場の状況による）',
};
/** 重要事項の件の種別。 */
export const ISSUE_KIND_LABELS: Record<IssueKind, string> = {
  extra: '追加指示',
  increase: '増（数量増）',
  change: '仕様変更',
  minus: '減',
  client_delay: '客先都合（手待ち・待機）',
  rework: 'やり直し',
  other: 'その他',
  site_judgment: '現場判断（要協議）',
};
/** お客様に見せる帳票（お客様用の日報・精算のご提案。PDF・Excel）の件の種別。「現場判断（要協議）」は言い換える。 */
export const CLIENT_ISSUE_KIND_LABELS: Record<IssueKind, string> = {
  ...ISSUE_KIND_LABELS,
  site_judgment: '現場の状況による追加（ご相談）',
};
/** 確定額（fixedAmount）で精算する方法か（一式・見積。計算は同じ）。 */
export function usesFixedAmount(m: SettlementMethod): boolean {
  return m === 'lump_sum' || m === 'estimate';
}

/** 件の状態（見積中・対応中・完了）。画面の札と日報の帳票で共通。 */
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = { estimating: '見積中', open: '対応中', done: '完了' };
/** 件の精算の方法。 */
export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = { undecided: '未定', lump_sum: '一式', estimate: '見積', daily_rate: '常用' };

const SETTLEMENT_CATEGORY: Record<IssueKind, ChangeLedgerKind | null> = {
  extra: 'extra',
  increase: 'increase',
  change: 'change',
  minus: 'minus',
  client_delay: 'extra',
  other: 'extra',
  site_judgment: 'extra',
  rework: null,
};
/**
 * 件の種別から精算の区分（追加・増・変更・減）を決める。客先都合・その他・現場判断（要協議）は追加として数え、
 * やり直し（自社の手直し）は客先に請求しないので数えない（null）。
 */
export function settlementCategory(kind: IssueKind): ChangeLedgerKind | null {
  return SETTLEMENT_CATEGORY[kind];
}

type WorkChangeFields = Pick<WorkLine, 'changeKind' | 'instructedBy' | 'instructionMethod' | 'instructedOn' | 'issueId'>;

/** 作業内容の行の区分・指示の既定（契約内・指示なし）。新しい行・古い下書き・列の無い行に使う。 */
export const EMPTY_WORK_CHANGE: Readonly<WorkChangeFields> = {
  changeKind: 'contract',
  instructedBy: '',
  instructionMethod: null,
  instructedOn: null,
  issueId: null,
};

export function isChangeKind(v: unknown): v is ChangeKind {
  return typeof v === 'string' && (CHANGE_KINDS as readonly string[]).includes(v);
}
export function isInstructionMethod(v: unknown): v is InstructionMethod {
  return typeof v === 'string' && (INSTRUCTION_METHODS as readonly string[]).includes(v);
}
export function isIssueKind(v: unknown): v is IssueKind {
  return typeof v === 'string' && (ISSUE_KINDS as readonly string[]).includes(v);
}
export function isIssueStatus(v: unknown): v is IssueStatus {
  return typeof v === 'string' && (ISSUE_STATUSES as readonly string[]).includes(v);
}
/** 完了していない（見積中・対応中の）件か。 */
export function isUnfinishedIssue(issue: { status: IssueStatus }): boolean {
  return issue.status !== 'done';
}
export function isSettlementMethod(v: unknown): v is SettlementMethod {
  return typeof v === 'string' && (SETTLEMENT_METHODS as readonly string[]).includes(v);
}
