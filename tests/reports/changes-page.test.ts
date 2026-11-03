import { describe, it, expect } from 'vitest';
import { changesTotal, joinChangesRows } from '@/lib/reports/changes-page';
import { buildChangeLedger } from '@/lib/reports/change-model';
import { changeInput, RATES } from './cost-fixture';
import type { Issue } from '@/lib/db/reports';
import type { ChangeIssueSettlement, ChangeLedgerModel } from '@/lib/reports/types';
import type { IssueKind } from '@/lib/types';

const issue = (id: string, reportDate: string, kind: IssueKind = 'extra', o: Partial<Issue> = {}): Issue => ({
  id, siteId: 's1', reportId: `r-${reportDate}`, reportDate, body: `件${id}の本文`, status: 'open', doneAt: null, kind,
  instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null,
  dailyRate: null, fixedOn: null, ...o,
});

const settled = (i: Issue, o: Partial<ChangeIssueSettlement> = {}): ChangeIssueSettlement => ({
  id: i.id, reportDate: i.reportDate, kind: i.kind, bodyHead: i.body, instructedBy: i.instructedBy, amountEstimate: i.amountEstimate,
  settlementMethod: i.settlementMethod, fixedAmount: i.fixedAmount, dailyRate: i.dailyRate, fixedOn: i.fixedOn,
  category: i.kind === 'rework' ? null : 'extra', lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: 0,
  settledBasis: 'proposal', countsToward: i.kind !== 'rework', ...o,
});

type Ledger = Pick<ChangeLedgerModel, 'issues' | 'unlinked'>;
const NO_UNLINKED: Ledger['unlinked'] = { lineCount: 0, manDays: 0, actualCost: 0, proposal: 0 };

describe('joinChangesRows', () => {
  it('精算資料に載らない未定で行の無い件も、0 の値で一覧に出す', () => {
    const a = issue('a', '2026-10-05', 'change');
    const rows = joinChangesRows([a], { issues: [], unlinked: NO_UNLINKED });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.unlinked).toBe(false);
    if (r.unlinked) return;
    expect(r).toMatchObject({
      id: 'a', body: '件aの本文', reportDate: '2026-10-05', category: 'change',
      lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: 0, settledBasis: 'proposal', countsToward: true,
    });
  });

  it('やり直しの件は、台帳に無くても合計に入れない（countsToward false）', () => {
    const rows = joinChangesRows([issue('w', '2026-10-05', 'rework')], { issues: [], unlinked: NO_UNLINKED });
    expect(rows[0]).toMatchObject({ category: null, countsToward: false });
  });

  it('台帳の件の値（行数・人工・実績原価・提案額・精算額・根拠）を引き継ぐ', () => {
    const a = issue('a', '2026-10-05', 'extra', { settlementMethod: 'daily_rate', dailyRate: 30_000 });
    const rows = joinChangesRows([a], {
      issues: [settled(a, { lineCount: 2, manDays: 1.5, actualCost: 40_000.4, proposal: 50_601, settled: 45_000, settledBasis: 'daily_rate' })],
      unlinked: NO_UNLINKED,
    });
    expect(rows[0]).toMatchObject({
      id: 'a', settlementMethod: 'daily_rate', dailyRate: 30_000,
      lineCount: 2, manDays: 1.5, actualCost: 40_000.4, proposal: 50_601, settled: 45_000, settledBasis: 'daily_rate', countsToward: true,
    });
  });

  it('日報日の昇順、同じ日は登録順（入力の並び）に並べる', () => {
    const rows = joinChangesRows(
      [issue('c', '2026-10-09'), issue('a', '2026-10-05'), issue('b', '2026-10-09'), issue('d', '2026-10-01')],
      { issues: [], unlinked: NO_UNLINKED },
    );
    expect(rows.map((r) => (r.unlinked ? 'unlinked' : r.id))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('件に紐づかない行は、1 行以上あるときだけ末尾に「件なし」の行として足す（精算額 = 提案額）', () => {
    const a = issue('a', '2026-10-05');
    expect(joinChangesRows([a], { issues: [], unlinked: NO_UNLINKED })).toHaveLength(1);

    const rows = joinChangesRows([a], { issues: [], unlinked: { lineCount: 3, manDays: 2, actualCost: 60_000, proposal: 75_900 } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      unlinked: true, lineCount: 3, manDays: 2, actualCost: 60_000, proposal: 75_900, settled: 75_900, countsToward: true,
    });
  });
});

describe('changesTotal', () => {
  it('合計は合計に入れる行（やり直しを除く）と件なしの行の精算額・提案額・実績原価', () => {
    const a = issue('a', '2026-10-05', 'extra', { settlementMethod: 'lump_sum', fixedAmount: 100_000 });
    const m = issue('m', '2026-10-06', 'minus');
    const w = issue('w', '2026-10-07', 'rework');
    const rows = joinChangesRows([a, m, w, issue('u', '2026-10-08')], {
      issues: [
        settled(a, { lineCount: 1, manDays: 1, actualCost: 20_000, proposal: 25_300, settled: 100_000, settledBasis: 'fixed' }),
        settled(m, { category: 'minus', lineCount: 1, proposal: -30_000, settled: -30_000 }),
        settled(w, { lineCount: 1, manDays: 1, actualCost: 9_000, proposal: 11_385, settled: 11_385 }),
      ],
      unlinked: { lineCount: 1, manDays: 0.5, actualCost: 10_000, proposal: 12_650 },
    });
    expect(changesTotal(rows)).toEqual({ settled: 100_000 - 30_000 + 12_650, proposal: 25_300 - 30_000 + 12_650, actualCost: 30_000 });
  });
});

describe('台帳との一致', () => {
  it('精算額の合計は、台帳の追加＋増＋変更＋減の精算額と同じ', () => {
    const input = changeInput();
    const extraIssue = { ...input.issues[0], id: 'i2', kind: 'other' as const, settlementMethod: 'undecided' as const };
    const issues = [...input.issues, extraIssue];
    const ledger = buildChangeLedger({ ...input, issues }, RATES, { kind: 'all' });
    const rows = joinChangesRows(issues, ledger);
    const s = ledger.settlement;
    expect(rows.filter((r) => !r.unlinked).map((r) => (r.unlinked ? '' : r.id))).toEqual(['i1', 'i2']);
    expect(changesTotal(rows).settled).toBe(s.extra + s.increase + s.change + s.minus);
  });
});
