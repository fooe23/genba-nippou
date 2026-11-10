import { describe, expect, it } from 'vitest';
import { dayCostOf } from '@/lib/calc/day-cost';

const line = (kind: string, amount: number, purchaseKind?: 'material' | 'subcontract') => ({ kind, purchaseKind, stored: { amount } });

describe('日の原価（明細の保存値から。2026-11-17）', () => {
  it('外注の買掛 ¥100,000・仕入の買掛 ¥18,000・労務 ¥20,000 → 合計 ¥138,000（外注は 1 回）', () => {
    const c = dayCostOf([line('labor', 20000), line('credit', 18000, 'material'), line('credit', 100000, 'subcontract'), line('work', 999999)]);
    expect(c).toEqual({ labor: 20000, fuel: 0, lease: 0, cash: 0, credit: 18000, subcontract: 100000, total: 138000 });
  });
  it('区分の無い買掛は仕入。外注の無い日は今の cost_total（作業内容以外の合計）と同じ', () => {
    const c = dayCostOf([line('labor', 20000), line('fuel', 714), line('lease', 3000), line('cash', 1200), line('credit', 800)]);
    expect(c).toEqual({ labor: 20000, fuel: 714, lease: 3000, cash: 1200, credit: 800, subcontract: 0, total: 25714 });
  });
  it('労務の金額は引数の関数で差し替えられる（第 2 段階の労務費の決まり用）', () => {
    expect(dayCostOf([line('labor', 20000), line('labor', 22000)], () => 1000)).toMatchObject({ labor: 2000, total: 2000 });
  });
});
