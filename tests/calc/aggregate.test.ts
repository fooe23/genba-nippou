import { describe, it, expect } from 'vitest';
import { monthlyRows, sumRows, costSummary, attendance, workerCumulative, type DayTotals } from '@/lib/calc/aggregate';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const day = (d: string, o: Partial<any> = {}) => ({ id: d, siteId: 's', reportDate: d, weather: '晴れ', supervisor: null, status: 'approved', outputTotal: 0, costTotal: 0, manDaysTotal: 0, labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0, ...o }) as DayTotals;
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
    { reportDate: '2026-11-02', workerId: 'w1', workerName: '田中', manDays: 1.07, cost: 20330 },
    { reportDate: '2026-11-05', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000 },
    { reportDate: '2026-11-05', workerId: 'w2', workerName: '佐藤', manDays: 0.53, cost: 7950 },
  ];
  it('出面一覧', () => {
    const a = attendance(e); const t = a.find(r => r.workerName === '田中')!;
    expect(t.workDays).toBe(2); expect(t.manDays).toBe(2.07); expect(t.cost).toBe(39330); expect(t.byDate['2026-11-05'].manDays).toBe(1);
  });
  it('繰越を足した累計', () => {
    const w = workerCumulative(e, [{ workerId: 'w1', manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }], { w1: '田中', w2: '佐藤' });
    const t = w.find(r => r.workerId === 'w1')!;
    expect(t.totalManDays).toBe(14.57); expect(t.totalCost).toBe(264330);
  });
});
