import { describe, it, expect } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { buildChangeLedger, clientSettlement, dayCostBasis, laborShare, settleIssue, settlementProposal, type ProposalBasis } from '@/lib/reports/change-model';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { ChangeLedgerInput, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import type { ChangeKind, WorkLine } from '@/lib/types';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';

// ─── 小さな手作りの入力 ───

const site = (o: Partial<Site> = {}): Site => ({
  id: 's1', name: '〇〇邸改修工事', clientName: '〇〇様', projectName: null, projectNo: 'K-002', overview: null,
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: null, contractType: '下請', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null, ...o,
});

const stored = (amount: number, manDays = 0) => ({ amount, manDays, overtimeHours: 0, hours: manDays * 8 });
const labor = (manDays: number, cost: number): SavedReportLine => ({
  kind: 'labor', workerId: null, workerName: '作業員', time: { start: null, end: null, breakMin: null, gapMin: null },
  dailyRate: 99_999, note: '', overtimeRate: null, stored: stored(cost, manDays),
});
const fuel = (cost: number, o: Record<string, unknown> = {}): SavedReportLine => ({
  kind: 'fuel', vehicleId: null, vehicleName: '車', kmPerL: 10, distanceKm: 1, pricePerL: 1, note: '', stored: stored(cost), issueId: null, ...o,
}) as SavedReportLine;
const lease = (cost: number, o: Record<string, unknown> = {}): SavedReportLine => ({
  kind: 'lease', itemId: null, itemName: '足場', spec: '', unit: '日', qty: 1, unitPrice: 1, note: '', stored: stored(cost), issueId: null, ...o,
}) as SavedReportLine;
const cash = (cost: number, o: Record<string, unknown> = {}): SavedReportLine => ({
  kind: 'cash', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 1, vendor: '', stored: stored(cost), issueId: null, ...o,
}) as SavedReportLine;
const credit = (cost: number, o: Record<string, unknown> = {}): SavedReportLine => ({
  kind: 'credit', itemName: '合板', spec: '', unit: '枚', qty: 1, unitPrice: 1, supplierId: null, vendor: '', stored: stored(cost), purchaseKind: 'material', siteTradeId: null, issueId: null, ...o,
}) as SavedReportLine;
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
    ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind, ...o, stored: stored(changeKind === 'minus' ? -a : a, manDays),
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

/** 計算を追いやすい率：労務は ×1.1 ×1.1（施工金額 1,000 → 1,210）。 */
const RATES = { legalWelfareRate: 0.1, materialExpenseRate: 0.2, leaseFuelExpenseRate: 0.3, overheadProfitRate: 0.1 };
/** 設定の既定（法定福利費 15.1%・材料経費 12%・リース燃料経費 12%・諸経費 8%）。 */
const DEF = { legalWelfareRate: 0.151, materialExpenseRate: 0.12, leaseFuelExpenseRate: 0.12, overheadProfitRate: 0.08 };
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

describe('dayCostBasis・laborShare（労務の実績原価）', () => {
  it('行の投入人工 × その日の平均日当（労務費 ÷ 労務の人工）。燃料・リース・現金・買掛は見ない', () => {
    const day = dayCostBasis(nov2());
    expect(day).toEqual({ laborCost: 25500, laborManDays: 1.5 });
    expect(laborShare(day, 1)).toBeCloseTo(17000, 9);
    expect(laborShare(day, 0.5)).toBeCloseTo(8500, 9);
  });
  it('労務が無い日・行の人工 0 は 0', () => {
    expect(laborShare(dayCostBasis(oct20()), 1)).toBe(0);
    expect(laborShare({ laborCost: 18000, laborManDays: 1 }, 0)).toBe(0);
  });
  it('dayCostBasis は保存値（stored）だけを足す（日当・数量は見ない）', () => {
    expect(dayCostBasis(nov5())).toEqual({ laborCost: 18000, laborManDays: 1 });
  });
  it('請負の会社の行は、うち常用の時間の分だけ（労務費の決まり。2026-11-17）：平均日当に請負の人工が入らない', () => {
    const partnerLabor = (jouyouHours: number | null): SavedReportLine =>
      ({ ...labor(1, 22000), dailyRate: 22000, affiliation: 'partner', supplierId: 'tohoku', laborContract: 'ukeoi', jouyouHours }) as SavedReportLine;
    // 大江（自社 1 人工 ¥20,000）＋ A（請負・うち常用 4 H → 0.5 人工 ¥11,000）＋ B（請負・空欄 → 0）
    const day = dayCostBasis(report('2026-11-10', [labor(1, 20000), partnerLabor(4), partnerLabor(null)]));
    expect(day).toEqual({ laborCost: 31000, laborManDays: 1.5 });
    expect(laborShare(day, 1)).toBeCloseTo(31000 / 1.5, 9);
    // 実行予算の常用の単価（¥25,000）を渡せば A は ¥12,500
    expect(dayCostBasis(report('2026-11-10', [partnerLabor(4)]), { jouyouRates: { tohoku: 25000 }, rule: DEFAULT_LABOR_RULE })).toEqual({
      laborCost: 12500,
      laborManDays: 0.5,
    });
  });
});

describe('settlementProposal（提案額の式と丸め）', () => {
  const b = (o: Partial<ProposalBasis>): ProposalBasis => ({ laborAmount: 0, material: 0, lease: 0, fuel: 0, subcontract: 0, ...o });
  it('（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋（リース＋燃料）×（1＋リース燃料経費率））×（1＋諸経費率）＋ 外注、円未満切り上げ', () => {
    // 村山様邸 11/10：労務（施工金額）25,000・材料 25,000 → (28,775 ＋ 28,000) × 1.08 = 61,317（浮動小数の誤差で 1 円多くしない）
    expect(settlementProposal(b({ laborAmount: 25000, material: 25000 }), DEF)).toBe(61317);
    // リース・燃料はリース燃料経費率、外注は率を掛けずにそのまま足す
    const r = { legalWelfareRate: 0, materialExpenseRate: 0.2, leaseFuelExpenseRate: 0.5, overheadProfitRate: 0.1 };
    expect(settlementProposal(b({ material: 1000, lease: 1000, fuel: 1000 }), r)).toBe(4620); // (1,200 ＋ 1,500 ＋ 1,500) × 1.1
    expect(settlementProposal(b({ subcontract: 170000 }), r)).toBe(170000);
    expect(settlementProposal(b({ laborAmount: 1000, subcontract: 0.4 }), r)).toBe(1101); // 1,100.4 → 1,101
  });
  it('割り切れない額は切り上げ、全部 0 なら 0', () => {
    expect(settlementProposal(b({ laborAmount: 10000 }), DEF)).toBe(12431); // 12,430.8
    expect(settlementProposal(b({}), DEF)).toBe(0);
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
  it('実績原価は労務だけ（その日の燃料・リース・現金・買掛は按分しない）、提案額は施工金額から', () => {
    const extra = m.rows[1];
    expect(extra.actualCost).toBeCloseTo(17000, 9);
    expect(extra).toMatchObject({ laborAmount: 30000, missingAmount: false, proposal: 36300, proposalBasis: 'cost' }); // 30,000 × 1.1 × 1.1
    const change = m.rows[2];
    expect(change.actualCost).toBeCloseTo(8500, 9);
    expect(change).toMatchObject({ laborAmount: 5000, proposal: 6050 });
    // 10/20：労務なし。材料 4,000 は根拠が無いので数えない
    expect(m.rows[0]).toMatchObject({ actualCost: 0, laborAmount: 8000, proposal: 9680 });
  });
  it('減は申告額（負）がそのまま提案額。実績原価・労務 0', () => {
    expect(m.rows[3]).toMatchObject({ declared: -3000, proposal: -3000, proposalBasis: 'declared', actualCost: 0, laborAmount: 0, missingAmount: false });
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
    expect(m.summary.extra).toMatchObject({ count: 2, declared: 38000, proposal: 9680 + 36300 });
    expect(m.summary.extra.actualCost).toBeCloseTo(17000, 6);
    expect(m.summary.change).toMatchObject({ count: 1, declared: 5000, proposal: 6050 });
    expect(m.summary.minus).toEqual({ count: 1, declared: -3000, actualCost: 0, proposal: -3000, settled: -3000 });
    expect(m.contractOutput).toBe(50000);
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null, extra: 45980, increase: 0, change: 6050, minus: -3000, proposed: 1_000_000 + 45980 + 6050 - 3000,
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
  // 11/02：労務 20,000・1 人工、材料 3,000（根拠なし）。作業内容：契約内 1 人工、追加 1 人工（1,000）、増 1 人工（4 × 2,500）。
  const r = () =>
    report('2026-11-02', [labor(1, 20000), cash(3000), work('contract', 1, 10, 1000), work('extra', 1, 1, 1000), work('increase', 1, 4, 2500)]);

  it('増は追加と同じく施工金額から提案額（根拠の無い材料は数えない）', () => {
    const m = buildChangeLedger(input([r()]), RATES, ALL);
    expect(m.rows.map((x) => x.changeKind)).toEqual(['extra', 'increase']);
    expect(m.rows[1]).toMatchObject({ declared: 10000, manDays: 1, proposalBasis: 'cost', actualCost: 20000, laborAmount: 10000, proposal: 12100 });
    expect(m.rows[0]).toMatchObject({ actualCost: 20000, laborAmount: 1000, proposal: 1210 });
  });
  it('区分ごとの集計に「増」があり、精算提案額 = 当初 ＋ 追加 ＋ 増 ＋ 変更 ＋ 減', () => {
    const m = buildChangeLedger(input([r(), nov5()]), RATES, ALL);
    expect(m.summary.increase).toEqual({ count: 1, declared: 10000, actualCost: 20000, proposal: 12100, settled: 12100 });
    expect(m.summary.extra).toMatchObject({ count: 1, proposal: 1210 });
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null,
      extra: 1210, increase: 12100, change: 0, minus: -3000, proposed: 1_000_000 + 1210 + 12100 - 3000,
    });
  });
});

describe('減の行', () => {
  it('減の行は人工があっても実績原価・労務 0。根拠の無い材料はどの行にも入らない', () => {
    // 労務 20,000・1 人工、材料 3,000（根拠なし）。作業内容の人工：追加 1、減 2
    const r = report('2026-11-02', [labor(1, 20000), cash(3000), work('extra', 1, 1, 1000), work('minus', 2, 1, 500)]);
    const m = buildChangeLedger(input([r]), RATES, ALL);
    const [extra, minus] = m.rows;
    expect(minus).toMatchObject({ actualCost: 0, laborAmount: 0, manDays: 2, declared: -500, proposal: -500, proposalBasis: 'declared' });
    expect(extra).toMatchObject({ actualCost: 20000, proposal: 1210 });
    expect(m.summary.minus.actualCost).toBe(0);
  });
});

describe('月の期間の精算提案額', () => {
  // 10 月：追加 8,000 → 9,680。11 月：nov2（追加 36,300・変更 6,050）と nov5（減 −3,000）。12 月：追加 1,000 → 1,210（範囲外）
  const dec = report('2026-12-01', [cash(10000), work('extra', 1, 1, 1000)]);
  const reports = [oct20(), nov2(), nov5(), dec];

  it('一覧・集計はその月だけ、精算は現場の最初の日報から月末まで（through = 月末）', () => {
    const m = buildChangeLedger(input(reports), RATES, NOV);
    expect(m.rows.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-02', '2026-11-05']);
    expect(m.summary.extra).toMatchObject({ count: 1, proposal: 36300 });
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: '2026-11-30',
      extra: 9680 + 36300, increase: 0, change: 6050, minus: -3000, proposed: 1_000_000 + 9680 + 36300 + 6050 - 3000,
    });
  });

  it('工期全体は through null で全部の行', () => {
    const m = buildChangeLedger(input(reports), RATES, ALL);
    expect(m.settlement.through).toBeNull();
    expect(m.settlement.extra).toBe(9680 + 36300 + 1210);
    expect(m.settlement.extra).toBe(m.summary.extra.proposal);
  });

  it('その月に行が無くても、前の月までの分は精算に入る（isEmpty は一覧の行の有無）', () => {
    const m = buildChangeLedger(input([oct20(), report('2026-11-02', [labor(1, 18000)])]), RATES, NOV);
    expect(m.isEmpty).toBe(true);
    expect(m.settlement).toMatchObject({ through: '2026-11-30', extra: 9680, proposed: 1_009_680 });
  });
});

// ─── 件の精算（根拠にその件を選んだ行だけ。2026-11-11 の決まり） ───

describe('件の精算：根拠に選んだ行だけ・法定福利費・材料経費・リース燃料経費・諸経費・外注', () => {
  const murayama = issue('m1', '2026-11-10', '村山様邸 追加工事');
  // 村山様邸 11/10：作業員 1 人工（日当 20,000）、作業内容 追加 ¥25,000（根拠 m1）、仕入 ¥25,000（根拠 m1）、外注 ¥170,000（根拠なし）
  const nov10 = (extra: SavedReportLine[] = [], subIssue: string | null = null) =>
    report('2026-11-10', [
      labor(1, 20000),
      work('extra', 1, 1, 25000, { unit: '式', issueId: 'm1' }),
      credit(25000, { issueId: 'm1' }),
      credit(170000, { purchaseKind: 'subcontract', issueId: subIssue }),
      ...extra,
    ]);
  const ledger = (reports: ReportWithLines[], issues: Issue[] = [murayama], rates = DEF) => buildChangeLedger(input(reports, { issues }), rates, ALL);

  it('村山様邸：提案額 61,317・実績原価（参考）45,000。根拠の無い外注 170,000 は入らない', () => {
    const [i] = ledger([nov10()]).issues;
    expect(i).toMatchObject({ id: 'm1', lineCount: 1, manDays: 1, proposal: 61317, settled: 61317, settledBasis: 'proposal', actualCost: 45000 });
    expect(i.breakdown).toEqual({ laborAmount: 25000, laborCost: 20000, material: 25000, lease: 0, fuel: 0, subcontract: 0, missingAmountLines: 0 });
  });
  it('施工金額の無い行の仮の労務・実績原価は、原価に数える労務費だけの平均日当（請負の会社の人工は除く。2026-11-17）', () => {
    const b = { ...labor(1, 22000), dailyRate: 22000, affiliation: 'partner', supplierId: 'tohoku', laborContract: 'ukeoi', jouyouHours: null } as SavedReportLine;
    const r = report('2026-11-10', [labor(1, 20000), b, work('extra', 1, 1, null, { issueId: 'm1' })]);
    const [i] = ledger([r]).issues;
    // 平均日当 = 20,000 ÷ 1（B の 1 人工・¥22,000 は入らない）
    expect(i.breakdown).toMatchObject({ laborAmount: 20000, laborCost: 20000, missingAmountLines: 1 });
    expect(i.actualCost).toBe(20000);
  });
  it('根拠に件を選んだ外注は率を掛けずにそのまま足す（61,317 ＋ 170,000）', () => {
    const [i] = ledger([nov10([], 'm1')]).issues;
    expect(i).toMatchObject({ proposal: 231317, settled: 231317, actualCost: 215000 });
    expect(i.breakdown.subcontract).toBe(170000);
  });
  it('材料＝仕入の買掛＋現金、リース・燃料は別の項目でリース燃料経費率', () => {
    const r = report('2026-11-10', [cash(600, { issueId: 'm1' }), credit(400, { issueId: 'm1' }), lease(1000, { issueId: 'm1' }), fuel(1000, { issueId: 'm1' })]);
    const rates = { legalWelfareRate: 0, materialExpenseRate: 0.2, leaseFuelExpenseRate: 0.5, overheadProfitRate: 0.1 };
    const [i] = ledger([r], [murayama], rates).issues;
    expect(i.breakdown).toMatchObject({ material: 1000, lease: 1000, fuel: 1000, subcontract: 0 });
    expect(i.settled).toBe(4620);
  });
  it('根拠を選んでいない現金・買掛・リース・燃料は、どの件にも按分しない', () => {
    const more = nov10([cash(5000), lease(3000), fuel(2000), credit(9000)]);
    const [i] = ledger([more]).issues;
    expect(i).toMatchObject({ proposal: 61317, actualCost: 45000 });
  });
  it('読めない件・期間末の後の根拠の行は数えない', () => {
    const r = nov10([credit(1000, { issueId: 'gone' })]);
    expect(ledger([r]).issues[0].breakdown.material).toBe(25000);
    const dec = report('2026-12-01', [credit(7000, { issueId: 'm1' })]);
    const nov = buildChangeLedger(input([nov10(), dec], { issues: [murayama] }), DEF, NOV);
    expect(nov.issues[0].breakdown.material).toBe(25000);
    expect(ledger([nov10(), dec]).issues[0].breakdown.material).toBe(32000);
  });
  it('施工金額（施工単価）の無い行は、その行の人工 × 日当で仮に出し、行と件に印を付ける', () => {
    const r = report('2026-11-10', [labor(1, 20000), work('extra', 0.5, 1, null, { issueId: 'm1' }), work('change', 0.5, 2, 0, { issueId: 'm1' })]);
    const m = ledger([r]);
    expect(m.rows.map((x) => [x.missingAmount, x.laborAmount])).toEqual([[true, 10000], [true, 10000]]);
    expect(m.issues[0].breakdown).toMatchObject({ laborAmount: 20000, laborCost: 20000, missingAmountLines: 2 });
    expect(m.issues[0].settled).toBe(24862); // 20,000 × 1.151 × 1.08 = 24,861.6
    const unlinked = ledger([report('2026-11-10', [labor(1, 20000), work('extra', 1, 1, null)])]);
    expect(unlinked.unlinked).toMatchObject({ lineCount: 1, missingAmountLines: 1, proposal: 24862 });
  });
  it('作業内容の行が無く、根拠に選んだ現金・買掛・リース・燃料だけの未定の件も精算に載る', () => {
    const m = ledger([report('2026-11-10', [credit(10000, { issueId: 'm1' })])]);
    expect(m.issues.map((i) => i.id)).toEqual(['m1']);
    expect(m.issues[0]).toMatchObject({ lineCount: 0, manDays: 0, actualCost: 10000, settled: 12096 }); // 10,000 × 1.12 × 1.08
    expect(m.isEmpty).toBe(false);
    expect(m.summary.extra.settled).toBe(12096);
  });
  it('一式・見積は確定額、常用は人工 × 常用単価（率は掛けない）。内訳は参考として出る', () => {
    const lump = ledger([nov10()], [issue('m1', '2026-11-10', '一式', { settlementMethod: 'lump_sum', fixedAmount: 60000 })]).issues[0];
    expect(lump).toMatchObject({ settled: 60000, settledBasis: 'fixed', proposal: 61317 });
    expect(lump.breakdown.material).toBe(25000);
    const daily = ledger([nov10()], [issue('m1', '2026-11-10', '常用', { settlementMethod: 'daily_rate', dailyRate: 25000 })]).issues[0];
    expect(daily).toMatchObject({ settled: 25000, settledBasis: 'daily_rate' });
  });
  it('件に紐づく減の行は申告額をそのまま足す', () => {
    const r = nov10([work('minus', 0, 1, 3000, { issueId: 'm1' })]);
    expect(ledger([r]).issues[0]).toMatchObject({ lineCount: 2, proposal: 61317 - 3000, settled: 58317 });
  });
  it('減の件に根拠を選んだ材料・リース・燃料・外注は数えない（減は申告額だけ）', () => {
    const minusIssue = issue('d1', '2026-11-10', '減の件', { kind: 'minus' });
    const r = report('2026-11-10', [
      labor(1, 20000),
      work('minus', 0, 1, 3000, { issueId: 'd1' }),
      credit(25000, { issueId: 'd1' }),
      cash(1000, { issueId: 'd1' }),
      lease(1000, { issueId: 'd1' }),
      fuel(1000, { issueId: 'd1' }),
      credit(50000, { purchaseKind: 'subcontract', issueId: 'd1' }),
    ]);
    const m = ledger([r], [minusIssue]);
    expect(m.issues[0]).toMatchObject({ proposal: -3000, settled: -3000, actualCost: 0 });
    expect(m.issues[0].breakdown).toMatchObject({ material: 0, lease: 0, fuel: 0, subcontract: 0 });
    expect(m.summary.minus).toMatchObject({ proposal: -3000, settled: -3000 });
    // 根拠の行だけの減の件は載らない
    expect(ledger([report('2026-11-10', [credit(25000, { issueId: 'd1' })])], [minusIssue]).issues).toEqual([]);
  });
  it('区分ごとの提案額（サマリーの列）は未定の件の根拠の材料・外注を含む（村山様邸：追加 61,317 ＝ 精算額）', () => {
    const m = ledger([nov10()]);
    expect(m.summary.extra).toMatchObject({ count: 1, proposal: 61317, settled: 61317 });
    expect(ledger([nov10([], 'm1')]).summary.extra.proposal).toBe(231317);
    // 根拠の行だけの未定の件も提案額に入る
    expect(ledger([report('2026-11-10', [credit(10000, { issueId: 'm1' })])]).summary.extra.proposal).toBe(12096);
  });
  it('区分ごとの提案額は件の区分に入れ、月の期間ではその月の行と根拠の行だけ', () => {
    const changeIssue = issue('m1', '2026-11-10', '変更の件', { kind: 'change' });
    const dec = report('2026-12-01', [credit(7000, { issueId: 'm1' })]);
    const nov = buildChangeLedger(input([nov10(), dec], { issues: [changeIssue] }), DEF, NOV);
    expect(nov.summary.extra.proposal).toBe(0);
    expect(nov.summary.change.proposal).toBe(61317);
    const decM = buildChangeLedger(input([nov10(), dec], { issues: [changeIssue] }), DEF, { kind: 'month', month: '2026-12' });
    expect(decM.summary.change.proposal).toBe(8468); // 7,000 × 1.12 × 1.08 = 8,467.2 → 8,468
  });
  it('一式・常用・やり直しの件と件なしの行は、行の区分に行の提案額（施工金額から）', () => {
    const lump = ledger([nov10()], [issue('m1', '2026-11-10', '一式', { settlementMethod: 'lump_sum', fixedAmount: 60000 })]);
    expect(lump.summary.extra.proposal).toBe(31077); // 25,000 × 1.151 × 1.08 = 31,077
    const rework = ledger([nov10()], [issue('m1', '2026-11-10', 'やり直し', { kind: 'rework' })]);
    expect(rework.summary.extra.proposal).toBe(31077);
  });
});

describe('settleIssue（件ごとの精算額の規則）', () => {
  const linked = (manDays: number, proposal: number) => ({ manDays, proposal });
  it('未定：件の提案額（減の申告額を含む）。行が無ければ 0', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x'), linked(1, 22300))).toEqual({
      settled: 22300, settledBasis: 'proposal', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x'), linked(0, 0)).settled).toBe(0);
  });
  it('一式：確定額だけ（提案額・人工は見ない）。確定額が無ければ 0', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'lump_sum', fixedAmount: 50000 }), linked(1, 22300))).toEqual({
      settled: 50000, settledBasis: 'fixed', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'lump_sum', fixedAmount: null }), linked(1, 22300)).settled).toBe(0);
  });
  it('減の件の一式は、確定額を正で入れても精算額は負', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x', { kind: 'minus', settlementMethod: 'lump_sum', fixedAmount: 30000 }), linked(0, 0))).toEqual({
      settled: -30000, settledBasis: 'fixed', category: 'minus', countsToward: true,
    });
  });
  it('見積：一式と同じ（見積額だけ、basis fixed、減は負、見積額が無ければ 0）', () => {
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'estimate', fixedAmount: 120000 }), linked(1, 22300))).toEqual({
      settled: 120000, settledBasis: 'fixed', category: 'extra', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { kind: 'minus', settlementMethod: 'estimate', fixedAmount: 30000 }), linked(1, 0))).toEqual({
      settled: -30000, settledBasis: 'fixed', category: 'minus', countsToward: true,
    });
    expect(settleIssue(issue('a', '2026-11-02', 'x', { settlementMethod: 'estimate', fixedAmount: null }), linked(1, 0)).settled).toBe(0);
  });
  it('常用：人工の合計 × 単価を円未満切り上げ（浮動小数の誤差で 1 円多くしない）', () => {
    const daily = (dailyRate: number | null, o: Partial<Issue> = {}) => issue('a', '2026-11-02', 'x', { settlementMethod: 'daily_rate', dailyRate, ...o });
    expect(settleIssue(daily(25000), linked(1.5 + 0.7, 1))).toEqual({ settled: 55000, settledBasis: 'daily_rate', category: 'extra', countsToward: true });
    expect(settleIssue(daily(30000), linked(0.1 + 0.2, 1)).settled).toBe(9000);
    expect(settleIssue(daily(33333), linked(0.3, 1)).settled).toBe(10000); // 9,999.9 → 10,000
    expect(settleIssue(daily(20000, { kind: 'minus' }), linked(1, 0)).settled).toBe(-20000);
  });
  it('常用で人工 0・単価なしは 0（減でも −0 にしない）', () => {
    const daily = (dailyRate: number | null, kind: Issue['kind'] = 'extra') => issue('a', '2026-11-02', 'x', { kind, settlementMethod: 'daily_rate', dailyRate });
    expect(settleIssue(daily(30000), linked(0, 0)).settled).toBe(0);
    expect(settleIssue(daily(null), linked(2, 0)).settled).toBe(0);
    expect(settleIssue(daily(30000, 'minus'), linked(0, 0)).settled).toBe(0);
  });
  it('種別 → 区分：客先都合・その他は追加、やり直しは数えない（countsToward false）', () => {
    const k = (kind: Issue['kind']) => settleIssue(issue('a', '2026-11-02', 'x', { kind }), linked(0, 0));
    expect(k('client_delay')).toMatchObject({ category: 'extra', countsToward: true });
    expect(k('other')).toMatchObject({ category: 'extra', countsToward: true });
    expect(k('increase')).toMatchObject({ category: 'increase', countsToward: true });
    expect(k('change')).toMatchObject({ category: 'change', countsToward: true });
    expect(k('rework')).toMatchObject({ category: null, countsToward: false });
  });
});

describe('件ごとの精算（buildChangeLedger の issues・unlinked・summary.settled）', () => {
  // 労務 20,000・1 人工の日。作業内容はどれも施工金額 1,000 → 行の提案額 1,210（× 1.1 × 1.1）。実績原価は人工 × 20,000。
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
  it('件の項目（本文は先頭 40 字）と、紐づく行の件数・人工・実績原価・提案額（件ごとにまとめて切り上げ）', () => {
    const [u, l, mi, d] = m.issues;
    expect(u).toMatchObject({
      reportDate: '2026-11-02', kind: 'extra', bodyHead: 'う'.repeat(40), instructedBy: '施主 山田様', amountEstimate: 40000,
      settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null,
      lineCount: 2, manDays: 1.5, actualCost: 30000, proposal: 2420, settled: 2420, settledBasis: 'proposal', category: 'extra', countsToward: true,
    });
    expect(l).toMatchObject({ lineCount: 2, manDays: 1, actualCost: 20000, proposal: 1210 - 3000, settled: 100000, settledBasis: 'fixed' });
    // 行の無い一式の件も lineCount 0 で載る
    expect(mi).toMatchObject({ lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, settled: -30000, category: 'minus', fixedOn: '2026-11-20' });
    expect(d).toMatchObject({ lineCount: 1, manDays: 1.5, settled: 45000, settledBasis: 'daily_rate', category: 'change', dailyRate: 30000 });
  });
  it('やり直しの件は参考（countsToward false）で合計に入らない', () => {
    expect(m.issues[4]).toMatchObject({ id: 'iR', settled: 8000, category: null, countsToward: false });
  });
  it('unlinked：件に紐づかない行（未選択・読めない件）の合計', () => {
    expect(m.unlinked).toMatchObject({ lineCount: 2, manDays: 2, actualCost: 40000, proposal: 2420, missingAmountLines: 0 });
    // 労務の行が手入力（所属なし）だけの日なので、所属別の人工は全部が所属なし
    expect(m.unlinked.affiliationManDays.map((p) => [p.label, p.manDays])).toEqual([['所属なし', 2]]);
  });
  it('区分ごとの精算額 = 件の精算額（区分ごと）＋ 件に紐づかない行の提案額。一式の件に紐づく行の提案額は数えない', () => {
    expect(m.summary.extra.settled).toBe(2420 + 100000 + 2420);
    expect(m.summary.increase.settled).toBe(0);
    expect(m.summary.change.settled).toBe(45000);
    // 減の件の一式（正で入れた 30,000）は負で引かれる。一式の件 iL に紐づく減の行（−3,000）は入らない
    expect(m.summary.minus.settled).toBe(-30000);
    // 件数・申告額・提案額は行のまま
    expect(m.summary.extra).toMatchObject({ count: 5, proposal: 1210 * 5 });
    expect(m.summary.minus).toMatchObject({ count: 1, proposal: -3000 });
  });
  it('精算提案額は区分ごとの精算額から（当初 ＋ 追加 ＋ 増 ＋ 変更 ＋ 減）', () => {
    expect(m.settlement).toEqual({
      base: 1_000_000, baseBasis: 'contract', through: null,
      extra: 104840, increase: 0, change: 45000, minus: -30000, proposed: 1_000_000 + 104840 + 45000 - 30000,
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
    expect(lump.unlinked).toEqual({ lineCount: 0, manDays: 0, actualCost: 0, proposal: 0, affiliationManDays: [], missingAmountLines: 0 });
  });
});

describe('客先用の精算額（clientSettlement）', () => {
  // 労務 20,000・1 人工の日。施工金額 1,000 の行の提案額 1,210。
  const day = (date: string, lines: SavedReportLine[], o: Partial<ReportWithLines> = {}) => report(date, [labor(1, 20000), ...lines], o);
  const reports = () => [
    day('2026-11-02', [
      work('extra', 1, 1, 1000, { issueId: 'aL' }), // 一式（確定）に紐づく行：提案額は数えない
      work('extra', 1, 1, 1000, { issueId: 'aU' }), // 未定（見積中）に紐づく行：提案額を客先用に入れない
      work('extra', 1, 1, 1000), // 件なし（追加）1,210
      work('minus', 0, 1, 3000), // 件なし（減）−3,000
    ], { clientConfirmedAt: '2026-11-02T08:00:00Z' }),
    day('2026-11-05', [
      work('change', 1.5, 1, 1000, { issueId: 'aD' }),
      work('extra', 1, 1, 1000, { issueId: 'aR' }),
      work('increase', 0.5, 1, 1000, { issueId: 'aE' }),
      work('increase', 1, 1, 1000), // 件なし（増）1,210
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
    expect(m.unlinkedByKind).toEqual({ extra: 1210, increase: 1210, change: 0, minus: -3000 });
  });
  it('区分ごと：確定した件（一式＝確定額、常用＝人工×単価）の精算額 ＋ 件なしの行の提案額。件数は確定した件だけ。減は負', () => {
    expect(c.kinds).toEqual({
      extra: { count: 1, amount: 100000 + 1210 },
      increase: { count: 0, amount: 1210 },
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
    expect(c.proposed).toBe(1_000_000 + 101210 + 1210 + 45000 - 33000);
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
    expect(ledger(OCT).issues.find((i) => i.id === 'iU')).toMatchObject({ lineCount: 1, settled: 1210 });
  });
  it('区分ごとの精算額は月末までの累計（件数・提案額はその月だけ）', () => {
    const sep = ledger(SEP);
    expect(sep.summary.extra).toMatchObject({ count: 2, proposal: 1210 * 2, settled: 50000 + 30000 });
    expect(sep.settlement).toMatchObject({ through: '2026-09-30', extra: 80000, proposed: 1_080_000 });
    const oct = ledger(OCT);
    expect(oct.summary.extra).toMatchObject({ count: 2, proposal: 1210 * 2, settled: 50000 + 45000 + 70000 + 1210 });
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
