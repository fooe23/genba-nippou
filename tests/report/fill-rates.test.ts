import { describe, expect, it } from 'vitest';
import { fillMissingRates, type ReportMasters } from '@/components/report/form-state';
import type { ReportLine } from '@/lib/types';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '11111111-1111-4111-8111-222222222222';
const V1 = '22222222-2222-4222-8222-222222222222';
const V2 = '22222222-2222-4222-8222-333333333333';
const L1 = '33333333-3333-4333-8333-333333333333';
const t = { start: null, end: null, breakMin: null, gapMin: null };

const masters: ReportMasters = {
  workers: [
    { id: W1, name: '田中', active: true, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }, { amount: 19000, effectiveFrom: '2026-11-01' }] },
    { id: W2, name: '佐藤', active: true, rates: [{ amount: 20000, effectiveFrom: '2026-12-01' }] },
  ],
  vehicles: [
    { id: V1, name: 'ハイエース', active: true, kmPerL: 10 },
    { id: V2, name: 'トラック', active: true, kmPerL: null },
  ],
  leaseItems: [{ id: L1, name: '足場', spec: null, active: true, rates: [{ amount: 3500, effectiveFrom: '2026-04-01' }] }],
  suppliers: [],
  units: [],
  weather: [],
};

const labor = (workerId: string | null, dailyRate: number | null): ReportLine => ({ kind: 'labor', workerId, workerName: '', time: t, dailyRate, note: '' });
const fuel = (vehicleId: string | null, kmPerL: number | null): ReportLine => ({ kind: 'fuel', vehicleId, vehicleName: '', kmPerL, distanceKm: null, pricePerL: null, note: '' });
const lease = (itemId: string | null, unitPrice: number | null): ReportLine => ({ kind: 'lease', itemId, itemName: '', spec: '', unit: '', qty: 1, unitPrice, note: '' });

describe('fillMissingRates（日報を開いたときの補完）', () => {
  it('null の日当・リース単価・燃費を、その日付に有効なマスターの値で埋める', () => {
    const r = fillMissingRates([labor(W1, null), lease(L1, null), fuel(V1, null)], masters, '2026-10-31');
    expect(r.filled).toBe(3);
    expect(r.lines[0]).toMatchObject({ dailyRate: 18000 });
    expect(r.lines[1]).toMatchObject({ unitPrice: 3500 });
    expect(r.lines[2]).toMatchObject({ kmPerL: 10 });
  });

  it('日付で履歴を選ぶ（適用開始日以降は新しい日当）', () => {
    expect(fillMissingRates([labor(W1, null)], masters, '2026-11-01').lines[0]).toMatchObject({ dailyRate: 19000 });
  });

  it('すでに値がある行は保存時の値のまま（0 も値として尊重）', () => {
    const r = fillMissingRates([labor(W1, 17000), lease(L1, 0), fuel(V1, 8)], masters, '2026-10-31');
    expect(r.filled).toBe(0);
    expect(r.lines[0]).toMatchObject({ dailyRate: 17000 });
    expect(r.lines[1]).toMatchObject({ unitPrice: 0 });
    expect(r.lines[2]).toMatchObject({ kmPerL: 8 });
  });

  it('その日に有効な履歴が無い・燃費が未登録・参照が無い・マスターに無い行は null のまま', () => {
    const r = fillMissingRates([labor(W2, null), fuel(V2, null), labor(null, null), lease(null, null), labor('99999999-9999-4999-8999-999999999999', null)], masters, '2026-10-31');
    expect(r.filled).toBe(0);
    expect(r.lines[0]).toMatchObject({ dailyRate: null });
    expect(r.lines[1]).toMatchObject({ kmPerL: null });
    expect(r.lines[2]).toMatchObject({ dailyRate: null });
    expect(r.lines[3]).toMatchObject({ unitPrice: null });
    expect(r.lines[4]).toMatchObject({ dailyRate: null });
  });

  it('他の種類の行や元の配列は変えない', () => {
    const cash = { kind: 'cash' as const, itemName: 'テープ', spec: '', unit: '巻', qty: 5, unitPrice: null, vendor: '' };
    const input = [labor(W1, null), cash];
    const r = fillMissingRates(input, masters, '2026-10-31');
    expect(r.lines[1]).toBe(cash);
    expect(input[0]).toMatchObject({ dailyRate: null });
  });
});
