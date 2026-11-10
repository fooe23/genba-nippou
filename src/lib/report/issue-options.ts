import type { Issue } from '@/lib/db/reports';
import { ISSUE_KIND_LABELS } from '@/lib/report/change-labels';

/** 選択の選択肢（components/report/inputs の SelectOption と同じ形）。 */
export interface IssueOption { value: string; label: string; }

/**
 * 根拠の件の選択肢（重複は除く）。表示は「MM/DD 種別 本文の先頭 30 字」。
 * 作業内容の行と、燃料・リース・現金・買掛の行（2026-11-17）で同じ選択肢・文言を使う。
 */
export function issueOptions(issues: Pick<Issue, 'id' | 'body' | 'reportDate' | 'kind'>[]): IssueOption[] {
  const seen = new Set<string>();
  const out: IssueOption[] = [];
  for (const i of issues) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    const body = i.body.replace(/\s+/g, ' ').trim();
    const head = body.length > 30 ? `${body.slice(0, 30)}…` : body;
    out.push({ value: i.id, label: `${i.reportDate.slice(5).replace('-', '/')} ${ISSUE_KIND_LABELS[i.kind]} ${head}` });
  }
  return out;
}
