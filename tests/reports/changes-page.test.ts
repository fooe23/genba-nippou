import { describe, it, expect } from 'vitest';
import { changesTotal, joinChangesRows, possibleDuplicates, unlinkedDates } from '@/lib/reports/changes-page';
import { buildChangeLedger, emptyBreakdown } from '@/lib/reports/change-model';
import { changeInput, RATES, spanningChangeModel } from './cost-fixture';
import type { Issue } from '@/lib/db/reports';
import type { ChangeIssueSettlement, ChangeLedgerModel, ChangeLedgerRow } from '@/lib/reports/types';
import type { IssueKind } from '@/lib/types';

const issue = (id: string, reportDate: string, kind: IssueKind = 'extra', o: Partial<Issue> = {}): Issue => ({
  id, siteId: 's1', reportId: `r-${reportDate}`, reportDate, body: `件${id}の本文`, status: 'open', doneAt: null, kind,
  instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null,
  dailyRate: null, fixedOn: null, estimateSubmittedOn: null, ...o,
});

const settled = (i: Issue, o: Partial<ChangeIssueSettlement> = {}): ChangeIssueSettlement => ({
  id: i.id, reportDate: i.reportDate, number: 1, kind: i.kind, bodyHead: i.body, instructedBy: i.instructedBy, instructionMethod: i.instructionMethod, amountEstimate: i.amountEstimate,
  settlementMethod: i.settlementMethod, fixedAmount: i.fixedAmount, dailyRate: i.dailyRate, fixedOn: i.fixedOn,
  category: i.kind === 'rework' ? null : 'extra', lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: 0,
  settledBasis: 'proposal', countsToward: i.kind !== 'rework', reportClientConfirmed: false, affiliationManDays: [], breakdown: emptyBreakdown(), ...o,
});

type Ledger = Pick<ChangeLedgerModel, 'issues' | 'unlinked'>;
const NO_UNLINKED: Ledger['unlinked'] = { lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, affiliationManDays: [], missingAmountLines: 0 };

describe('joinChangesRows', () => {
  it('精算資料に載らない未定で行の無い件も、0 の値で一覧に出す', () => {
    const a = issue('a', '2026-10-05', 'change');
    const rows = joinChangesRows([a], { issues: [], unlinked: NO_UNLINKED });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.unlinked).toBe(false);
    if (r.unlinked) return;
    expect(r).toMatchObject({
      id: 'a', body: '件aの本文', reportDate: '2026-10-05', number: 1, category: 'change',
      lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: 0, settledBasis: 'proposal', countsToward: true,
    });
  });

  it('台帳に無い件も番号は根拠の件と同じ数え方（その日報の件の中での登録順）', () => {
    const a = issue('a', '2026-10-05');
    const b = issue('b', '2026-10-05');
    const c = issue('c', '2026-10-06');
    const rows = joinChangesRows([a, b, c], { issues: [], unlinked: NO_UNLINKED });
    expect(rows.map((r) => (r.unlinked ? 0 : r.number))).toEqual([1, 2, 1]);
  });

  it('台帳に無い一式の件の精算額も settleIssue のまま（確定額）', () => {
    const a = issue('a', '2026-10-05', 'minus', { settlementMethod: 'lump_sum', fixedAmount: 5_000 });
    const rows = joinChangesRows([a], { issues: [], unlinked: NO_UNLINKED });
    expect(rows[0]).toMatchObject({ category: 'minus', settled: -5_000, settledBasis: 'fixed', lineCount: 0, proposal: 0 });
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

    const rows = joinChangesRows([a], { issues: [], unlinked: { lineCount: 3, manDays: 2, actualCost: 60_000, proposal: 75_900, affiliationManDays: [], missingAmountLines: 2 } });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      unlinked: true, lineCount: 3, manDays: 2, actualCost: 60_000, proposal: 75_900, settled: 75_900, countsToward: true, affiliationManDays: [], dates: [],
      missingAmountLines: 2,
    });
  });

  it('「件なし」の行に、その行のある日報の日付（昇順・重ならない）を付ける', () => {
    const ref = { id: 'a' } as unknown as NonNullable<ChangeLedgerRow['issue']>;
    const rows = joinChangesRows([], {
      issues: [],
      unlinked: { lineCount: 3, manDays: 0, actualCost: 0, proposal: 0, affiliationManDays: [], missingAmountLines: 0 },
      rows: [
        { date: '2026-11-06', issue: null },
        { date: '2026-11-03', issue: null },
        { date: '2026-11-04', issue: ref },
        { date: '2026-11-06', issue: null },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].unlinked && rows[0].dates).toEqual(['2026-11-03', '2026-11-06']);
  });
});

describe('unlinkedDates', () => {
  it('件の無い行の日付だけを昇順・重ならずに返す', () => {
    expect(unlinkedDates([])).toEqual([]);
    expect(unlinkedDates([{ date: '2026-12-01', issue: null }, { date: '2026-11-30', issue: null }])).toEqual(['2026-11-30', '2026-12-01']);
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
      unlinked: { lineCount: 1, manDays: 0.5, actualCost: 10_000, proposal: 12_650, affiliationManDays: [], missingAmountLines: 0 },
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

describe('possibleDuplicates（重複の可能性）', () => {
  const ref = (id: string) => ({ id, reportDate: '2026-11-03', number: 1, kind: 'extra' as const, bodyHead: '本文' });
  const line = (date: string, description: string, o: Partial<ChangeLedgerRow> = {}): ChangeLedgerRow => ({
    date, reportId: `r-${date}`, monthIndex: 1, totalIndex: 1, changeKind: 'extra', trade: '内装', description, qty: 1, unit: '式',
    unitPrice: null, declared: 0, manDays: 1, instructedBy: null, instructionMethod: null, instructedOn: null, issue: ref('a'),
    clientConfirmed: false, actualCost: 0, laborAmount: 0, missingAmount: false, proposal: 0, proposalBasis: 'cost', affiliationManDays: [], ...o,
  });

  it('同じ件に同じ施工内容が違う日にあれば、件ごとに日付（昇順）と施工内容', () => {
    const d = possibleDuplicates([line('2026-11-06', 'おおおお'), line('2026-11-03', 'おおおお'), line('2026-11-03', '別の作業')]);
    expect([...d.entries()]).toEqual([['a', [{ trade: '内装', description: 'おおおお', dates: ['2026-11-03', '2026-11-06'] }]]]);
  });

  it('施工内容が違えば出さない', () => {
    expect(possibleDuplicates([line('2026-11-03', 'おおおお'), line('2026-11-06', 'かかかか')]).size).toBe(0);
  });

  it('同じ日に 2 行あるだけなら出さない', () => {
    expect(possibleDuplicates([line('2026-11-03', 'おおおお'), line('2026-11-03', 'おおおお')]).size).toBe(0);
  });

  it('違う件・件なし・工種が違う行は重複にしない', () => {
    const d = possibleDuplicates([
      line('2026-11-03', 'おおおお'),
      line('2026-11-06', 'おおおお', { issue: ref('b') }),
      line('2026-11-07', 'おおおお', { issue: null }),
      line('2026-11-08', 'おおおお', { trade: '大工' }),
    ]);
    expect(d.size).toBe(0);
  });

  it('同じ施工内容でも工種ごとに別の候補（工種は空でもよい）', () => {
    const d = possibleDuplicates([
      line('2026-11-03', '棚の追加', { trade: '大工' }),
      line('2026-11-06', '棚の追加', { trade: '大工' }),
      line('2026-11-03', '棚の追加', { trade: '' }),
      line('2026-11-06', '棚の追加', { trade: '' }),
    ]);
    expect(d.get('a')).toEqual([
      { trade: '大工', description: '棚の追加', dates: ['2026-11-03', '2026-11-06'] },
      { trade: '', description: '棚の追加', dates: ['2026-11-03', '2026-11-06'] },
    ]);
  });

  it('前後の空白と続く空白（全角も）はならして比べる', () => {
    const d = possibleDuplicates([
      line('2026-11-03', ' クロス  張替え '),
      line('2026-11-06', 'クロス\u3000張替え', { trade: ' 内装 ' }),
    ]);
    expect(d.get('a')).toEqual([{ trade: '内装', description: 'クロス 張替え', dates: ['2026-11-03', '2026-11-06'] }]);
  });

  it('台帳の行から：2 日にまたがる件 i1 の同じ施工内容', () => {
    expect([...possibleDuplicates(spanningChangeModel().rows).entries()]).toEqual([
      ['i1', [{ trade: '内装', description: 'クロス張替え（2 階洋室）', dates: ['2026-11-05', '2026-11-06'] }]],
    ]);
  });
});
