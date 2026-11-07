import type { InstructionMethod, IssueKind, WorkLine } from '@/lib/types';

// 作業内容の行から「この行の件を作る」ときの初期値（純関数）。
// 種別は行の区分から（追加→追加指示、増→増（数量増）、変更→仕様変更、減→減）。指示方法が「指示なし（現場判断）」の行は
// 現場判断（要協議）にする。件の内容は「工種／施工内容」（空の方は省く）。指示者・指示方法は行の値をそのまま写す。

/** 「この行の件を作る」で選べる種別（行の区分に合う種別と、現場判断（要協議））。 */
export const LINE_ISSUE_KINDS = ['extra', 'increase', 'change', 'minus', 'site_judgment'] as const satisfies readonly IssueKind[];
export type LineIssueKind = (typeof LINE_ISSUE_KINDS)[number];

export interface LineIssuePrefill {
  kind: LineIssueKind;
  body: string;
  instructedBy: string;
  instructionMethod: InstructionMethod | null;
}

const KIND_BY_CHANGE: Record<Exclude<WorkLine['changeKind'], 'contract'>, LineIssueKind> = {
  extra: 'extra',
  increase: 'increase',
  change: 'change',
  minus: 'minus',
};

export function lineIssuePrefill(line: Pick<WorkLine, 'changeKind' | 'trade' | 'description' | 'instructedBy' | 'instructionMethod'>): LineIssuePrefill {
  const kind: LineIssueKind =
    line.instructionMethod === 'site' ? 'site_judgment' : line.changeKind === 'contract' ? 'extra' : KIND_BY_CHANGE[line.changeKind];
  const body = [line.trade.trim(), line.description.trim()].filter((s) => s !== '').join('／').slice(0, 500);
  return { kind, body, instructedBy: line.instructedBy.trim(), instructionMethod: line.instructionMethod };
}
