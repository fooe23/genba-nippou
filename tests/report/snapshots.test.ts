import { describe, expect, it } from 'vitest';
import { applyMasterSnapshots, needsMasterSnapshots } from '@/lib/report/snapshots';
import type { ReportLine } from '@/lib/types';

const W1 = '11111111-1111-4111-8111-111111111111';
const V1 = '22222222-2222-4222-8222-222222222222';
const L1 = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const masters = {
  workers: [{ id: W1, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }, { amount: 19000, effectiveFrom: '2026-11-01' }] }],
  vehicles: [{ id: V1, kmPerL: 10 }],
  leaseItems: [{ id: L1, rates: [{ amount: 3500, effectiveFrom: '2026-04-01' }] }],
};
const t = { start: null, end: null, breakMin: null, gapMin: null };

describe('保存時のマスター単価の複写（サーバー側）', () => {
  const lines: ReportLine[] = [
    { kind: 'labor', workerId: W1, workerName: '田中', time: t, dailyRate: 999999, note: '' },
    { kind: 'labor', workerId: null, workerName: '応援', time: t, dailyRate: 15000, note: '' },
    { kind: 'labor', workerId: UNKNOWN, workerName: '偽', time: t, dailyRate: 999999, note: '' },
    { kind: 'fuel', vehicleId: V1, vehicleName: 'ハイエース', kmPerL: 0.01, distanceKm: 40, pricePerL: 170, note: '' },
    { kind: 'lease', itemId: L1, itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 1, note: '' },
    { kind: 'lease', itemId: null, itemName: '手入力', spec: '', unit: '式', qty: 1, unitPrice: 800, note: '' },
    { kind: 'cash', itemName: 'テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: '' },
  ];
  it('参照のある行は日付に有効なマスターの値、参照の無い行はそのまま、存在しない参照は null', () => {
    const out = applyMasterSnapshots(lines, '2026-10-31', masters);
    expect(out[0]).toMatchObject({ dailyRate: 18000 });
    expect(out[1]).toMatchObject({ dailyRate: 15000 });
    expect(out[2]).toMatchObject({ dailyRate: null });
    expect(out[3]).toMatchObject({ kmPerL: 10 });
    expect(out[4]).toMatchObject({ unitPrice: 3500 });
    expect(out[5]).toMatchObject({ unitPrice: 800 });
    expect(out[6]).toBe(lines[6]);
    expect(applyMasterSnapshots(lines, '2026-11-01', masters)[0]).toMatchObject({ dailyRate: 19000 });
    expect(applyMasterSnapshots(lines, '2026-03-31', masters)[4]).toMatchObject({ unitPrice: null });
  });
  it('参照のある行が無ければマスターを読まなくてよい', () => {
    expect(needsMasterSnapshots(lines)).toBe(true);
    expect(needsMasterSnapshots([lines[1], lines[5], lines[6]])).toBe(false);
  });
});
