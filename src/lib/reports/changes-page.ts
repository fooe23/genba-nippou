import { issueNumbers, settleIssue } from '@/lib/reports/change-model';
import type { Issue } from '@/lib/db/reports';
import type { ChangeIssueSettlement, ChangeLedgerModel } from '@/lib/reports/types';

// 「追加・変更の一覧」画面（/sites/[siteId]/changes）の行（純関数。DB・Next に依存しない）。
// 変更増減の台帳（buildChangeLedger）は一式・常用の件と行の紐づく件だけを載せるが、一覧には現場の全部の件を出す
// （未定で行の無い件も、見積が出たら精算を入れるため）。台帳に無い件は行数・人工・実績原価・提案額・精算額を 0 にする。

type ComputedFields = Pick<
  ChangeIssueSettlement,
  'number' | 'category' | 'lineCount' | 'manDays' | 'actualCost' | 'proposal' | 'settled' | 'settledBasis' | 'countsToward'
>;

/** 件 1 つの行：件の保存値と、台帳の計算値（工期全体）。 */
export type ChangesIssueRow = Issue & ComputedFields & { unlinked: false };

/** 件に紐づかない（件を選んでいない）追加・増・変更・減の行の合計。精算額は提案額そのまま。 */
export interface ChangesUnlinkedRow {
  unlinked: true;
  lineCount: number;
  manDays: number;
  actualCost: number;
  proposal: number;
  settled: number;
  countsToward: true;
}

export type ChangesRow = ChangesIssueRow | ChangesUnlinkedRow;

export interface ChangesTotal {
  settled: number;
  proposal: number;
  actualCost: number;
}

/**
 * 現場の全部の件（issues）に台帳の件（ledger.issues）を id で合わせる。並びは件の日報日の昇順、同じ日は入力の並び
 * （登録順）。件に紐づかない行が 1 行以上あれば、末尾に「件なし」の行を足す。
 */
export function joinChangesRows(issues: Issue[], ledger: Pick<ChangeLedgerModel, 'issues' | 'unlinked'>): ChangesRow[] {
  const byId = new Map(ledger.issues.map((i) => [i.id, i]));
  const numbers = issueNumbers(issues);
  const rows: ChangesRow[] = [...issues]
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .map((issue) => {
      const s = byId.get(issue.id);
      const computed: ComputedFields = s
        ? {
            number: s.number,
            category: s.category,
            lineCount: s.lineCount,
            manDays: s.manDays,
            actualCost: s.actualCost,
            proposal: s.proposal,
            settled: s.settled,
            settledBasis: s.settledBasis,
            countsToward: s.countsToward,
          }
        : // 台帳に無い件（未定で行の無い件）も精算の規則は settleIssue（紐づく行なし）のまま
          {
            ...settleIssue(issue, []),
            number: numbers.get(issue.id) ?? 0,
            lineCount: 0,
            manDays: 0,
            actualCost: 0,
            proposal: 0,
          };
      return { ...issue, ...computed, unlinked: false };
    });
  const u = ledger.unlinked;
  if (u.lineCount > 0) {
    rows.push({
      unlinked: true,
      lineCount: u.lineCount,
      manDays: u.manDays,
      actualCost: u.actualCost,
      proposal: u.proposal,
      settled: u.proposal,
      countsToward: true,
    });
  }
  return rows;
}

/** 合計（合計に入れる行だけ。やり直しは参考で入れない）。精算額の合計は台帳の追加＋増＋変更＋減の精算額と同じ。 */
export function changesTotal(rows: ChangesRow[]): ChangesTotal {
  const total: ChangesTotal = { settled: 0, proposal: 0, actualCost: 0 };
  for (const r of rows) {
    if (!r.countsToward) continue;
    total.settled += r.settled;
    total.proposal += r.proposal;
    total.actualCost += r.actualCost;
  }
  return total;
}
