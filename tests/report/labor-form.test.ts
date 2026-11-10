import { describe, expect, it } from 'vitest';
import { EMPTY_LABOR_COST_CONTEXT } from '@/lib/calc/labor-cost';
import { formLaborSplit, laborCostLineOf } from '@/lib/report/labor-form';
import type { LaborLine } from '@/lib/types';

const line = (extra: Partial<LaborLine>): LaborLine => ({
  kind: 'labor', workerId: 'w-a', workerName: 'A', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 22000, note: '', overtimeRate: null, ...extra,
});
const v = { hours: 8, manDays: 1, overtimeHours: 0, overtimeRate: 3438, cost: 22000, headcount: 1 };

describe('日報の画面の作業員の行に労務費の決まりを当てる', () => {
  it('まだ保存していない行は作業員マスターの所属で決め、画面の値を保存値として渡す', () => {
    const l = laborCostLineOf(line({ laborContract: 'ukeoi', jouyouHours: 4 }), v, new Map(), { affiliation: 'partner', supplierId: 's1' });
    expect(l).toEqual({ affiliation: 'partner', supplierId: 's1', laborContract: 'ukeoi', jouyouHours: 4, dailyRate: 22000, overtimeRate: null, headcount: null, stored: { amount: 22000, manDays: 1, overtimeHours: 0, hours: 8 } });
    expect(formLaborSplit(line({ laborContract: 'ukeoi', jouyouHours: 4 }), v, new Map(), { affiliation: 'partner', supplierId: 's1' }, EMPTY_LABOR_COST_CONTEXT).countedCost).toBe(11000);
  });
  it('この日報に保存済みの作業員は保存済みの所属・区分（項目が無い古い下書き）', () => {
    const stored = new Map([['w-a', { affiliation: 'partner' as const, supplierId: 's1', laborContract: 'ukeoi' as const }]]);
    const s = formLaborSplit(line({}), v, stored, { affiliation: 'own', supplierId: null }, EMPTY_LABOR_COST_CONTEXT);
    expect(s).toMatchObject({ contract: 'ukeoi', countedCost: 0, ukeoiManDays: 1 });
  });
  it('自社の作業員は区分を見ない', () => {
    expect(laborCostLineOf(line({ laborContract: 'ukeoi' }), v, new Map(), { affiliation: 'own' }).laborContract).toBeNull();
  });
});
