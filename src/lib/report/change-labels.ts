import type { ChangeKind, InstructionMethod, IssueKind, WorkLine } from '@/lib/types';

// 追加・増・変更・減の記録の選択肢と表示名（画面・帳票・検証で共通）。

export const CHANGE_KINDS = ['contract', 'extra', 'increase', 'change', 'minus'] as const satisfies readonly ChangeKind[];
export const INSTRUCTION_METHODS = ['oral', 'phone', 'email', 'document', 'other'] as const satisfies readonly InstructionMethod[];
export const ISSUE_KINDS = ['extra', 'increase', 'change', 'minus', 'client_delay', 'rework', 'other'] as const satisfies readonly IssueKind[];

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
};

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
