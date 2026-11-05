import { describe, it, expect } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { buildChangeLedger } from '@/lib/reports/change-model';
import { buildCostReport } from '@/lib/reports/cost-model';
import type { Issue } from '@/lib/db/reports';
import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { Carryover, Site } from '@/lib/db/sites';
import type { CostReportInput, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import type { ChangeKind, ReportStatus } from '@/lib/types';

// ─── 小さな手作りの入力 ───

const site = (o: Partial<Site> = {}): Site => ({
  id: 's1', name: '〇〇邸新築工事', clientName: '〇〇様', projectName: null, projectNo: 'K-001', overview: '木造 2 階建て',
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: '2027-01-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null, ...o,
});
const touched = { updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' };
const worker = (id: string, name: string, trade: string | null): Worker => ({ id, name, trade, note: null, active: true, rates: [], overtimeRate: null, affiliation: 'own', supplierId: null, ...touched });
const supplier = (id: string, name: string): Supplier => ({ id, name, category: null, contact: null, note: null, active: true, ...touched });
const vehicle = (id: string, name: string): Vehicle => ({ id, name, kind: null, kmPerL: 10, note: null, active: true, ...touched });
const leaseItem = (id: string, name: string): LeaseItem => ({ id, name, spec: null, note: null, active: true, rates: [], ...touched });

const stored = (amount: number, manDays = 0, overtimeHours = 0) => ({ amount, manDays, overtimeHours });
const labor = (workerId: string | null, workerName: string, manDays: number, cost: number, overtimeHours = 0): SavedReportLine => ({
  kind: 'labor', workerId, workerName, time: { start: null, end: null, breakMin: null, gapMin: null },
  // 日当は保存値と合わない値にしておく（再計算していないことの確認）
  dailyRate: 99_999, note: '', overtimeRate: null, stored: stored(cost, manDays, overtimeHours),
});
const fuel = (vehicleId: string | null, vehicleName: string, distanceKm: number, cost: number): SavedReportLine => ({
  kind: 'fuel', vehicleId, vehicleName, kmPerL: 10, distanceKm, pricePerL: 170, note: '', stored: stored(cost),
});
const lease = (itemId: string | null, itemName: string, qty: number, unit: string, cost: number): SavedReportLine => ({
  kind: 'lease', itemId, itemName, spec: '', unit, qty, unitPrice: 1, note: '', stored: stored(cost),
});
const cash = (vendor: string, cost: number): SavedReportLine => ({
  kind: 'cash', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 1, vendor, stored: stored(cost),
});
const credit = (supplierId: string | null, vendor: string, cost: number): SavedReportLine => ({
  kind: 'credit', itemName: '合板', spec: '', unit: '枚', qty: 1, unitPrice: 1, supplierId, vendor, stored: stored(cost),
});
const work = (trade: string, description: string, qty: number | null, unit: string, manDays: number, output: number, changeKind: ChangeKind = 'contract'): SavedReportLine => ({
  kind: 'work', estimateItemId: null, trade, description, qty, unit, manDays, unitPrice: 1, source: 'extra', ...EMPTY_WORK_CHANGE, changeKind, stored: stored(output, manDays),
});

/** cost_total・output_total は明細の保存値の合計（DB のトリガーと同じ）。 */
const report = (date: string, lines: SavedReportLine[], status: ReportStatus = 'approved'): ReportWithLines => {
  const cost = lines.filter((l) => l.kind !== 'work').reduce((s, l) => s + l.stored.amount, 0);
  const output = lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.stored.amount, 0);
  const manDays = lines.filter((l) => l.kind === 'labor').reduce((s, l) => s + l.stored.manDays, 0);
  return {
    id: `r-${date}`, siteId: 's1', reportDate: date, weather: '晴れ', supervisor: null, status, rejectedReason: null,
    outputTotal: output, costTotal: cost, manDaysTotal: manDays, updatedAt: null, createdBy: null,
    clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null, lines,
  };
};

const input = (reports: ReportWithLines[], o: Partial<CostReportInput> = {}): CostReportInput => ({
  site: site(),
  reports,
  carryovers: [],
  workers: [worker('w1', '田中', '大工'), worker('w2', '佐藤', '鳶')],
  suppliers: [supplier('sp1', '山田商店')],
  vehicles: [vehicle('v1', '2t ダンプ')],
  leaseItems: [leaseItem('l1', '足場')],
  issues: [],
  sitePartners: [],
  ...o,
});

const ALL = { kind: 'all' } as const;
const NOV = { kind: 'month', month: '2026-11' } as const;
const now = { date: '2026-11-10', by: '大江', at: '2026-11-10T01:23:45.000Z' };
const RATES = { overheadRate: 0.15, profitRate: 0.1 };

// ─── テスト ───

describe('日報 0 件', () => {
  it('例外にならず、空の帳票（isEmpty・空の表・合計 0）を返す', () => {
    const m = buildCostReport(input([], { site: site({ startDate: null }) }), ALL, now, RATES);
    expect(m.isEmpty).toBe(true);
    expect(m.header.reportCount).toBe(0);
    expect(m.header.approvedCount).toBe(0);
    expect(m.header.period).toEqual({ kind: 'all', month: null, from: null, to: null });
    expect(m.header.elapsedDays).toBeNull(); // 着工日も日報も無い
    expect(m.costs.total).toBe(0);
    expect(Object.values(m.costs.shares)).toEqual([0, 0, 0, 0, 0]);
    expect(m.profit.totalCost).toBe(0);
    expect(m.profit.costPerManDay).toBeNull();
    expect(m.profit.costPerDay).toBeNull();
    expect(m.trend.rows).toEqual([]);
    expect(m.trend.total.cost).toBe(0);
    expect(m.trend.total.progress).toBeNull();
    expect(m.workers.rows).toEqual([]);
    expect(m.vendors.rows).toEqual([]);
    expect(m.equipment.vehicles).toEqual([]);
    expect(m.equipment.leases).toEqual([]);
    expect(m.trades.rows).toEqual([]);
    expect(m.footer).toEqual({ reportCount: 0, approvedCount: 0, outputDate: '2026-11-10', outputAt: '2026-11-10T01:23:45.000Z' });
  });

  it('請負金額が無ければ粗利・粗利率・進捗率は null', () => {
    const m = buildCostReport(input([], { site: site({ contractAmount: null }) }), ALL, now, RATES);
    expect(m.profit.contractTotal).toBeNull();
    expect(m.profit.grossProfit).toBeNull();
    expect(m.profit.grossMargin).toBeNull();
    expect(m.profit.progress).toBeNull();
  });

  it('その月に日報が無い月指定も空の帳票', () => {
    const m = buildCostReport(input([report('2026-10-20', [labor('w1', '田中', 1, 18000)])]), NOV, now, RATES);
    expect(m.isEmpty).toBe(true);
    expect(m.costs.total).toBe(0);
    expect(m.trend.rows).toEqual([]);
    expect(m.header.period).toEqual({ kind: 'month', month: '2026-11', from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('見出し・署名・脚注', () => {
  const reports = [
    report('2026-10-20', [labor('w1', '田中', 1, 18000)]),
    report('2026-11-02', [labor('w1', '田中', 1, 18000)], 'submitted'),
    report('2026-11-05', [labor('w1', '田中', 1, 18000)], 'draft'),
  ];

  it('現場の登録値・件数（全状態）と承認件数・集計期間・出力日時', () => {
    const m = buildCostReport(input(reports), ALL, now, RATES);
    expect(m.isEmpty).toBe(false);
    expect(m.header).toMatchObject({
      siteName: '〇〇邸新築工事', clientName: '〇〇様', projectNo: 'K-001', contractType: '元請け', overview: '木造 2 階建て',
      startDate: '2026-10-01', endDate: '2027-01-31', siteStatus: 'active', reportCount: 3, approvedCount: 1,
      period: { kind: 'all', month: null, from: '2026-10-20', to: '2026-11-05' }, outputDate: '2026-11-10', outputAt: '2026-11-10T01:23:45.000Z',
    });
    expect(m.signature).toEqual({ createdBy: '大江', checkedBy: null, approvedBy: null });
    expect(m.footer).toEqual({ reportCount: 3, approvedCount: 1, outputDate: '2026-11-10', outputAt: '2026-11-10T01:23:45.000Z' });
  });

  it('月指定の件数はその月だけ', () => {
    const m = buildCostReport(input(reports), NOV, now, RATES);
    expect(m.header.reportCount).toBe(2);
    expect(m.header.approvedCount).toBe(0);
  });

  it('経過日数：進行中は着工〜出力日（着工日を 1 日目）', () => {
    expect(buildCostReport(input(reports), ALL, now, RATES).header.elapsedDays).toBe(41); // 10/1〜11/10
  });

  it('経過日数：完了なら着工〜最後の日報日、着工日が無ければ最初の日報日から', () => {
    const done = buildCostReport(input(reports, { site: site({ status: 'done' }) }), ALL, now, RATES);
    expect(done.header.elapsedDays).toBe(36); // 10/1〜11/5
    const noStart = buildCostReport(input(reports, { site: site({ startDate: null }) }), ALL, now, RATES);
    expect(noStart.header.elapsedDays).toBe(22); // 10/20〜11/10
  });

  it('出力日時が無ければ null', () => {
    expect(buildCostReport(input(reports), ALL, { date: '2026-11-10', by: '大江' }, RATES).header.outputAt).toBeNull();
  });
});

describe('① 原価合計・② 採算', () => {
  const reports = [
    report('2026-11-02', [labor('w1', '田中', 1, 18000), fuel('v1', '2t ダンプ', 50, 850), lease('l1', '足場', 10, '式', 3000), cash('ホームセンターA', 1200), credit('sp1', '山田商店', 5000), work('型枠', '基礎', 10, 'm2', 1, 100_000)]),
    report('2026-11-05', [labor('w1', '田中', 0.5, 9000), labor('w2', '佐藤', 1, 20000), work('型枠', '基礎', 5, 'm2', 1.5, 50_000)]),
  ];

  it('5 費目は明細の保存値（amount）の合計で、日当から再計算しない', () => {
    const m = buildCostReport(input(reports), ALL, now, RATES);
    expect(m.costs).toMatchObject({ labor: 47000, fuel: 850, lease: 3000, cash: 1200, credit: 5000, total: 57050 });
  });

  it('構成比の合計が 100%', () => {
    const { shares, total } = buildCostReport(input(reports), ALL, now, RATES).costs;
    expect(total).toBeGreaterThan(0);
    const sum = shares.labor + shares.fuel + shares.lease + shares.cash + shares.credit;
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(shares.labor).toBeCloseTo(47000 / 57050, 12);
  });

  it('採算：粗利・粗利率・累計出来高・進捗率・総人工・1 人工／1 日あたり原価', () => {
    const p = buildCostReport(input(reports), ALL, now, RATES).profit;
    expect(p).toMatchObject({ contractTotal: 1_000_000, totalCost: 57050, grossProfit: 942_950, cumulativeOutput: 150_000, totalManDays: 2.5, dayCount: 2 });
    expect(p.grossMargin).toBeCloseTo(0.94295, 12);
    expect(p.progress).toBeCloseTo(0.15, 12);
    expect(p.costPerManDay).toBeCloseTo(57050 / 2.5, 9);
    expect(p.costPerDay).toBeCloseTo(57050 / 2, 9);
  });
});

describe('月指定：「原価合計・出来高」はその月だけ、「累計原価・進捗率」はその月末までの累計', () => {
  const reports = [
    report('2026-10-20', [labor('w1', '田中', 1, 10000), work('型枠', '基礎', 1, 'm2', 1, 100_000)]),
    report('2026-11-02', [labor('w1', '田中', 1, 20000), work('型枠', '基礎', 1, 'm2', 1, 200_000)]),
    report('2026-11-30', [labor('w1', '田中', 1, 30000), work('型枠', '基礎', 1, 'm2', 1, 50_000)]),
    report('2026-12-01', [labor('w1', '田中', 1, 99000), work('型枠', '基礎', 1, 'm2', 1, 300_000)]), // 月末より後は入れない
  ];
  const m = buildCostReport(input(reports), NOV, now, RATES);

  it('① 原価合計と ③ の原価合計・出来高はその月だけ', () => {
    expect(m.costs.total).toBe(50000);
    expect(m.trend.total.cost).toBe(50000);
    expect(m.trend.total.output).toBe(250_000);
    expect(m.trend.total.reportCount).toBe(2);
  });

  it('③ の累計原価・進捗率は月末までの累計（前月を含み、翌月を含まない）', () => {
    expect(m.trend.total.cumulativeCost).toBe(60000);
    expect(m.trend.total.progress).toBeCloseTo(0.35, 12); // (100,000+200,000+50,000)/1,000,000
  });

  it('② 採算は月末までの累計', () => {
    expect(m.profit.totalCost).toBe(60000);
    expect(m.profit.grossProfit).toBe(940_000);
    expect(m.profit.cumulativeOutput).toBe(350_000);
    expect(m.profit.progress).toBeCloseTo(0.35, 12);
    expect(m.profit.totalManDays).toBe(3);
    expect(m.profit.dayCount).toBe(3);
  });

  it('⑦ 工種別はその月だけ', () => {
    expect(m.trades.total.output).toBe(250_000);
  });

  it('工期全体なら ③ は日報のある月ごと、累計原価・進捗率は各月末まで', () => {
    const all = buildCostReport(input(reports), ALL, now, RATES);
    expect(all.trend.unit).toBe('month');
    expect(all.trend.rows.map((r) => [r.key, r.from, r.to, r.reportCount, r.cost, r.output, r.cumulativeCost])).toEqual([
      ['2026-10', '2026-10-01', '2026-10-31', 1, 10000, 100_000, 10000],
      ['2026-11', '2026-11-01', '2026-11-30', 2, 50000, 250_000, 60000],
      ['2026-12', '2026-12-01', '2026-12-31', 1, 99000, 300_000, 159_000],
    ]);
    expect(all.trend.rows.map((r) => r.progress)).toEqual([0.1, 0.35, 0.65]);
    expect(all.trend.total).toMatchObject({ reportCount: 4, labor: 159_000, cost: 159_000, output: 650_000, cumulativeCost: 159_000, progress: 0.65 });
  });
});

describe('③ 月指定は週ごと（月曜始まり）', () => {
  // 2026-11-01 は日曜、2026-11-30 は月曜。月をまたぐ週はその月の中だけに切り詰める（10/31 の日報は 11 月の行に入れない）。
  const reports = [
    report('2026-10-31', [labor('w1', '田中', 1, 5000)]),
    report('2026-11-01', [labor('w1', '田中', 1, 10000)]),
    report('2026-11-02', [labor('w1', '田中', 1, 20000), fuel('v1', '2t ダンプ', 10, 300)]),
    report('2026-11-08', [labor('w1', '田中', 1, 30000)]),
    report('2026-11-30', [labor('w1', '田中', 1, 40000)]),
  ];
  const m = buildCostReport(input(reports), NOV, now, RATES);

  it('日報のある週だけ、週の初日（月曜。月初は 1 日）〜週末（日曜。月末は末日）', () => {
    expect(m.trend.unit).toBe('week');
    expect(m.trend.rows.map((r) => [r.key, r.from, r.to, r.reportCount])).toEqual([
      ['2026-11-01', '2026-11-01', '2026-11-01', 1],
      ['2026-11-02', '2026-11-02', '2026-11-08', 2],
      ['2026-11-30', '2026-11-30', '2026-11-30', 1],
    ]);
  });

  it('週の 5 費目・原価合計と、前月を含む累計原価', () => {
    expect(m.trend.rows.map((r) => [r.labor, r.fuel, r.cost, r.cumulativeCost])).toEqual([
      [10000, 0, 10000, 15000],
      [50000, 300, 50300, 65300],
      [40000, 0, 40000, 105_300],
    ]);
    expect(m.trend.total).toMatchObject({ reportCount: 4, cost: 100_300, cumulativeCost: 105_300 });
  });
});

describe('④ 作業員別累計（繰越込み）', () => {
  const carryovers: Carryover[] = [
    { workerId: 'w1', manDays: 10, laborCost: 200_000, beforeDate: '2026-10-01' },
    { workerId: 'w2', manDays: 3, laborCost: 60_000, beforeDate: '2026-10-01' }, // 繰越だけの作業員
  ];
  const reports = [
    report('2026-09-30', [labor('w1', '田中', 1, 18000, 2)]), // 繰越の基準日より前：繰越初期値に含まれるので数えない
    report('2026-10-20', [labor('w1', '田中', 1, 18000)]),
    report('2026-11-02', [labor('w1', '田中', 1.25, 22500, 1.5), labor(null, '山田', 1, 15000, 0.5)]),
    report('2026-11-05', [labor(null, '山田', 0.5, 7500)]),
    report('2026-12-01', [labor('w1', '田中', 1, 18000)]),
  ];

  it('工期全体：繰越初期値 + 基準日以降の日報、基準日より前の日報は二重に数えない', () => {
    const m = buildCostReport(input(reports, { carryovers }), ALL, now, RATES);
    const tanaka = m.workers.rows.find((r) => r.workerId === 'w1')!;
    expect(tanaka).toMatchObject({
      workerName: '田中', manual: false, trade: '大工', workDays: 3, carryManDays: 10, carryCost: 200_000,
      periodManDays: 3.25, periodCost: 58500, manDays: 13.25, overtimeHours: 1.5, cost: 258_500,
    });
    const sato = m.workers.rows.find((r) => r.workerId === 'w2')!;
    expect(sato).toMatchObject({ workerName: '佐藤', trade: '鳶', workDays: 0, manDays: 3, overtimeHours: 0, cost: 60_000 });
  });

  it('手入力の作業員は manual（名前で集計、職種なし）', () => {
    const m = buildCostReport(input(reports, { carryovers }), ALL, now, RATES);
    const yamada = m.workers.rows.find((r) => r.workerName === '山田')!;
    expect(yamada).toMatchObject({ workerId: null, manual: true, trade: null, workDays: 2, manDays: 1.5, overtimeHours: 0.5, cost: 22500 });
  });

  it('月指定：前月繰越 = 繰越初期値 + 前月までの日報、累計は月末まで', () => {
    const m = buildCostReport(input(reports, { carryovers }), NOV, now, RATES);
    const tanaka = m.workers.rows.find((r) => r.workerId === 'w1')!;
    expect(tanaka).toMatchObject({
      carryManDays: 11, carryCost: 218_000, periodManDays: 1.25, periodCost: 22500, manDays: 12.25, cost: 240_500, workDays: 2, overtimeHours: 1.5,
    });
  });

  it('合計行', () => {
    const m = buildCostReport(input(reports, { carryovers }), ALL, now, RATES);
    expect(m.workers.total).toEqual({ workDays: 5, manDays: 17.75, overtimeHours: 2, cost: 341_000 });
  });
});

describe('⑤ 取引先別累計', () => {
  const reports = [
    report('2026-11-02', [
      cash('ホームセンターA', 1000),
      cash('山田商店', 500), // マスターの名前と同じ購入先は同じ行にまとめる
      credit('sp1', '山田商店（旧名）', 5000), // 参照があればマスター名
      credit(null, '手書き商事', 3000),
    ]),
    report('2026-11-05', [cash('ホームセンターA', 2000), credit(null, '手書き商事', 1000), cash('', 100)]),
  ];

  it('名前（参照があればマスター名）でまとめ、マスターに無い名前は手入力', () => {
    const m = buildCostReport(input(reports), ALL, now, RATES);
    expect(m.vendors.rows).toEqual([
      { name: '山田商店', supplierId: 'sp1', manual: false, cash: 500, credit: 5000, total: 5500 },
      { name: '手書き商事', supplierId: null, manual: true, cash: 0, credit: 4000, total: 4000 },
      { name: 'ホームセンターA', supplierId: null, manual: true, cash: 3000, credit: 0, total: 3000 },
      { name: '', supplierId: null, manual: false, cash: 100, credit: 0, total: 100 },
    ]);
    expect(m.vendors.total).toEqual({ cash: 3600, credit: 9000, total: 12600 });
  });
});

describe('⑥ 車両・リース', () => {
  const reports = [
    report('2026-11-02', [fuel('v1', '2t ダンプ', 40, 680), lease('l1', '足場', 10, '式', 3000), lease(null, '発電機', 1, '台', 2000)]),
    report('2026-11-05', [fuel('v1', '2t ダンプ', 60, 1020), fuel(null, '借用車', 5, 100), lease('l1', '足場', 2, '日', 600), lease(null, '敷鉄板', 3, '', 900)]),
  ];

  it('車両ごとの走行距離・燃料費、リース品ごとの数量（単位混在は null）・リース費', () => {
    const m = buildCostReport(input(reports), ALL, now, RATES);
    expect(m.equipment.vehicles).toEqual([
      { vehicleId: 'v1', name: '2t ダンプ', manual: false, distanceKm: 100, fuelCost: 1700 },
      { vehicleId: null, name: '借用車', manual: true, distanceKm: 5, fuelCost: 100 },
    ]);
    expect(m.equipment.leases).toEqual([
      { itemId: 'l1', name: '足場', manual: false, qty: null, unit: null, leaseCost: 3600 },
      { itemId: null, name: '発電機', manual: true, qty: 1, unit: '台', leaseCost: 2000 },
      { itemId: null, name: '敷鉄板', manual: true, qty: 3, unit: null, leaseCost: 900 }, // 単位なしだけ → 合計、単位 null
    ]);
    expect(m.equipment.total).toEqual({ distanceKm: 105, fuelCost: 1800, leaseCost: 6500 });
  });
});

describe('⑦ 工種別出来高', () => {
  const reports = [
    report('2026-11-02', [
      work('型枠', '基礎立上り', 10, 'm2', 2, 100_000),
      work('鉄筋', '基礎配筋', 1, 't', 1, 80_000),
      work('', '片付け', null, '', 0.5, 0), // 数量の入った行が無い → 数量 null
    ]),
    report('2026-11-05', [
      work('型枠', '土間', 5, 'm2', 1, 50_000),
      work('型枠', '土間', 5, '', 0, 30_000), // 単位なし '' と 'm2' は別の単位 → 混在
      work('鉄筋', '基礎配筋', 200, 'kg', 1, 40_000), // t と kg → 混在
      work('左官', '中塗り', 4, 'm2', 1, 10_000),
      work('左官', '中塗り', null, '', 0.5, 0), // 数量の無い行は単位も見ない
      work('雑工', '清掃', 2, '', 1, 5_000), // すべて単位なし → 合計、単位は null
      work('雑工', '清掃', 3, '', 1, 5_000),
    ]),
  ];
  const m = buildCostReport(input(reports), ALL, now, RATES);

  it('数量の入った行の単位がすべて同じなら合計と歩掛、違えば・数量が無ければ数量・単位・歩掛は null', () => {
    expect(m.trades.rows.map((r) => [r.trade, r.mainDescription, r.qty, r.unit, r.manDays, r.productivity, r.output])).toEqual([
      ['型枠', '土間', null, null, 3, null, 180_000],
      ['鉄筋', '基礎配筋', null, null, 2, null, 120_000],
      ['左官', '中塗り', 4, 'm2', 1.5, 4 / 1.5, 10_000],
      ['雑工', '清掃', 5, null, 2, 2.5, 10_000],
      ['', '片付け', null, null, 0.5, null, 0],
    ]);
  });

  it('構成比の合計が 100%、合計行', () => {
    const sum = m.trades.rows.reduce((s, r) => s + r.share, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(m.trades.rows[0].share).toBeCloseTo(180_000 / 320_000, 12);
    expect(m.trades.total).toEqual({ manDays: 9, output: 320_000 });
  });

  it('最頻の施工内容が同数なら先に出たもの', () => {
    const t = buildCostReport(input([report('2026-11-02', [work('左官', 'A', 1, 'm2', 1, 1), work('左官', 'B', 1, 'm2', 1, 1)])]), ALL, now, RATES);
    expect(t.trades.rows[0].mainDescription).toBe('A');
  });

  it('人工 0 なら歩掛は null', () => {
    const t = buildCostReport(input([report('2026-11-02', [work('左官', 'A', 3, 'm2', 0, 1)])]), ALL, now, RATES);
    expect([t.trades.rows[0].qty, t.trades.rows[0].productivity]).toEqual([3, null]);
  });
});

describe('② 採算の基準（契約未確定の現場）と追加・増・変更・減の提案額', () => {
  const reports = [
    report('2026-10-20', [labor('w1', '田中', 1, 20000), work('内装', '追加の棚', 1, '式', 1, 30_000, 'extra')]),
    report('2026-11-02', [labor('w1', '田中', 1, 20000), work('内装', '床', 1, 'm2', 1, 100_000), work('内装', '減の巾木', 1, 'm', 0, -5_000, 'minus')]),
    report('2026-12-01', [labor('w1', '田中', 1, 40000), work('内装', '変更の扉', 1, '式', 1, 50_000, 'change')]),
  ];
  /** 上の日報に、11/03 の増（労務 30,000 ÷ 1 人工 × 1 → 30,000 × 1.265 = 37,950）を足したもの。 */
  const withIncrease = [
    ...reports,
    report('2026-11-03', [labor('w1', '田中', 1, 30000), work('内装', '床の増', 2, 'm2', 1, 6_000, 'increase')]),
  ];

  it('契約確定：基準は請負金額（basis contract）、概算金額は登録値のまま', () => {
    const p = buildCostReport(input(reports, { site: site({ estimatedAmount: 900_000 }) }), ALL, now, RATES).profit;
    expect(p).toMatchObject({ basis: 'contract', contractTotal: 1_000_000, estimatedAmount: 900_000, totalCost: 80_000, grossProfit: 920_000 });
    expect(p.progress).toBeCloseTo(175_000 / 1_000_000, 12);
  });

  it('契約未確定：粗利・粗利率は概算金額が基準（basis estimate）、② の進捗率は累計原価 ÷ 概算、請負金額は登録値のまま', () => {
    const m = buildCostReport(input(reports, { site: site({ contractStatus: 'tentative', estimatedAmount: 500_000 }) }), ALL, now, RATES);
    expect(m.profit).toMatchObject({ basis: 'estimate', contractTotal: 1_000_000, estimatedAmount: 500_000, grossProfit: 420_000 });
    expect(m.profit.grossMargin).toBeCloseTo(420_000 / 500_000, 12);
    expect(m.profit.progress).toBeCloseTo(80_000 / 500_000, 12); // 総原価 ÷ 概算（出来高 175,000 ではない）
  });

  it('契約未確定：③ の各行の進捗率は to までの累計原価 ÷ 概算、合計は最後の行と同じ', () => {
    const t = buildCostReport(input(reports, { site: site({ contractStatus: 'tentative', estimatedAmount: 500_000 }) }), ALL, now, RATES).trend;
    expect(t.rows.map((r) => [r.key, r.cumulativeCost])).toEqual([['2026-10', 20_000], ['2026-11', 40_000], ['2026-12', 80_000]]);
    expect(t.rows[0].progress).toBeCloseTo(20_000 / 500_000, 12);
    expect(t.rows[1].progress).toBeCloseTo(40_000 / 500_000, 12);
    expect(t.rows[2].progress).toBeCloseTo(80_000 / 500_000, 12);
    expect(t.total.progress).toBeCloseTo(80_000 / 500_000, 12);
    // 契約確定の現場は今までどおり累計出来高 ÷ 請負金額
    const fixed = buildCostReport(input(reports), ALL, now, RATES).trend;
    expect(fixed.rows[1].progress).toBeCloseTo((30_000 + 95_000) / 1_000_000, 12);
  });

  it('基準額が無ければ basis null、粗利・比率は null（未確定で概算なし）', () => {
    const p = buildCostReport(input(reports, { site: site({ contractStatus: 'tentative', estimatedAmount: null }) }), ALL, now, RATES).profit;
    expect(p).toMatchObject({ basis: null, contractTotal: 1_000_000, estimatedAmount: null, grossProfit: null, grossMargin: null, progress: null });
  });

  it('提案額の合計は変更増減の一覧と同じ計算（追加＋増＋変更＋減）で、期間末までの累計', () => {
    // 追加：労務 20,000 ÷ 1 人工 × 1 → 20,000 × 1.265 = 25,300。変更：40,000 × 1.265 = 50,600。減：−5,000（申告額）
    expect(buildCostReport(input(reports), ALL, now, RATES).profit.changeProposal).toBe(25_300 + 50_600 - 5_000);
    expect(buildCostReport(input(reports), NOV, now, RATES).profit.changeProposal).toBe(25_300 - 5_000); // 11 月末まで
    // 増は追加と同じく実績原価から：30,000 × 1.265 = 37,950
    expect(buildCostReport(input(withIncrease), ALL, now, RATES).profit.changeProposal).toBe(25_300 + 37_950 + 50_600 - 5_000);
    expect(buildCostReport(input(withIncrease), NOV, now, RATES).profit.changeProposal).toBe(25_300 + 37_950 - 5_000);
  });

  it('② の提案額と変更増減の一覧の精算（追加＋増＋変更＋減）は、どの期間でも一致する', () => {
    for (const period of [ALL, NOV, { kind: 'month', month: '2026-10' } as const, { kind: 'month', month: '2026-12' } as const]) {
      const p = buildCostReport(input(withIncrease), period, now, RATES).profit;
      const s = buildChangeLedger(input(withIncrease), RATES, period).settlement;
      expect(p.changeProposal).toBe(s.extra + s.increase + s.change + s.minus);
      if (period.kind === 'all' || period.month === '2026-11') expect(s.increase).toBe(37_950); // 増が実際に入っている
    }
  });

  /** 精算の項目を持つ件（既定は未定の追加）。 */
  const issue = (id: string, reportDate: string, o: Partial<Issue> = {}): Issue => ({
    id, siteId: 's1', reportId: `r-${reportDate}`, reportDate, body: `${id} の件`, status: 'open', doneAt: null, kind: 'extra',
    instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null, ...o,
  });
  const linkTo = (l: SavedReportLine, issueId: string): SavedReportLine => ({ ...l, issueId }) as SavedReportLine;
  /** 10/20 の追加の行を一式の件 iL（確定額 100,000）に紐づけ、12/01 に行の無い一式の件 iX（70,000）を登録したもの。 */
  const settledInput = () =>
    input(
      [
        report('2026-10-20', [labor('w1', '田中', 1, 20000), linkTo(work('内装', '追加の棚', 1, '式', 1, 30_000, 'extra'), 'iL')]),
        ...withIncrease.slice(1),
      ],
      {
        issues: [
          issue('iL', '2026-10-20', { settlementMethod: 'lump_sum', fixedAmount: 100_000 }),
          issue('iX', '2026-12-01', { settlementMethod: 'lump_sum', fixedAmount: 70_000 }),
        ],
      },
    );

  it('② は件ごとの精算額の合計（一式は確定額。一式の件に紐づく行の提案額は数えない。期間末より後に登録した件は入らない）', () => {
    // 工期全体：一式 100,000 ＋ 一式 70,000 ＋ 増 37,950 ＋ 変更 50,600 − 減 5,000
    expect(buildCostReport(settledInput(), ALL, now, RATES).profit.changeProposal).toBe(100_000 + 70_000 + 37_950 + 50_600 - 5_000);
    // 11 月：12/01 登録の iX と 12 月の変更は入らない
    expect(buildCostReport(settledInput(), NOV, now, RATES).profit.changeProposal).toBe(100_000 + 37_950 - 5_000);
    expect(buildCostReport(settledInput(), { kind: 'month', month: '2026-10' }, now, RATES).profit.changeProposal).toBe(100_000);
  });

  it('② と変更増減の一覧の精算は、件に精算の方法があってもどの期間でも一致する', () => {
    for (const period of [ALL, NOV, { kind: 'month', month: '2026-10' } as const, { kind: 'month', month: '2026-12' } as const]) {
      const p = buildCostReport(settledInput(), period, now, RATES).profit;
      const s = buildChangeLedger(settledInput(), RATES, period).settlement;
      expect(p.changeProposal).toBe(s.extra + s.increase + s.change + s.minus);
    }
  });

  it('追加・増・変更・減の行が無くても、一式の件があれば null でない', () => {
    const p = buildCostReport(
      input([report('2026-11-02', [labor('w1', '田中', 1, 20000), work('内装', '床', 1, 'm2', 1, 100_000)])], {
        issues: [issue('iL', '2026-11-02', { settlementMethod: 'lump_sum', fixedAmount: 70_000 })],
      }),
      ALL, now, RATES,
    ).profit;
    expect(p.changeProposal).toBe(70_000);
  });

  it('追加・増・変更・減の行が無ければ null', () => {
    const p = buildCostReport(input([report('2026-11-02', [labor('w1', '田中', 1, 20000), work('内装', '床', 1, 'm2', 1, 100_000)])]), ALL, now, RATES).profit;
    expect(p.changeProposal).toBeNull();
  });
});

// ─── 所属（行の写し）・④-2 所属別の人工・労務費 ───

describe('④ 所属の列・④-2 所属別の人工・労務費', () => {
  const partnerWorker = (id: string, name: string, supplierId: string): Worker => ({ ...worker(id, name, '鳶'), affiliation: 'partner', supplierId });
  /** 写しつきの労務の行（affiliation・supplierId・laborContract）。 */
  const aLabor = (
    workerId: string | null,
    workerName: string,
    manDays: number,
    cost: number,
    affiliation: 'own' | 'partner' | null,
    supplierId: string | null = null,
    laborContract: 'jouyou' | 'ukeoi' | null = null,
  ): SavedReportLine => ({ ...labor(workerId, workerName, manDays, cost), affiliation, supplierId, laborContract } as SavedReportLine);

  const suppliers = [supplier('sp1', '山田商店'), supplier('pA', '〇〇工業'), supplier('pB', 'あさひ建設')];
  // マスターのいまの所属：w1 は協力会社 pB に変わった（10 月の行は自社の写し）、w3・w4 は協力会社 pA
  const workers = [partnerWorker('w1', '田中', 'pB'), worker('w2', '佐藤', '鳶'), partnerWorker('w3', '鈴木', 'pA'), partnerWorker('w4', '高橋', 'pA')];
  const reports = [
    report('2026-10-20', [aLabor('w1', '田中', 1, 18000, 'own'), aLabor('w3', '鈴木', 1, 20000, 'partner', 'pA', null)]),
    report('2026-11-02', [
      aLabor('w1', '田中', 1, 18000, 'partner', 'pB', 'jouyou'),
      aLabor('w3', '鈴木', 1, 20000, 'partner', 'pA', 'ukeoi'),
      aLabor('w4', '高橋', 0.5, 11000, 'partner', 'pA', 'ukeoi'),
      aLabor(null, '飛び込み', 1, 15000, null),
    ]),
  ];
  const carryovers: Carryover[] = [{ workerId: 'w2', manDays: 3, laborCost: 60_000, beforeDate: '2026-10-01' }];
  const sitePartners = [
    { supplierId: 'pA', supplierName: '〇〇工業', amount: 100_000 },
    { supplierId: 'pB', supplierName: 'あさひ建設', amount: null },
    { supplierId: 'pC', supplierName: '未使用の協力会社', amount: 50_000 },
  ];
  const build = (period: typeof ALL | typeof NOV = ALL) =>
    buildCostReport(input(reports, { workers, suppliers, carryovers, sitePartners }), period, now, RATES);

  it('④ の所属は行の写し（マスターのいまの所属ではない）。途中で変わった人は出てきた順につなぐ。繰越だけの人は自社、手入力は所属なし', () => {
    const m = build();
    const label = (name: string) => m.workers.rows.find((r) => r.workerName === name)!.affiliationLabel;
    expect(label('田中')).toBe('自社・あさひ建設');
    expect(label('鈴木')).toBe('〇〇工業');
    expect(label('佐藤')).toBe('自社');
    expect(label('飛び込み')).toBe('所属なし');
    // 10 月だけなら田中はまだ自社（11 月の行は期間末より後）
    const oct = buildCostReport(input(reports, { workers, suppliers, carryovers, sitePartners }), { kind: 'month', month: '2026-10' }, now, RATES);
    expect(oct.workers.rows.find((r) => r.workerName === '田中')!.affiliationLabel).toBe('自社');
  });

  it('④-2 は 自社 → 協力会社（会社ごと・名前順）→ 所属なし。請負の日も労務費に入り、合計は ④ の合計と一致', () => {
    const m = build();
    const rows = m.affiliations.rows.map((r) => [r.label, r.jouyouManDays, r.jouyouCost, r.ukeoiManDays, r.ukeoiCost, r.manDays, r.cost, r.partnerAmount, r.difference]);
    expect(rows).toEqual([
      // 自社：繰越初期値（佐藤 3 人工・60,000）＋ 田中の 10 月の行
      ['自社', 4, 78_000, 0, 0, 4, 78_000, null, null],
      // 〇〇工業：10 月の鈴木（laborContract null は常用）＋ 11 月の請負（鈴木 1・高橋 0.5）。差額 = 請負金額 − 請負労務費
      ['〇〇工業', 1, 20_000, 1.5, 31_000, 2.5, 51_000, 100_000, 69_000],
      // あさひ建設：田中の 11 月（請負金額は未入力 → 空欄）
      ['あさひ建設', 1, 18_000, 0, 0, 1, 18_000, null, null],
      // 現場に登録したが行の無い会社も出す
      ['未使用の協力会社', 0, 0, 0, 0, 0, 0, 50_000, 50_000],
      ['所属なし', 1, 15_000, 0, 0, 1, 15_000, null, null],
    ]);
    expect(m.affiliations.total).toEqual({
      jouyouManDays: 7, jouyouCost: 131_000, ukeoiManDays: 1.5, ukeoiCost: 31_000, manDays: 8.5, cost: 162_000,
      partnerAmount: 150_000, difference: 119_000,
    });
    expect(m.affiliations.total.manDays).toBe(m.workers.total.manDays);
    expect(m.affiliations.total.cost).toBe(m.workers.total.cost);
    // 請負の日の労務費も ① 原価合計の労務費に入る（集計は変えない）
    expect(m.costs.labor).toBe(18000 + 20000 + 18000 + 20000 + 11000 + 15000);
  });

  it('マスターの所属を後から変えても、④-2 は行の写しのまま', () => {
    const before = build().affiliations;
    const allOwn = workers.map((w) => ({ ...w, affiliation: 'own' as const, supplierId: null }));
    const after = buildCostReport(input(reports, { workers: allOwn, suppliers, carryovers, sitePartners }), ALL, now, RATES).affiliations;
    expect(after).toEqual(before);
  });

  it('月の帳票も ④ と同じ範囲（月末までの累計）。請負金額は現場全体の額のまま', () => {
    const oct = buildCostReport(input(reports, { workers, suppliers, carryovers, sitePartners }), { kind: 'month', month: '2026-10' }, now, RATES);
    const a = oct.affiliations.rows.find((r) => r.label === '〇〇工業')!;
    expect(a).toMatchObject({ jouyouManDays: 1, ukeoiManDays: 0, ukeoiCost: 0, partnerAmount: 100_000, difference: 100_000 });
    expect(oct.affiliations.rows.map((r) => r.label)).not.toContain('所属なし');
    expect(oct.affiliations.total.manDays).toBe(oct.workers.total.manDays);
  });
});
