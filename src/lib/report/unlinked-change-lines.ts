import type { ChangeKind } from '@/lib/types';

// 提出の条件：作業内容の行のうち、区分が追加・増・変更・減なのに根拠の件を選んでいない行があれば提出できない
// （下書き保存はできる）。サーバーの提出（submitReport）と画面の強調・注意で共通に使う純関数。

/** 件を選んでいない追加・増・変更・減の行があるときの提出の拒否（ReportStateResult の code）。 */
export const UNLINKED_CHANGE_LINES = 'unlinked_change_lines';

/** 作業内容の行に要る項目だけ（ReportLine・画面の入力行のどちらも渡せる）。 */
type LineLike = { kind: string; changeKind?: ChangeKind; issueId?: string | null; description?: string };

export interface UnlinkedChangeLine {
  /** 作業内容の行の中での位置（0 始まり。作業内容の表の行の添字）。 */
  index: number;
  /** 作業内容の何行目か（1 始まり）。 */
  row: number;
  changeKind: Exclude<ChangeKind, 'contract'>;
  description: string;
}

/** 件を選んでいない（issueId が空の）追加・増・変更・減の作業内容の行。並びは作業内容の行の順。 */
export function unlinkedChangeLines(lines: readonly LineLike[]): UnlinkedChangeLine[] {
  const out: UnlinkedChangeLine[] = [];
  let index = 0;
  for (const l of lines) {
    if (l.kind !== 'work') continue;
    const k = l.changeKind ?? 'contract';
    if (k !== 'contract' && (l.issueId ?? '').trim() === '') {
      out.push({ index, row: index + 1, changeKind: k, description: l.description ?? '' });
    }
    index += 1;
  }
  return out;
}

/** 提出を断るときの文言。 */
export function unlinkedChangeMessage(count: number): string {
  return `件を選んでいない追加・増・変更・減の行があります（${count} 行）。作業内容の行で『根拠の件』を選んでから提出してください。`;
}

/** 提出前の注意（画面の「確認してください」の帯）。行番号は作業内容の行の何行目か。 */
export function unlinkedChangeWarning(lines: readonly UnlinkedChangeLine[]): string | null {
  if (lines.length === 0) return null;
  return `作業内容の ${lines.map((l) => l.row).join('・')} 行目：追加・増・変更・減の行は『根拠の件』を選ばないと提出できません`;
}
