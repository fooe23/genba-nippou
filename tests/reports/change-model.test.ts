import { describe, it, expect } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { allocateDayCost, buildChangeLedger, clientSettlement, dayCostBasis, proposalFromCost, settleIssue } from '@/lib/reports/change-model';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { ChangeLedgerInput, ChangeLedgerRow, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import type { ChangeKind, WorkLine } from '@/lib/types';

// ─── 小さな手作りの入力 ───

const site = (o: Partial<Site> = {}): Site => ({
  id: 's1', name: '〇〇邸改修工事', clientName: '〇〇様', projectName: null, projectNo: 'K-002', overview: null,
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: null, contractType: '下請', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null, ...o,
});

const stored = (amount: number, manDays = 0) => ({ amount, manDays, overtimeHours: 0 });
const labor = (manDays: number, cost: number): SavedReportLine => ({
  kind: 'labor', workerId: null, workerName: '作業員', time: { start: null, end: null, breakMin: null, gapMin: null },
  dailyRate: 99_999, note: '', overtimeRate: null, stored: stored(cost, manDays),
});
const fuel = (cost: number): SavedReportLine => ({
  kind: 'fuel', vehicleId: null, vehicleName: '車', kmPerL: 10, distanceKm: 1, pricePerL: 1, note: '', stored: stored(cost),
});
const lease = (cost: number): SavedReportLine => ({
  kind: 'lease', itemId: null, itemName: '足場', spec: '', unit: '日', qty: 1, unitPrice: 1, note: '', stored: stored(cost),
});
const cash = (cost: number): SavedReportLine => ({
  kind: 'cash', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 1, vendor: '', stored: stored(cost),
});
const credit = (cost: number): SavedReportLine => ({
  kind: 'credit', itemName: '合板', spec: '', unit: '枚', qty: 1, unitPrice: 1, supplierId: null, vendor: '', stored: stored(cost),
});
/** 作業内容。保存値の amount は DB のトリガーと同じ（減は負）。 */
const work = (
  changeKind: ChangeKind,
  manDays: number,
  qty: number | null,
  unitPrice: number | null,
  o: Partial<WorkLine> = {},
): SavedReportLine => {
  const a = (qty ?? 0) * (unitPrice ?? 0);
  return {
    kind: 'work', estimateItemId: null, trade: '内装', description: `${changeKind} の作業`, qty, unit: 'm2', manDays, unitPrice, source: 'extra',
    ...EMPTY_WORK_CHANGE, changeKind, ...o, stored: stored(changeKind === 'minus' ? -a : a, manDays),
  };
};

const report = (date: string, lines: SavedReportLine[], o: Partial<ReportWithLines> = {}): ReportWithLines => ({
  id: `r-${date}`, siteId: 's1', reportDate: date, weather: null, supervisor: null, status: 'approved', rejectedReason: null,
  outputTotal: lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.stored.amount, 0),
  costTotal: lines.filter((l) => l.kind !== 'work').reduce((s, l) => s + l.stored.amount, 0),
  manDaysTotal: 0, updatedAt: null, createdBy: null, clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null,
  lines, ...o,
});

const issue = (id: string, reportDate: string, body: string, o: Partial<Issue> = {}): Issue => ({
  id, siteId: 's1', reportId: `r-${reportDate}`, reportDate, body, status: 'open', doneAt: null, kind: 'extra',
  instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null, estimateSubmittedOn: null, ...o,
});

const input = (reports: ReportWithLines[], o: Partial<ChangeLedgerInput> = {}): ChangeLedgerInput => ({ site: site(), reports, issues: [], ...o });

const RATES = { overheadRate: 0.15, profitRate: 0.1 };
const ALL = { kind: 'all' } as const;
const NOV = { kind: 'month', month: '2026-11' } as const;

// 11/02：労務 25,500 円・1.5 人工（平均日当 17,000）、燃料 1,000・リース 500・現金 2,000・買掛 2,500（計 6,000）。
// 作業内容の人工：契約内 2.0、追加 1.0、変更 0.5（計 3.5）。
const nov2 = () =>
  report('2026-11-02', [
    labor(1, 18000),
    labor(0.5, 7500),
    fuel(1000),
    lease(500),
    cash(2000),
    credit(2500),
    work('contract', 2, 10, 5000),
    work('extra', 1, 10, 3000, { instructedBy: '施主 山田様', instructionMethod: 'oral', instructedOn: '2026-11-01', issueId: 'i2' }),
    work('change', 0.5, 1, 5000),
  ]);
// 11/05：減（数量 2 × 単価 1,500 → 保存値 −3,000、人工 0）。客先確認あり。
const nov5 = () => report('2026-11-05', [labor(1, 18000), work('minus', 0, 2, 1500)], { clientConfirmedAt: '2026-11-05T09:00:00Z' });
// 10/20：追加（労務なし・材料 4,000）。
const oct20 = () => report('2026-10-20', [cash(4000), work('extra', 1, 1, 8000)]);

// ─── テスト ───

describe('allocateDayCost（実績原価の按分の規則）', () => {
  it('人工 × 平均日当（労務費 ÷ 労務の人工）＋ 燃料・リース・現金・買掛 × 行の人工 ÷ その日の作業内容の人工の合計', () => {
    const day = dayCostBasis(nov2());
    expect(day).toEqual({ laborCost: 25500, laborManDays: 1.5, otherCost: 6000, workManDays: 3.5 });
    const a = allocateDayCost(day, { manDays: 1 });
    expect(a.labor).toBeCloseTo(17000, 9);
    expect(a.other).toBeCloseTo(6000 / 3.5, 9);
    expect(a.total).toBeCloseTo(17000 + 6000 / 3.5, 9);
  });
  it('同じ日の複数行に配った額の合計は、その日の労務費・材料等（作業内容の人工の割合の分）になる', () => {
    const day = dayCostBasis(nov2());
    const parts = [2, 1, 0.5].map((manDays) => allocateDayCost(day, { manDays }));
    expect(parts.reduce((s, p) => s + p.other, 0)).toBeCloseTo(6000, 9);
    expect(parts.reduce((s, p) => s + p.labor, 0)).toBeCloseTo(3.5 * 17000, 9);
  });
  it('労務が無い日は労務分 0（材料等の按分は行う）', () => {
    const a = allocateDayCost({ laborCost: 0, laborManDays: 0, otherCost: 4000, workManDays: 2 }, { manDays: 1 });
    expect(a).toEqual({ labor: 0, other: 2000, total: 2000 });
  });
  it('作業内容の人工の合計が 0 の日は材料等の按分 0、行の人工 0 なら 0', () => {
    expect(allocateDayCost({ laborCost: 18000, laborManDays: 1, otherCost: 4000, workManDays: 0 }, { manDays: 0 })).toEqual({ labor: 0, other: 0, total: 0 });
    expect(allocateDayCost({ laborCost: 18000, laborManDays: 1, otherCost: 4000, workManDays: 2 }, { manDays: 0 })).toEqual({ labor: 0, other: 0, total: 0 });
  });
  it('dayCostBasis は保存値（stored）だけを足す（日当・数量は見ない）', () => {
    expect(dayCostBasis(nov5())).toEqual({ laborCost: 18000, laborManDays: 1, otherCost: 0, workManDays: 0 });
  });
});

describe('proposalFromCost（提案金額の丸め）', () => {
  it('実績原価 ×（1＋経費率）×（1＋利益率）を円未満切り上げ', () => {
    expect(proposalFromCost(1, RATES)).toBe(2); // 1.265 → 2
    expect(proposalFromCost(18714.2857, RATES)).toBe(23674); // 23673.57… → 23674
  });
  it('割り切れる額は浮動小数の誤差で 1 円多くしない（10,000 × 1.15 × 1.1 = 12,650）', () => {
    expect(proposalFromCost(10000, RATES)).toBe(12650);
    expect(proposalFromCost(20000, { overheadRate: 0.1, profitRate: 0.1 })).toBe(24200);
  });
  it('率 0 なら実績原価の切り上げ、原価 0 なら 0', () => {
    expect(proposalFromCost(1234.01, { overheadRate: 0, profitRate: 0 })).toBe(1235);
    expect(proposalFromCost(0, RATES)).toBe(0);
  });
});

describe('一覧の行', () => {
  const m = buildChangeLedger(input([nov5(), nov2(), oct20()]), RATES, ALL);

  it('追加・増・変更・減の行だけを日付順（同じ日は日報の行の順）に並べる。契約内は出さない', () => {
    expect(m.rows.map((r) => [r.date, r.changeKind])).toEqual([
      ['2026-10-20', 'extra'],
      ['2026-11-02', 'extra'],
      ['2026-11-02', 'change'],
      ['2026-11-05', 'minus'],
    ]);
    expect(m.isEmpty).toBe(false);
  });
  it('回目（当月 N／通算 M）・入力の項目・申告額（保存値）・投入人工', () => {
    const r = m.rows[1];
    expect(r).toMatchObject({
      reportId: 'r-2026-11-02', monthIndex: 1, totalIndex: 2, trade: '内装', description: 'extra の作業', qty: 10, unit: 'm2', unitPrice: 3000,
      declared: 30000, manDays: 1, instructedBy: '施主 山田様', instructionMethod: 'oral', instructedOn: '2026-11-01',
    });
    expect(m.rows[3]).toMatchObject({ monthIndex: 2, totalIndex: 3 });
    expect(m.rows[2].instructedBy).toBeNull(); // '' は null
  });
  it('実績原価と提案金額（追加・変更は実績原価から）', () => {
    const extra = m.rows[1];
    expect(extra.actualCost.total).toBeCloseTo(17000 + 6000 / 3.5, 9);
    expect(extra.proposal).toBe(Math.ceil((17000 + 6000 / 3.5) * 1.15 * 1.1)); // 23674
    expect(extra.proposal).toBe(23674);
    expect(extra.proposalBasis).toBe('cost');
    const change = m.rows[2];
    expect(change.actualCost.total).toBeCloseTo(8500 + 6000 * (0.5 / 3.5), 9);
    expect(change.proposal).toBe(11837);
    // 10/20：労務なし。材料 4,000 を 1 行（人工 1／合計 1）に全部配る → 4,000 × 1.265 = 5,060
    expect(m.rows[0].actualCost).toEqual({ labor: 0, other: 4000, total: 4000 });
    expect(m.rows[0].proposal).toBe(5060);
  });
  it('減は申告額（負）がそのまま提案額', () => {
    const minus = m.rows[3];
    expect(minus.declared).toBe(-3000);
    expect(minus.proposal).toBe(-3000);
    expect(minus.proposalBasis).toBe('declared');
    expect(minus.actualCost.total).toBe(0);
  });
  it('客先確認の有無（日報の client_confirmed_at）', () => {
    expect(m.rows.map((r) => r.clientConfirmed)).toEqual([false, false, false, true]);
  });
});

describe('根拠の件', () => {
  const long = 'あ'.repeat(30) + 'い'.repeat(20);
  const issues = [
    issue('i0', '2026-10-20', '10/20 の件'),
    issue('i1', '2026-11-02', '11/02 の 1 件目'),
    issue('i2', '2026-11-02', `  ${long}  `, { kind: 'change' }),
  ];
  const rows = (lines: SavedReportLine[]) => buildChangeLedger(input([report('2026-11-02', lines)], { issues }), RATES, ALL).rows;

  it('番号はその件を書いた日報の件の中での登録順（1 始まり）、本文は先頭 40 字、種別', () => {
    const [r] = rows([work('extra', 1, 1, 1000, { issueId: 'i2' })]);
    expect(r.issue).toEqual({ id: 'i2', reportDate: '2026-11-02', number: 2, kind: 'change', bodyHead: 'あ'.repeat(30) + 'い'.repeat(10) });
  });
  it('前の日の件も紐づけられる（番号はその日の中で数える）', () => {
    const [r] = rows([work('change', 1, 1, 1000, { issueId: 'i0' })]);
    expect(r.issue).toMatchObject({ id: 'i0', reportDate: '2026-10-20', number: 1, kind: 'extra', bodyHead: '10/20 の件' });
  });
  it('未選択・読めない件は null', () => {
    const r = rows([work('extra', 1, 1, 1000), work('extra', 1, 1, 1000, { issueId: 'gone' })]);
    expect(r.map((x) => x.issue)).toEqual([null, null]);
  });
});

describe('区分ごとの集計と精算提案額', () => {
  it('件数・申告額・実績原価・提案額（減は負）、契約内の出来高', () => {
    const m = buildChangeLedger(input([nov5(), nov2(), oct20()]), RATES, ALL);
    expect(m.summary.extra).toMatchObject({ count: 2, declared: 38000, proposal: 5060 + 23674 });
    expect(m.summary.extra.actualCost).toBeCloseTo(4000 + 17000 + 6000 / 3.5, 6);
    expect(m.summary.change).toMatchObject({ count: 1, declared: 5000, proposal: 11837 });
    expect(m.summary.minus).toEqual({ count: 1, declared: -3000, actualCost: 0, proposal: -3000, settled: -3000 });
    expect(m.contractOutput).toBe(50000);
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null, extra: 28734, increase: 0, change: 11837, minus: -3000, proposed: 1_000_000 + 28734 + 11837 - 3000,
    });
    expect(m.rates).toEqual(RATES);
    expect(m.period).toEqual({ kind: 'all', month: null });
  });
  it('未確定の現場は当初 = 概算金額', () => {
    const m = buildChangeLedger(input([nov5()], { site: site({ contractStatus: 'tentative', estimatedAmount: 800_000 }) }), RATES, ALL);
    expect(m.settlement).toEqual({ base: 800_000, baseBasis: 'estimate', through: null, extra: 0, increase: 0, change: 0, minus: -3000, proposed: 797_000 });
  });
  it('当初が無ければ base・proposed は null（未確定で概算なし、確定で請負金額なし）', () => {
    const tentative = buildChangeLedger(input([nov5()], { site: site({ contractStatus: 'tentative', estimatedAmount: null }) }), RATES, ALL);
    expect(tentative.settlement).toMatchObject({ base: null, baseBasis: 'estimate', proposed: null, minus: -3000 });
    const fixed = buildChangeLedger(input([nov5()], { site: site({ contractAmount: null }) }), RATES, ALL);
    expect(fixed.settlement).toMatchObject({ base: null, baseBasis: 'contract', proposed: null });
  });
});

describe('期間', () => {
  it('月を指定するとその月の行だけ（回目は現場の全日報で数える）', () => {
    const m = buildChangeLedger(input([nov5(), nov2(), oct20()]), RATES, NOV);
    expect(m.rows.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-02', '2026-11-05']);
    expect(m.rows[0]).toMatchObject({ monthIndex: 1, totalIndex: 2 });
    expect(m.summary.extra.count).toBe(1);
    expect(m.contractOutput).toBe(50000);
    expect(m.period).toEqual({ kind: 'month', month: '2026-11' });
  });
  it('追加・増・変更・減の行が無ければ isEmpty（集計は 0、精算提案額 = 当初）', () => {
    const m = buildChangeLedger(input([report('2026-11-02', [labor(1, 18000), work('contract', 1, 1, 1000)])]), RATES, ALL);
    expect(m.isEmpty).toBe(true);
    expect(m.rows).toEqual([]);
    expect(m.summary.extra).toEqual({ count: 0, declared: 0, actualCost: 0, proposal: 0, settled: 0 });
    expect(m.settlement.proposed).toBe(1_000_000);
    expect(buildChangeLedger(input([]), RATES, NOV).isEmpty).toBe(true);
  });
});

describe('増（同じ流れの中で数量が増えたもの）', () => {
  // 11/02：労務 20,000・1 人工、材料 3,000。作業内容の人工：契約内 1、追加 1、増 1（計 3）。
  const r = () =>
    report('2026-11-02', [labor(1, 20000), cash(3000), work('contract', 1, 10, 1000), work('extra', 1, 1, 1000), work('increase', 1, 4, 2500)]);

  it('増は追加と同じく実績原価から提案額（実績原価 ×（1＋経費率）×（1＋利益率）を切り上げ）', () => {
    const m = buildChangeLedger(input([r()]), RATES, ALL);
    expect(m.rows.map((x) => x.changeKind)).toEqual(['extra', 'increase']);
    const inc = m.rows[1];
    expect(inc).toMatchObject({ declared: 10000, manDays: 1, proposalBasis: 'cost' });
    // 労務 20,000 × 1 ÷ 1 ＋ 材料 3,000 × 1 ÷ 3 = 21,000 → 21,000 × 1.265 = 26,565
    expect(inc.actualCost).toEqual({ labor: 20000, other: 1000, total: 21000 });
    expect(inc.proposal).toBe(26565);
    expect(inc.proposal).toBe(m.rows[0].proposal); // 同じ人工の追加と同じ計算
  });
  it('区分ごとの集計に「増」があり、精算提案額 = 当初 ＋ 追加 ＋ 増 ＋ 変更 ＋ 減', () => {
    const m = buildChangeLedger(input([r(), nov5()]), RATES, ALL);
    expect(m.summary.increase).toEqual({ count: 1, declared: 10000, actualCost: 21000, proposal: 26565, settled: 26565 });
    expect(m.summary.extra).toMatchObject({ count: 1, proposal: 26565 });
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null,
      extra: 26565, increase: 26565, change: 0, minus: -3000, proposed: 1_000_000 + 26565 + 26565 - 3000,
    });
  });
});

describe('減の行の実績原価（ルール 3）', () => {
  it('減の行は人工があっても実績原価 0。その人工はその日の按分の分母には入る', () => {
    // 労務 20,000・1 人工、材料 3,000。作業内容の人工：追加 1、減 2（計 3）
    const r = report('2026-11-02', [labor(1, 20000), cash(3000), work('extra', 1, 1, 1000), work('minus', 2, 1, 500)]);
    const m = buildChangeLedger(input([r]), RATES, ALL);
    const [extra, minus] = m.rows;
    expect(minus.actualCost).toEqual({ labor: 0, other: 0, total: 0 });
    expect(minus).toMatchObject({ manDays: 2, declared: -500, proposal: -500, proposalBasis: 'declared' });
    // 追加の材料等は 3,000 × 1 ÷ 3（減の 2 人工も分母）= 1,000
    expect(extra.actualCost).toEqual({ labor: 20000, other: 1000, total: 21000 });
    expect(m.summary.minus.actualCost).toBe(0);
  });
});

describe('月の期間の精算提案額（ルール 2）', () => {
  // 10 月：追加 1 件（材料 4,000 → 提案 5,060）。11 月：nov2（追加 23,674・変更 11,837）と nov5（減 −3,000）。12 月：追加（範囲外）
  const dec = report('2026-12-01', [cash(10000), work('extra', 1, 1, 1000)]);
  const reports = [oct20(), nov2(), nov5(), dec];

  it('一覧・集計はその月だけ、精算は現場の最初の日報から月末まで（through = 月末）', () => {
    const m = buildChangeLedger(input(reports), RATES, NOV);
    expect(m.rows.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-02', '2026-11-05']);
    expect(m.summary.extra).toMatchObject({ count: 1, proposal: 23674 });
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: '2026-11-30',
      extra: 5060 + 23674, increase: 0, change: 11837, minus: -3000, proposed: 1_000_000 + 5060 + 23674 + 11837 - 3000,
    });
  });

  it('工期全体は through null で全部の行', () => {
    const m = buildChangeLedger(input(reports), RATES, ALL);
    expect(m.settlement.through).toBeNull();
    expect(m.settlement.extra).toBe(5060 + 23674 + 12650);
    expect(m.settlement.extra).toBe(m.summary.extra.proposal);
  });

  it('その月に行が無くても、前の月までの分は精算に入る（isEmpty は一覧の行の有無）', () => {
    const m = buildChangeLedger(input([oct20(), report('2026-11-02', [labor(1, 18000)])]), RATES, NOV);
    expect(m.isEmpty).toBe(true);
    expect(m.settlement).toMatchObject({ through: '2026-11-30', extra: 5060, proposed: 1_005_060 });
  });
});

// ─── 件ごとの精算（精算の方法：未定・一式・常用） ───

/** settleIssue に渡す行（使うのは人工と提案額だけ）。 */
const lrow = (manDays: number, proposal: number, changeKind: ChangeLedgerRow['changeKind'] = 'extra'): ChangeLedgerRow => ({
  date: '2026-11-02', reportId: 'r', monthIndex: 1, totalIndex: 1, changeKind, trade: '', description: '', qty: null, unit: '', unitPrice: null,
  declared: 0, manDays, instructedBy: null, instructionMethod: null, instructedOn: null, issue: null, clientConfirmed: false,
  actualCost: { labor: 0, other: 0, total: 0 }, proposal, proposalBasis: 'cost', affiliationManDays: [],
});

describe('settleIssue（件ごとの精算額の規則）', () => {
  it('未定：紐づく行の提案額の合計（減の行は負のまま）。行が無ければ 0', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x'), [lrow(1, 25300), lrow(0, -3000, 'minus')])).toEqual({
      settled: 22300, settledBasis: 'proposal', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x'), []).settled).toBe(0);
  });
  it('一式：確定額だけ（追加と減の混在行が紐づいても、行の提案額・人工は見ない）。確定額が無ければ 0', () => {
    const rows = [lrow(1, 25300), lrow(0, -3000, 'minus')];
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'lump_sum', fixedAmount: 50000 }), rows)).toEqual({
      settled: 50000, settledBasis: 'fixed', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'lump_sum', fixedAmount: null }), rows).settled).toBe(0);
  });
  it('減の件の一式は、確定額を正で入れても精算額は負', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x', { kind: 'minus', settlementMethod: 'lump_sum', fixedAmount: 30000 }), [])).toEqual({
      settled: -30000, settledBasis: 'fixed', category: 'minus', countsToward: true,
    });
  });
  it('見積：一式と同じ（見積額だけ、basis fixed、減は負、見積額が無ければ 0）', () => {
    const rows = [lrow(1, 25300), lrow(0, -3000, 'minus')];
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'estimate', fixedAmount: 120000 }), rows)).toEqual({
      settled: 120000, settledBasis: 'fixed', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { kind: 'minus', settlementMethod: 'estimate', fixedAmount: 30000 }), rows)).toEqual({
      settled: -30000, settledBasis: 'fixed', category: 'minus', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'estimate', fixedAmount: null }), rows).settled).toBe(0);
  });
  it('常用：紐づく行の人工の合計 × 単価を円未満切り上げ（浮動小数の誤差で 1 円多くしない）', () => {
    const daily = (dailyRate: number | null, o: Partial<Issue> = {}) => issue('a', '2026-11-02', 'x', { settlementMethod: 'daily_rate', dailyRate, ...o });
    expect(settleIssue(daily(25000), [lrow(1.5, 1), lrow(0.7, 1)])).toEqual({ settled: 55000, settledBasis: 'daily_rate', category: 'extra', countsToward: true });
    expect(settleIssue(daily(30000), [lrow(0.1, 1), lrow(0.2, 1)]).settled).toBe(9000);
    expect(settleIssue(daily(33333), [lrow(0.3, 1)]).settled).toBe(10000); // 9,999.9 → 10,000
    expect(settleIssue(daily(20000, { kind: 'minus' }), [lrow(1, 0, 'minus')]).settled).toBe(-20000);
  });
  it('常用で人工 0・単価なしは 0（減でも −0 にしない）', () => {
    const daily = (dailyRate: number | null, kind: Issue['kind'] = 'extra') => issue('a', '2026-11-02', 'x', { kind, settlementMethod: 'daily_rate', dailyRate });
    expect(settleIssue(daily(30000), [lrow(0, 0)]).settled).toBe(0);
    expect(settleIssue(daily(30000), []).settled).toBe(0);
    expect(settleIssue(daily(null), [lrow(2, 0)]).settled).toBe(0);
    expect(settleIssue(daily(30000, 'minus'), [lrow(0, 0, 'minus')]).settled).toBe(0);
  });
  it('種別 → 区分：客先都合・その他は追加、やり直しは数えない（countsToward false）', () => {
    const k = (kind: Issue['kind']) => settleIssue(issue('a', '2026-11-02', 'x', { kind }), []);
    expect(k('client_delay')).toMatchObject({ category: 'extra', countsToward: true });
    expect(k('other')).toMatchObject({ category: 'extra', countsToward: true });
    expect(k('increase')).toMatchObject({ category: 'increase', countsToward: true });
    expect(k('change')).toMatchObject({ category: 'change', countsToward: true });
    expect(k('rework')).toMatchObject({ category: null, countsToward: false });
  });
});

describe('件ごとの精算（buildChangeLedger の issues・unlinked・summary.settled）', () => {
  // 労務 20,000・1 人工の日：人工 1 の行の実績原価 20,000 → 提案 25,300、人工 0.5 → 12,650、1.5 → 37,950。
  const day = (date: string, lines: SavedReportLine[]) => report(date, [labor(1, 20000), ...lines]);
  const reports = () => [
    day('2026-11-02', [
      work('extra', 1, 1, 1000, { issueId: 'iU' }),
      work('extra', 1, 1, 1000, { issueId: 'iL' }),
      work('minus', 0, 1, 3000, { issueId: 'iL' }), // 一式の件に追加と減が混在
    ]),
    day('2026-11-05', [
      work('extra', 0.5, 1, 1000, { issueId: 'iU' }),
      work('change', 1.5, 1, 1000, { issueId: 'iD' }),
      work('extra', 1, 1, 1000), // 件なし
      work('extra', 1, 1, 1000, { issueId: 'gone' }), // 読めない件
    ]),
  ];
  const long = 'う'.repeat(45);
  const issues = () => [
    issue('iU', '2026-11-02', `  ${long}  `, { instructedBy: '施主 山田様', instructionMethod: 'oral', amountEstimate: 40000 }),
    issue('iM', '2026-11-05', '巾木をやめる', { kind: 'minus', settlementMethod: 'lump_sum', fixedAmount: 30000, fixedOn: '2026-11-20' }),
    issue('iL', '2026-11-02', '棚の追加', { settlementMethod: 'lump_sum', fixedAmount: 100000 }),
    issue('iD', '2026-11-05', '扉の変更', { kind: 'change', settlementMethod: 'daily_rate', dailyRate: 30000 }),
    issue('iR', '2026-11-05', '手直し', { kind: 'rework', settlementMethod: 'lump_sum', fixedAmount: 8000 }),
    issue('iN', '2026-11-05', '行の無い未定の件'),
  ];
  const m = buildChangeLedger(input(reports(), { issues: issues() }), RATES, ALL);

  it('載せる件：一式・常用の件と、行が紐づく未定の件（日付順、同じ日は登録順）。未定で行の無い件は載らない', () => {
    expect(m.issues.map((i) => i.id)).toEqual(['iU', 'iL', 'iM', 'iD', 'iR']);
  });
  it('件の番号は根拠の件（ChangeIssueRef.number）と同じ：その日報の件の中での登録順', () => {
    expect(m.issues.map((i) => i.number)).toEqual([1, 2, 1, 2, 3]);
    const ref = m.rows.find((r) => r.issue?.id === 'iD')?.issue;
    expect(ref?.number).toBe(m.issues.find((i) => i.id === 'iD')?.number);
  });
  it('件の項目（本文は先頭 40 字）と、紐づく行の件数・人工・実績原価・提案額', () => {
    const [u, l, mi, d] = m.issues;
    expect(u).toMatchObject({
      reportDate: '2026-11-02', kind: 'extra', bodyHead: 'う'.repeat(40), instructedBy: '施主 山田様', amountEstimate: 40000,
      settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null,
      lineCount: 2, manDays: 1.5, actualCost: 30000, proposal: 25300 + 12650, settled: 25300 + 12650, settledBasis: 'proposal', category: 'extra', countsToward: true,
    });
    expect(l).toMatchObject({ lineCount: 2, manDays: 1, actualCost: 20000, proposal: 25300 - 3000, settled: 100000, settledBasis: 'fixed' });
    // 行の無い一式の件も lineCount 0 で載る
    expect(mi).toMatchObject({ lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: -30000, category: 'minus', fixedOn: '2026-11-20' });
    expect(d).toMatchObject({ lineCount: 1, manDays: 1.5, settled: 45000, settledBasis: 'daily_rate', category: 'change', dailyRate: 30000 });
  });
  it('やり直しの件は参考（countsToward false）で合計に入らない', () => {
    expect(m.issues[4]).toMatchObject({ id: 'iR', settled: 8000, category: null, countsToward: false });
  });
  it('unlinked：件に紐づかない行（未選択・読めない件）の合計', () => {
    expect(m.unlinked).toMatchObject({ lineCount: 2, manDays: 2, actualCost: 40000, proposal: 50600 });
    // 労務の行が手入力（所属なし）だけの日なので、所属別の人工は全部が所属なし
    expect(m.unlinked.affiliationManDays.map((p) => [p.label, p.manDays])).toEqual([['所属なし', 2]]);
  });
  it('区分ごとの精算額 = 件の精算額（区分ごと）＋ 件に紐づかない行の提案額。一式の件に紐づく行の提案額は数えない', () => {
    expect(m.summary.extra.settled).toBe(25300 + 12650 + 100000 + 50600);
    expect(m.summary.increase.settled).toBe(0);
    expect(m.summary.change.settled).toBe(45000);
    // 減の件の一式（正で入れた 30,000）は負で引かれる。一式の件 iL に紐づく減の行（−3,000）は入らない
    expect(m.summary.minus.settled).toBe(-30000);
    // 件数・申告額・提案額は行のまま（既存どおり）
    expect(m.summary.extra).toMatchObject({ count: 5, proposal: 25300 * 4 + 12650 });
    expect(m.summary.minus).toMatchObject({ count: 1, proposal: -3000 });
  });
  it('精算提案額は区分ごとの精算額から（当初 ＋ 追加 ＋ 増 ＋ 変更 ＋ 減）', () => {
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null,
      extra: 188550, increase: 0, change: 45000, minus: -30000, proposed: 1_000_000 + 188550 + 45000 - 30000,
    });
  });
  it('客先都合の件は追加に入る', () => {
    const c = buildChangeLedger(
      input([day('2026-11-02', [])], { issues: [issue('c', '2026-11-02', '客先都合の待機', { kind: 'client_delay', settlementMethod: 'lump_sum', fixedAmount: 20000 })] }),
      RATES, ALL,
    );
    expect(c.summary.extra.settled).toBe(20000);
    expect(c.settlement.extra).toBe(20000);
  });
  it('行も件も無ければ isEmpty。行が無くても一式の件があれば isEmpty でない', () => {
    expect(buildChangeLedger(input([day('2026-11-02', [])], { issues: [issue('n', '2026-11-02', '未定・行なし')] }), RATES, ALL).isEmpty).toBe(true);
    const lump = buildChangeLedger(
      input([day('2026-11-02', [])], { issues: [issue('l', '2026-11-02', '一式', { settlementMethod: 'lump_sum', fixedAmount: 5000 })] }),
      RATES, ALL,
    );
    expect(lump.isEmpty).toBe(false);
    expect(lump.rows).toEqual([]);
    expect(lump.unlinked).toEqual({ lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, affiliationManDays: [] });
  });
});

describe('客先用の精算額（clientSettlement）', () => {
  // 労務 20,000・1 人工の日：人工 1 の行の実績原価 20,000 → 提案 25,300、人工 0.5 → 12,650。
  const day = (date: string, lines: SavedReportLine[], o: Partial<ReportWithLines> = {}) => report(date, [labor(1, 20000), ...lines], o);
  const reports = () => [
    day('2026-11-02', [
      work('extra', 1, 1, 1000, { issueId: 'aL' }), // 一式（確定）に紐づく行：提案額は数えない
      work('extra', 1, 1, 1000, { issueId: 'aU' }), // 未定（見積中）に紐づく行：提案額を客先用に入れない
      work('extra', 1, 1, 1000), // 件なし（追加）25,300
      work('minus', 0, 1, 3000), // 件なし（減）−3,000
    ], { clientConfirmedAt: '2026-11-02T08:00:00Z' }),
    day('2026-11-05', [
      work('change', 1.5, 1, 1000, { issueId: 'aD' }),
      work('extra', 1, 1, 1000, { issueId: 'aR' }),
      work('increase', 0.5, 1, 1000, { issueId: 'aE' }),
      work('increase', 1, 1, 1000), // 件なし（増）25,300
    ]),
  ];
  const issues = () => [
    issue('aL', '2026-11-02', '棚の追加', { settlementMethod: 'lump_sum', fixedAmount: 100000, instructionMethod: 'oral' }),
    issue('aU', '2026-11-02', '照明の追加（見積中）'),
    issue('aM', '2026-11-05', '巾木をやめる', { kind: 'minus', settlementMethod: 'lump_sum', fixedAmount: 30000 }),
    issue('aD', '2026-11-05', '扉の変更', { kind: 'change', settlementMethod: 'daily_rate', dailyRate: 30000 }),
    issue('aE', '2026-11-05', '確定額の無い一式', { kind: 'increase', settlementMethod: 'lump_sum', fixedAmount: null }),
    issue('aR', '2026-11-05', '手直し', { kind: 'rework', settlementMethod: 'lump_sum', fixedAmount: 8000 }),
    issue('aP', '2026-11-05', '単価の無い常用', { settlementMethod: 'daily_rate', dailyRate: null }),
    issue('aN', '2026-11-05', '行の無い未定の件'),
  ];
  const m = buildChangeLedger(input(reports(), { issues: issues() }), RATES, ALL);
  const c = clientSettlement(m);

  it('件なしの行の提案額（期間末まで）を区分ごとに持つ', () => {
    expect(m.unlinkedByKind).toEqual({ extra: 25300, increase: 25300, change: 0, minus: -3000 });
  });
  it('区分ごと：確定した件（一式＝確定額、常用＝人工×単価）の精算額 ＋ 件なしの行の提案額。件数は確定した件だけ。減は負', () => {
    expect(c.kinds).toEqual({
      extra: { count: 1, amount: 100000 + 25300 },
      increase: { count: 0, amount: 25300 },
      change: { count: 1, amount: 45000 },
      minus: { count: 1, amount: -30000 - 3000 },
    });
  });
  it('見積中（未定・確定額の無い一式・単価の無い常用）は金額に入れず pendingCount に数える', () => {
    expect(c.pendingCount).toBe(3);
    expect([...c.pendingIds].sort()).toEqual(['aE', 'aP', 'aU']);
  });
  it('精算提案額 = 当初 ＋ 区分ごとの金額（社内用の settlement.proposed とは見積中の分だけ違う）', () => {
    expect(c.base).toBe(1_000_000);
    expect(c.baseBasis).toBe('contract');
    expect(c.proposed).toBe(1_000_000 + 125300 + 25300 + 45000 - 33000);
    expect(m.settlement.proposed).not.toBe(c.proposed);
  });
  it('載せる件：やり直しを除く（見積中は含む）、日付順。未定で行の無い件は載らない', () => {
    expect(c.issues.map((i) => i.id)).toEqual(['aL', 'aU', 'aM', 'aD', 'aE', 'aP']);
  });
  it('当初が無ければ base・proposed は null（区分ごとの金額は出す）', () => {
    const none = clientSettlement(buildChangeLedger(input(reports(), { site: site({ contractAmount: null }), issues: issues() }), RATES, ALL));
    expect(none.base).toBeNull();
    expect(none.proposed).toBeNull();
    expect(none.kinds.change.amount).toBe(45000);
  });
  it('見積中の件が無ければ pendingCount 0', () => {
    const only = clientSettlement(
      buildChangeLedger(input([day('2026-11-02', [])], { issues: [issue('x', '2026-11-02', '一式', { settlementMethod: 'lump_sum', fixedAmount: 5000 })] }), RATES, ALL),
    );
    expect(only).toMatchObject({ pendingCount: 0, proposed: 1_005_000 });
    expect(only.pendingIds.size).toBe(0);
  });
  it('見積：見積額があれば確定（区分に足し件数 1）、減は負。見積額が無ければ見積中', () => {
    const est = clientSettlement(
      buildChangeLedger(
        input([day('2026-11-02', [])], {
          issues: [
            issue('e1', '2026-11-02', '見積の追加', { settlementMethod: 'estimate', fixedAmount: 120000, fixedOn: '2026-11-06' }),
            issue('e2', '2026-11-02', '見積の減', { kind: 'minus', settlementMethod: 'estimate', fixedAmount: 20000 }),
            issue('e3', '2026-11-02', '見積額の無い見積', { kind: 'increase', settlementMethod: 'estimate', fixedAmount: null }),
          ],
        }),
        RATES,
        ALL,
      ),
    );
    expect(est.kinds.extra).toEqual({ count: 1, amount: 120000 });
    expect(est.kinds.minus).toEqual({ count: 1, amount: -20000 });
    expect(est.kinds.increase).toEqual({ count: 0, amount: 0 });
    expect([...est.pendingIds]).toEqual(['e3']);
    expect(est.proposed).toBe(1_000_000 + 120000 - 20000);
  });
  it('件の reportClientConfirmed：その件を登録した日報に客先確認があるか。instructionMethod も持つ', () => {
    const byId = new Map(m.issues.map((i) => [i.id, i]));
    expect(byId.get('aL')).toMatchObject({ reportClientConfirmed: true, instructionMethod: 'oral' });
    expect(byId.get('aU')?.reportClientConfirmed).toBe(true);
    expect(byId.get('aM')).toMatchObject({ reportClientConfirmed: false, instructionMethod: null });
  });
});

describe('件ごとの精算（月指定）', () => {
  const SEP = { kind: 'month', month: '2026-09' } as const;
  const OCT = { kind: 'month', month: '2026-10' } as const;
  const day = (date: string, lines: SavedReportLine[]) => report(date, [labor(1, 20000), ...lines]);
  const reports = () => [
    day('2026-09-10', [work('extra', 1, 1, 1000, { issueId: 'i9' }), work('extra', 1, 1, 1000, { issueId: 'iD' })]),
    day('2026-10-05', [work('extra', 0.5, 1, 1000, { issueId: 'iD' }), work('extra', 1, 1, 1000, { issueId: 'iU' })]),
  ];
  const issues = () => [
    // 9 月に登録し、12 月に一式で確定した件
    issue('i9', '2026-09-10', '9 月の件', { settlementMethod: 'lump_sum', fixedAmount: 50000, fixedOn: '2026-12-15' }),
    issue('iD', '2026-09-10', '常用の件', { settlementMethod: 'daily_rate', dailyRate: 30000 }),
    // 10 月に登録した一式の件
    issue('i10', '2026-10-05', '10 月の件', { settlementMethod: 'lump_sum', fixedAmount: 70000 }),
    // 9 月に登録した未定の件。行は 10 月だけ
    issue('iU', '2026-09-10', '未定の件'),
  ];
  const ledger = (period: typeof SEP | typeof OCT | typeof ALL) => buildChangeLedger(input(reports(), { issues: issues() }), RATES, period);

  it('9 月登録・12 月に一式確定の件は 9 月の資料に出る。10 月登録の一式は 9 月に出ない', () => {
    const sep = ledger(SEP);
    expect(sep.issues.map((i) => i.id)).toEqual(['i9', 'iD']);
    expect(sep.issues[0]).toMatchObject({ settled: 50000, fixedOn: '2026-12-15' });
    expect(ledger(OCT).issues.map((i) => i.id)).toEqual(['i9', 'iD', 'iU', 'i10']);
  });
  it('常用は月末までの行の人工で計算する', () => {
    expect(ledger(SEP).issues.find((i) => i.id === 'iD')).toMatchObject({ lineCount: 1, manDays: 1, settled: 30000 });
    expect(ledger(OCT).issues.find((i) => i.id === 'iD')).toMatchObject({ lineCount: 2, manDays: 1.5, settled: 45000 });
    expect(ledger(ALL).issues.find((i) => i.id === 'iD')).toMatchObject({ settled: 45000 });
  });
  it('未定の件は月末までに行が無ければ載らない', () => {
    expect(ledger(SEP).issues.some((i) => i.id === 'iU')).toBe(false);
    expect(ledger(OCT).issues.find((i) => i.id === 'iU')).toMatchObject({ lineCount: 1, settled: 25300 });
  });
  it('区分ごとの精算額は月末までの累計（件数・提案額はその月だけ）', () => {
    const sep = ledger(SEP);
    expect(sep.summary.extra).toMatchObject({ count: 2, proposal: 25300 * 2, settled: 50000 + 30000 });
    expect(sep.settlement).toMatchObject({ through: '2026-09-30', extra: 80000, proposed: 1_080_000 });
    const oct = ledger(OCT);
    expect(oct.summary.extra).toMatchObject({ count: 2, proposal: 12650 + 25300, settled: 50000 + 45000 + 70000 + 25300 });
  });
  it('その月に行が無くても、月末までに載る件があれば isEmpty でない', () => {
    const nov = buildChangeLedger(input(reports(), { issues: issues() }), RATES, NOV);
    expect(nov.rows).toEqual([]);
    expect(nov.isEmpty).toBe(false);
  });
});

// ─── 所属別の人工（社内用）：作業内容の人工を、その日の労務の行の所属別の人工比で按分 ───

describe('所属別の人工（行・件ごと・件なし）', () => {
  const aLabor = (manDays: number, affiliation: 'own' | 'partner' | null, supplierId: string | null = null): SavedReportLine =>
    ({ ...labor(manDays, manDays * 20000), affiliation, supplierId, laborContract: affiliation === 'partner' ? 'ukeoi' : null }) as SavedReportLine;
  const suppliers = [{ id: 'pA', name: '〇〇工業', category: null, contact: null, note: null, active: true, isVendor: false, isPartner: true, updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' }];
  const reports = [
    // 自社 2・〇〇工業 1 → 追加 1.5 人工は 自社 1.0／〇〇工業 0.5
    report('2026-11-02', [aLabor(2, 'own'), aLabor(1, 'partner', 'pA'), work('extra', 1.5, 1, 1000, { issueId: 'i1' })]),
    // 自社 1・〇〇工業 1・所属なし 1 → 1 人工は 0.34／0.33／0.33（端数は並びの先の自社）
    report('2026-11-03', [aLabor(1, 'own'), aLabor(1, 'partner', 'pA'), aLabor(1, null), work('extra', 1, 1, 1000, { issueId: 'i1' })]),
    // 労務の行が無い日：全部が所属なし（件なしの行）
    report('2026-11-04', [work('change', 0.7, 1, 1000)]),
  ];
  const m = buildChangeLedger(input(reports, { suppliers, issues: [issue('i1', '2026-11-02', 'クロス')] }), RATES, ALL);
  const pairs = (parts: { label: string; manDays: number }[]) => parts.map((p) => [p.label, p.manDays]);

  it('行ごと：その日の労務の行の所属（写し）別の人工比。和は行の人工と一致', () => {
    expect(m.rows.map((r) => pairs(r.affiliationManDays))).toEqual([
      [['自社', 1], ['〇〇工業', 0.5]],
      [['自社', 0.34], ['〇〇工業', 0.33], ['所属なし', 0.33]],
      [['所属なし', 0.7]],
    ]);
    for (const r of m.rows) expect(Math.round(r.affiliationManDays.reduce((s, p) => s + p.manDays, 0) * 1e9) / 1e9).toBe(r.manDays);
  });

  it('件ごと・件なし：紐づく行の和（会社ごと）。和は件の人工と一致', () => {
    expect(pairs(m.issues[0].affiliationManDays)).toEqual([['自社', 1.34], ['〇〇工業', 0.83], ['所属なし', 0.33]]);
    expect(m.issues[0].affiliationManDays.reduce((s, p) => s + p.manDays, 0)).toBeCloseTo(m.issues[0].manDays, 9);
    expect(pairs(m.unlinked.affiliationManDays)).toEqual([['所属なし', 0.7]]);
  });

  it('取引先が読めない（suppliers を渡さない）ときは「協力会社」', () => {
    const noNames = buildChangeLedger(input(reports, { issues: [issue('i1', '2026-11-02', 'クロス')] }), RATES, ALL);
    expect(pairs(noNames.rows[0].affiliationManDays)).toEqual([['自社', 1], ['協力会社', 0.5]]);
  });
});
