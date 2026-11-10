import { describe, it, expect } from 'vitest';
import { monthlyRows, sumRows, costSummary, attendance, workerCumulative, type DayTotals, type LaborEntry } from '@/lib/calc/aggregate';
const ALL = { from: null, to: null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const day = (d: string, o: Partial<any> = {}) => ({ id: d, siteId: 's', reportDate: d, weather: '晴れ', supervisor: null, status: 'approved', outputTotal: 0, costTotal: 0, manDaysTotal: 0, labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, workerCount: 0, ...o }) as DayTotals;
const days = [
  day('2026-10-30', { labor: 10000, costTotal: 10000, outputTotal: 50000 }),
  day('2026-11-02', { labor: 20000, fuel: 500, costTotal: 20500, outputTotal: 100000, workerCount: 2 }),
  day('2026-11-05', { labor: 30000, costTotal: 30000, outputTotal: 150000, workerCount: 3 }),
];
describe('月次集計', () => {
  it('11月の行は2行、回目と累計進捗が付く', () => {
    const rows = monthlyRows(days, '2026-11', 1_000_000);
    expect(rows.map(r => [r.monthIndex, r.totalIndex])).toEqual([[1, 2], [2, 3]]);
    expect(rows[1].progress).toBe(0.3);                 // (50000+100000+150000)/1,000,000
    const s = sumRows(rows); expect(s.labor).toBe(50000); expect(s.output).toBe(250000); expect(s.cost).toBe(50500);
  });
});
describe('外注の買掛のある日（2026-11-17）', () => {
  // 見出しの cost_total は外注を除く（¥38,000）。買掛（credit）は仕入 ¥18,000 ＋ 外注 ¥100,000、うち外注 ¥100,000。
  const d = [day('2026-11-10', { labor: 20000, credit: 118000, subcontract: 100000, costTotal: 38000 })];
  it('月次の原価は区分の和（外注は 1 回だけ）。cost_total は使わない', () => {
    expect(monthlyRows(d, '2026-11', null)[0]).toMatchObject({ credit: 118000, cost: 138000 });
  });
  it('原価集計も区分の和', () => {
    expect(costSummary(d, null).cost).toBe(138000);
  });
});
describe('外注の支払いを出来高に入れる（2026-11-11）', () => {
  // 作業内容の出来高 ¥45,000 ＋ 外注の出来高に数える分 ¥170,000
  const d = [
    day('2026-11-09', { outputTotal: 100000 }),
    day('2026-11-10', { outputTotal: 45000, credit: 170000, subcontract: 170000, subcontractOutput: 170000 }),
  ];
  it('月次の出来高・累計の進捗率に入る', () => {
    const rows = monthlyRows(d, '2026-11', 1_000_000);
    expect(rows[1]).toMatchObject({ output: 215000, progress: 0.315 });
    expect(sumRows(rows).output).toBe(315000);
  });
  it('原価集計の進捗率にも入る', () => {
    expect(costSummary(d, 1_000_000).progress).toBe(0.315);
  });
});
describe('原価集計', () => {
  it('構成比・粗利・粗利率・進捗', () => {
    const c = costSummary(days, 1_000_000);
    expect(c.cost).toBe(60500); expect(c.shares.labor).toBeCloseTo(60000 / 60500, 6);
    expect(c.grossProfit).toBe(939500); expect(c.grossMargin).toBeCloseTo(0.9395, 6); expect(c.progress).toBe(0.3);
  });
  it('総額 null なら粗利は null、進捗 0', () => { const c = costSummary(days, null); expect(c.grossProfit).toBeNull(); expect(c.progress).toBe(0); });
});
describe('出面一覧・作業員別累計', () => {
  const e = [
    { reportDate: '2026-11-02', workerId: 'w1', workerName: '田中', manDays: 1.07, cost: 20330, overtimeHours: 0 },
    { reportDate: '2026-11-05', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000, overtimeHours: 0 },
    { reportDate: '2026-11-05', workerId: 'w2', workerName: '佐藤', manDays: 0.53, cost: 7950, overtimeHours: 0 },
  ];
  it('出面一覧', () => {
    const a = attendance(e); const t = a.find(r => r.workerName === '田中')!;
    expect(t.workDays).toBe(2); expect(t.manDays).toBe(2.07); expect(t.cost).toBe(39330); expect(t.byDate['2026-11-05'].manDays).toBe(1);
  });
  it('繰越を足した累計', () => {
    const w = workerCumulative(e, [{ workerId: 'w1', manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }], { w1: '田中', w2: '佐藤' }, ALL);
    const t = w.find(r => r.workerId === 'w1')!;
    expect(t.totalManDays).toBe(14.57); expect(t.totalCost).toBe(264330);
  });
});

describe('作業員別累計：前月繰越／当期間／累計（Excel 雛形と同じ考え方）', () => {
  const carry = [{ workerId: 'w1', manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }];
  const names = { w1: '田中', w2: '佐藤' };
  const e: LaborEntry[] = [
    { reportDate: '2026-10-20', workerId: 'w1', workerName: '田中', manDays: 1, cost: 18000, overtimeHours: 0 },
    { reportDate: '2026-10-25', workerId: 'w2', workerName: '佐藤', manDays: 0.5, cost: 7500, overtimeHours: 0 },
    { reportDate: '2026-11-02', workerId: 'w1', workerName: '田中', manDays: 1.07, cost: 20330, overtimeHours: 1.5 },
    { reportDate: '2026-11-05', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000, overtimeHours: 0 },
    { reportDate: '2026-12-01', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000, overtimeHours: 0 },
  ];
  it('月表示：前月までの日報は前月繰越に入り、表示月より後は入らない', () => {
    const w = workerCumulative(e, carry, names, { from: '2026-11-01', to: '2026-11-31' });
    const t = w.find((r) => r.workerId === 'w1')!;
    expect([t.carryManDays, t.carryCost]).toEqual([13.5, 243000]);      // 繰越初期値 12.5 + 10月 1
    expect([t.manDays, t.cost]).toEqual([2.07, 39330]);                 // 11月だけ
    expect([t.totalManDays, t.totalCost]).toEqual([15.57, 282330]);
    // 前月の日報だけの作業員も前月繰越として出る
    const s = w.find((r) => r.workerId === 'w2')!;
    expect([s.carryManDays, s.carryCost, s.manDays, s.cost, s.totalManDays, s.totalCost]).toEqual([0.5, 7500, 0, 0, 0.5, 7500]);
  });
  it('繰越の基準日より前の日報は二重に数えず、件数だけ数える', () => {
    const early: LaborEntry[] = [
      { reportDate: '2026-09-30', workerId: 'w1', workerName: '田中', manDays: 1, cost: 18000, overtimeHours: 3 },
      { reportDate: '2026-09-30', workerId: 'w2', workerName: '佐藤', manDays: 1, cost: 15000, overtimeHours: 0 }, // w2 は繰越なし → 除外しない
      ...e,
    ];
    const month = workerCumulative(early, carry, names, { from: '2026-11-01', to: '2026-11-31' });
    const t = month.find((r) => r.workerId === 'w1')!;
    expect(t.excludedCount).toBe(1);
    expect([t.carryManDays, t.totalManDays, t.totalCost]).toEqual([13.5, 15.57, 282330]);
    expect(month.find((r) => r.workerId === 'w2')!.carryManDays).toBe(1.5);
    const all = workerCumulative(early, carry, names, ALL);
    expect(all.find((r) => r.workerId === 'w1')!.excludedCount).toBe(1);
    expect(all.find((r) => r.workerId === 'w1')!.totalManDays).toBe(16.57); // 12.5 + 1 + 1.07 + 1 + 1
  });
  it('出勤日数・残業 H は累計に入った日報だけ（基準日より前・期間末より後は数えず、繰越初期値は日数に入らない）', () => {
    const early: LaborEntry[] = [
      { reportDate: '2026-09-30', workerId: 'w1', workerName: '田中', manDays: 1, cost: 18000, overtimeHours: 3 }, // 基準日より前
      { reportDate: '2026-11-05', workerId: 'w1', workerName: '田中', manDays: 0.5, cost: 9000, overtimeHours: 0.25 }, // 同じ日の 2 行目
      ...e,
    ];
    const month = workerCumulative(early, carry, names, { from: '2026-11-01', to: '2026-11-30' });
    const t = month.find((r) => r.workerId === 'w1')!;
    expect([t.workDays, t.overtimeHours]).toEqual([3, 1.75]); // 10/20・11/2・11/5（12/1 は期間末より後）
    const s = month.find((r) => r.workerId === 'w2')!;
    expect([s.workDays, s.overtimeHours]).toEqual([1, 0]); // 10/25（前月繰越の日報）
    const all = workerCumulative(early, carry, names, ALL);
    expect(all.find((r) => r.workerId === 'w1')!.workDays).toBe(4); // + 12/1
  });
  it('繰越だけの作業員は出勤日数 0', () => {
    const w = workerCumulative([], [{ workerId: 'w9', manDays: 3, laborCost: 50000, beforeDate: '2026-10-01' }], { w9: '鈴木' }, ALL);
    expect([w[0].workDays, w[0].overtimeHours, w[0].totalManDays]).toEqual([0, 0, 3]);
  });
  it('from = null（工期全体）は従来どおり：繰越 = 繰越初期値、当期間 = 全日報', () => {
    const w = workerCumulative(e, carry, names, ALL);
    const t = w.find((r) => r.workerId === 'w1')!;
    expect([t.carryManDays, t.carryCost]).toEqual([12.5, 225000]);
    expect([t.manDays, t.cost]).toEqual([4.07, 76330]);
    expect([t.totalManDays, t.totalCost]).toEqual([16.57, 301330]);
    expect(t.excludedCount).toBe(0);
  });
});
