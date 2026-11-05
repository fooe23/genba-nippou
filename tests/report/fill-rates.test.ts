import { describe, expect, it } from 'vitest';
import { fillMissingRates, fromInput, newReportCommon, refreshFromMasters, toInput, type ReportMasters } from '@/components/report/form-state';
import type { LaborLine, ReportLine } from '@/lib/types';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '11111111-1111-4111-8111-222222222222';
const V1 = '22222222-2222-4222-8222-222222222222';
const V2 = '22222222-2222-4222-8222-333333333333';
const L1 = '33333333-3333-4333-8333-333333333333';
const t = { start: null, end: null, breakMin: null, gapMin: null };

const masters: ReportMasters = {
  workers: [
    { id: W1, name: '田中', active: true, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }, { amount: 19000, effectiveFrom: '2026-11-01' }], overtimeRate: 3000 },
    { id: W2, name: '佐藤', active: true, rates: [{ amount: 20000, effectiveFrom: '2026-12-01' }], overtimeRate: null },
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

const labor = (workerId: string | null, dailyRate: number | null): ReportLine => ({ kind: 'labor', workerId, workerName: '', time: t, dailyRate, note: '', overtimeRate: null });
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

  it('残業単価は補わない（作業員を選んだとき・保存時にマスターから入る）', () => {
    const r = fillMissingRates([labor(W1, null)], masters, '2026-10-31');
    expect(r.lines[0]).toMatchObject({ dailyRate: 18000, overtimeRate: null });
  });
});

describe('refreshFromMasters（前回コピー）', () => {
  it('日当と残業単価をこの日付時点のマスターで取り直す', () => {
    const copied = [{ ...labor(W1, 15000), overtimeRate: 2000 }, { ...labor(W2, 15000), overtimeRate: 2000 }];
    const out = refreshFromMasters(copied, masters, '2026-11-01');
    expect(out[0]).toMatchObject({ dailyRate: 19000, overtimeRate: 3000 });
    expect(out[1]).toMatchObject({ dailyRate: 15000, overtimeRate: null }); // 有効な日当が無ければ複写元のまま
  });
});

describe('newReportCommon（新しい日報の共通時間の初期値）', () => {
  const company = { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 };
  it('現場に開始・終了の両方があれば現場の4項目', () => {
    expect(newReportCommon({ start: '07:30', end: '17:00', breakMin: 60, gapMin: null }, company)).toEqual({
      start: '07:30', end: '17:00', breakMin: 60, gapMin: null,
    });
  });
  it('現場が空・片方だけなら全社の設定の4項目', () => {
    expect(newReportCommon({ start: null, end: null, breakMin: null, gapMin: null }, company)).toEqual(company);
    expect(newReportCommon({ start: '07:30', end: null, breakMin: 60, gapMin: 0 }, company)).toEqual(company);
  });
});

describe('toInput（保存・下書きの入力）', () => {
  it('労務行の DB の計算値（saved）は含めない', () => {
    const line = { ...labor(W1, 18000), saved: { hours: 8, manDays: 1.07, overtimeHours: 0, cost: 19260 } };
    const input = { siteId: W1, date: '2026-11-03', weather: null, supervisor: null, common: t, issuesText: '', notesText: '', lines: [line] };
    const out = toInput(W1, '2026-11-03', fromInput(input));
    expect(out.lines[0]).not.toHaveProperty('saved');
    expect(out.lines[0]).toMatchObject({ dailyRate: 18000, overtimeRate: null });
  });
});

describe('refreshFromMasters（前回コピー・所属と常用請負）', () => {
  it('所属の写しは持ち込まず、常用・請負は残す。いまの所属が自社なら常用・請負を外す', () => {
    const m: ReportMasters = {
      ...masters,
      workers: [
        { ...masters.workers[0], affiliation: 'partner', supplierId: 'S' },
        { ...masters.workers[1], affiliation: 'own', supplierId: null },
      ],
    };
    const partnerLine = (workerId: string): LaborLine => ({
      kind: 'labor', workerId, workerName: '', time: t, dailyRate: 15000, note: '', overtimeRate: null,
      laborContract: 'ukeoi', affiliation: 'partner', supplierId: 'OLD',
    });
    const copied: ReportLine[] = [partnerLine(W1), partnerLine(W2)];
    const out = refreshFromMasters(copied, m, '2026-11-01');
    expect(out[0]).toMatchObject({ laborContract: 'ukeoi' });
    expect(out[0]).not.toHaveProperty('affiliation');
    expect(out[0]).not.toHaveProperty('supplierId');
    expect(out[1]).toMatchObject({ laborContract: null });
  });
});
