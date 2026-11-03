import { describe, it, expect } from 'vitest';
import { attendance, costSummary, workerCumulative, type DayTotals, type LaborEntry } from '@/lib/calc/aggregate';

const zeroDay: DayTotals = {
  id: 'a', siteId: 's', reportDate: '2026-11-01', weather: null, supervisor: null, status: 'draft', rejectedReason: null,
  outputTotal: 0, costTotal: 0, manDaysTotal: 0, updatedAt: null, createdBy: null,
    clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null, labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0,
};

describe('追加ケース', () => {
  it('原価 0 のとき構成比は 0、契約額 0 なら粗利は null', () => {
    const c = costSummary([zeroDay], 1_000_000);
    expect(c.shares).toEqual({ labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0 });
    expect(c.grossProfit).toBe(1_000_000);
    expect(costSummary([zeroDay], 0).grossProfit).toBeNull();
    expect(costSummary([zeroDay], 0).grossMargin).toBeNull();
  });
  it('繰越だけの作業員も累計に含まれる', () => {
    const e: LaborEntry[] = [{ reportDate: '2026-11-02', workerId: 'w1', workerName: '田中', manDays: 1, cost: 19000, overtimeHours: 0 }];
    const w = workerCumulative(e, [{ workerId: 'w9', manDays: 3, laborCost: 50000, beforeDate: '2026-10-01' }], { w1: '田中', w9: '鈴木' }, { from: null, to: null });
    const s = w.find((r) => r.workerId === 'w9')!;
    expect(s.workerName).toBe('鈴木');
    expect([s.manDays, s.cost, s.totalManDays, s.totalCost]).toEqual([0, 0, 3, 50000]);
    expect(w).toHaveLength(2);
  });
  it('workerId が null の明細は名前でまとめる', () => {
    const e: LaborEntry[] = [
      { reportDate: '2026-11-02', workerId: null, workerName: '応援A', manDays: 0.5, cost: 7000, overtimeHours: 0 },
      { reportDate: '2026-11-03', workerId: null, workerName: '応援A', manDays: 0.5, cost: 7000, overtimeHours: 0 },
    ];
    const w = workerCumulative(e, [], {}, { from: null, to: null });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ workerId: null, workerName: '応援A', manDays: 1, cost: 14000, workDays: 2, overtimeHours: 0 });
  });
  it('出面は名前順で、同日複数行は合算し稼働日数は日付の数', () => {
    const e: LaborEntry[] = [
      { reportDate: '2026-11-02', workerId: 'w2', workerName: 'さとう', manDays: 0.5, cost: 1000, overtimeHours: 0 },
      { reportDate: '2026-11-02', workerId: 'w1', workerName: 'あべ', manDays: 0.3, cost: 600, overtimeHours: 0 },
      { reportDate: '2026-11-02', workerId: 'w1', workerName: 'あべ', manDays: 0.3, cost: 600, overtimeHours: 0 },
    ];
    const a = attendance(e);
    expect(a.map((r) => r.workerName)).toEqual(['あべ', 'さとう']);
    expect(a[0].workDays).toBe(1);
    expect(a[0].byDate['2026-11-02']).toEqual({ manDays: 0.6, cost: 1200 });
  });
});

describe('原価タブの累計基準（月次集計の進捗率と一致）', () => {
  const mk = (d: string, output: number, labor: number): DayTotals => ({ ...zeroDay, id: d, reportDate: d, outputTotal: output, labor, costTotal: labor });
  it('期間末までの累計で計算した進捗率が月次集計の最終行と一致する', async () => {
    const { monthlyRows } = await import('@/lib/calc/aggregate');
    const all = [mk('2026-10-30', 50000, 10000), mk('2026-11-02', 100000, 20000), mk('2026-11-05', 150000, 30000)];
    const monthLast = monthlyRows(all, '2026-11', 1_000_000).at(-1)!;
    const cumulative = costSummary(all.filter((d) => d.reportDate <= '2026-11-31'), 1_000_000);
    const monthOnly = costSummary(all.filter((d) => d.reportDate.startsWith('2026-11')), 1_000_000);
    expect(cumulative.progress).toBe(monthLast.progress);
    expect(cumulative.progress).toBe(0.3);
    expect(monthOnly.progress).toBe(0.25);
    expect(cumulative.cost).toBe(60000);
  });
});
