import { jpDate } from '@/lib/calc/format';
import { INSTRUCTION_METHOD_LABELS } from '@/lib/report/change-labels';
import type { InstructionMethod, ReportLine, WorkLine } from '@/lib/types';

// 根拠の件を選んだ作業内容の行の指示者・指示方法・指示日を、件から入れる（純関数。2026-11-08）。
// 件には指示者・指示方法があり、指示日は件を書いた日報の日付とする。行の入力欄は出さない。
// - 保存時（サーバー）：保存済みの件を読んで上書きする（画面から届いた値は使わない）。
// - 画面：件を選んだときに同じ関数で入れる（保存される値と画面の値をそろえる）。
// - 件が見つからない（候補に無い・消された）行はそのまま（保存時は DB の参照の制約が決める）。

/** 行に写す件の値（Issue の一部）。 */
export interface IssueInstructionSource {
  instructedBy: string | null;
  instructionMethod: InstructionMethod | null;
  /** 件を書いた日報の日付（YYYY-MM-DD。読めなければ ''）。 */
  reportDate: string;
}

/** 件から入れる行の値。 */
export function issueInstruction(issue: IssueInstructionSource): Pick<WorkLine, 'instructedBy' | 'instructionMethod' | 'instructedOn'> {
  return {
    instructedBy: issue.instructedBy ?? '',
    instructionMethod: issue.instructionMethod,
    instructedOn: issue.reportDate === '' ? null : issue.reportDate,
  };
}

/** 根拠の件のある作業内容の行に、件の指示者・指示方法・指示日を入れる。値が変わらない行は同じオブジェクトのまま返す。 */
export function applyIssueInstructions<L extends ReportLine>(lines: L[], issuesById: ReadonlyMap<string, IssueInstructionSource>): L[] {
  return lines.map((l) => {
    if (l.kind !== 'work' || !l.issueId) return l;
    const issue = issuesById.get(l.issueId);
    if (!issue) return l;
    const v = issueInstruction(issue);
    if (l.instructedBy === v.instructedBy && l.instructionMethod === v.instructionMethod && l.instructedOn === v.instructedOn) return l;
    return { ...l, ...v };
  });
}

/** 件から入れた指示の表示（例「指示：施主（大江様）／口頭 2026/11/8（件から）」。指示者も方法も無ければ「指示：— 2026/11/8（件から）」）。 */
export function issueInstructionText(issue: IssueInstructionSource): string {
  const who = [issue.instructedBy?.trim() || null, issue.instructionMethod ? INSTRUCTION_METHOD_LABELS[issue.instructionMethod] : null]
    .filter((s): s is string => s !== null)
    .join('／');
  const date = issue.reportDate === '' ? '' : ` ${jpDate(issue.reportDate)}`;
  return `指示：${who === '' ? '—' : who}${date}（件から）`;
}
