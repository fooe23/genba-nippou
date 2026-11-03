import { describe, it, expect } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { allocateDayCost, buildChangeLedger, dayCostBasis, proposalFromCost } from '@/lib/reports/change-model';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { ChangeLedgerInput, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import type { ChangeKind, WorkLine } from '@/lib/types';

// ─── 小さな手作りの入力 ───

const site = (o: Partial<Site> = {}): Site => ({
  id: 's1', name: '〇〇邸改修工事', clientName: '〇〇様', projectName: null, projectNo: 'K-002', overview: null,
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: null, contractType: '下請', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, ...o,
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
  instructedBy: null, instructionMethod: null, amountEstimate: null, ...o,
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
    expect(m.summary.minus).toEqual({ count: 1, declared: -3000, actualCost: 0, proposal: -3000 });
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
    expect(m.summary.extra).toEqual({ count: 0, declared: 0, actualCost: 0, proposal: 0 });
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
    expect(m.summary.increase).toEqual({ count: 1, declared: 10000, actualCost: 21000, proposal: 26565 });
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
