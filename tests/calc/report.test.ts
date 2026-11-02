import { describe, it, expect } from 'vitest';
import {
  hoursBetween, commonHours, effectiveHours, manDays, overtimeHours, overtimeRate, laborCost, laborLineValues,
  fuelCost, amount, productivity, reportTotals, progressRate, DEFAULT_LABOR_RULE,
} from '@/lib/calc/report';
import type { LaborLine, TimeSpec } from '@/lib/types';
const common = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };
const rule = DEFAULT_LABOR_RULE;

describe('時間', () => {
  it('hoursBetween 08:00→17:00 は 9', () => expect(hoursBetween('08:00', '17:00')).toBe(9));
  it('commonHours 8-17 休憩60 は 8', () => expect(commonHours(common)).toBe(8));
  it('個別時間が無ければ共通実働', () => expect(effectiveHours({ start: null, end: null, breakMin: null, gapMin: null }, common)).toBe(8));
  it('個別 09:00-15:30 休憩null 中抜30 → 休憩は共通60を使い 5.0', () => expect(effectiveHours({ start: '09:00', end: '15:30', breakMin: null, gapMin: 30 }, common)).toBe(5));
  it('終了が開始より前なら 0', () => expect(effectiveHours({ start: '17:00', end: '08:00', breakMin: 0, gapMin: 0 }, common)).toBe(0));
  it('共通の start が無ければ 0', () => expect(commonHours({ start: null, end: null, breakMin: 60, gapMin: 0 })).toBe(0));
});
describe('人工・残業・労務費（V34 と同じルール）', () => {
  it('人工：8H は 1、7.5H は 1、4H は 0.53、0H は 0', () => {
    expect(manDays(8, rule)).toBe(1);
    expect(manDays(7.5, rule)).toBe(1);
    expect(manDays(4, rule)).toBe(0.53);
    expect(manDays(0, rule)).toBe(0);
  });
  it('所定が 0 以下なら人工は 0', () => expect(manDays(8, { ...rule, shoteiHours: 0 })).toBe(0));
  it('残業時間：8.5H は 0.5、9H は 1、8H 以下は 0', () => {
    expect(overtimeHours(8.5, rule)).toBe(0.5);
    expect(overtimeHours(9, rule)).toBe(1);
    expect(overtimeHours(8, rule)).toBe(0);
    expect(overtimeHours(4, rule)).toBe(0);
  });
  it('残業単価：作業員の単価が無ければ ROUND(日当 ÷ 8 × 1.25)、0 は無し扱い', () => {
    expect(overtimeRate(18000, null, rule)).toBe(2813);
    expect(overtimeRate(18000, 3000, rule)).toBe(3000);
    expect(overtimeRate(18000, 0, rule)).toBe(2813);
    expect(overtimeRate(null, null, rule)).toBe(0);
    expect(overtimeRate(18000, null, { ...rule, overtimeMultiplier: 0 })).toBe(0);
    expect(overtimeRate(18000, null, { ...rule, overtimeBaseHours: 0 })).toBe(0);
  });
  it('労務費 = 日当 × 人工 ＋ 残業時間 × 残業単価', () => {
    expect(laborCost(18000, 1, 1, 2813)).toBe(20813);
    expect(laborCost(null, 1, 0, 0)).toBe(0);
  });

  // templates/V34_変更点.md「3. Excel での確認方法（期待値）」（日当 18,000、設定は既定）。
  const at = (end: string, breakMin = 0): TimeSpec => ({ start: '08:00', end, breakMin, gapMin: 0 });
  const line = (time: TimeSpec, override: number | null = null): LaborLine => ({
    kind: 'labor', workerId: null, workerName: '田中', time, dailyRate: 18000, note: '', overtimeRate: override,
  });
  const empty: TimeSpec = { start: null, end: null, breakMin: null, gapMin: null };
  it.each([
    ['8.0H', at('16:00'), null, rule, { hours: 8, manDays: 1, overtimeHours: 0, cost: 18000 }],
    ['7.5H', at('15:30'), null, rule, { hours: 7.5, manDays: 1, overtimeHours: 0, cost: 18000 }],
    ['4.0H', at('12:00'), null, rule, { hours: 4, manDays: 0.53, overtimeHours: 0, cost: 9540 }],
    ['9.0H', at('17:00'), null, rule, { hours: 9, manDays: 1, overtimeHours: 1, overtimeRate: 2813, cost: 20813 }],
    ['0H（未入力）', empty, null, rule, { hours: 0, manDays: 0, overtimeHours: 0, cost: 0 }],
    ['9.0H・作業員の残業単価 3,000', at('17:00'), 3000, rule, { manDays: 1, overtimeHours: 1, overtimeRate: 3000, cost: 21000 }],
    ['9.0H・割増率 0', at('17:00'), null, { ...rule, overtimeMultiplier: 0 }, { manDays: 1, overtimeHours: 1, cost: 18000 }],
    ['8:00〜17:30 休憩60 → 8.5H', at('17:30', 60), null, rule, { hours: 8.5, manDays: 1, overtimeHours: 0.5, cost: 19406.5 }],
  ] as const)('期待値 %s', (_label, time, override, r, expected) => {
    expect(laborLineValues(line(time, override), empty, r)).toMatchObject(expected);
  });
});
describe('燃料費・金額・歩掛', () => {
  it('40km ÷ 10km/L × 170円 = 680', () => expect(fuelCost(40, 10, 170)).toBe(680));
  it('燃費 0 は 0', () => expect(fuelCost(40, 0, 170)).toBe(0));
  it('燃費 null は 0', () => expect(fuelCost(40, null, 170)).toBe(0));
  it('amount 5 × 280 = 1400、null は 0', () => { expect(amount(5, 280)).toBe(1400); expect(amount(null, 280)).toBe(0); });
  it('歩掛 35㎡ ÷ 2人工 = 17.5、人工0は null', () => { expect(productivity(35, 2)).toBe(17.5); expect(productivity(35, 0)).toBeNull(); expect(productivity(35, null)).toBeNull(); });
});
describe('日報合計', () => {
  it('6区分の合計と出来高', () => {
    const t = reportTotals([
      { kind: 'labor', workerId: 'w1', workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '', overtimeRate: null },
      { kind: 'labor', workerId: 'w2', workerName: '佐藤', time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 }, dailyRate: 15000, note: '', overtimeRate: null },
      { kind: 'fuel', vehicleId: 'v1', vehicleName: 'ハイエース', kmPerL: 10, distanceKm: 40, pricePerL: 170, note: '' },
      { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 3500, note: '' },
      { kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: 'コメリ' },
      { kind: 'credit', itemName: 'タイル', spec: '', unit: '枚', qty: 50, unitPrice: 250, supplierId: null, vendor: 'ABC建材' },
      { kind: 'work', estimateItemId: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', manDays: 1.6, unitPrice: 1200, source: 'extra' },
    ], common, rule);
    expect(t.workerCount).toBe(2);
    expect(t.laborHours).toBe(12);                 // 8 + 4
    expect(t.manDays).toBe(1.53);                  // 1 + 0.53
    expect(t.overtimeHours).toBe(0);
    expect(t.labor).toBe(18000 + 7950);            // 18000×1 + 15000×0.53
    expect(t.fuel).toBe(680); expect(t.lease).toBe(3500); expect(t.cash).toBe(1400); expect(t.credit).toBe(12500);
    expect(t.cost).toBe(18000 + 7950 + 680 + 3500 + 1400 + 12500);
    expect(t.output).toBe(42000);
  });
  it('残業時間の合計（小数2桁）', () => {
    const long = { start: '07:00', end: '17:15', breakMin: 60, gapMin: 0 }; // 9.25H → 残業 1.25H
    const t = reportTotals([
      { kind: 'labor', workerId: null, workerName: '田中', time: long, dailyRate: 16000, note: '', overtimeRate: null },
      { kind: 'labor', workerId: null, workerName: '佐藤', time: { start: '08:00', end: '17:30', breakMin: 60, gapMin: 0 }, dailyRate: 18000, note: '', overtimeRate: 3000 },
      { kind: 'labor', workerId: null, workerName: '鈴木', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '', overtimeRate: null },
    ], common, rule);
    expect(t.overtimeHours).toBe(1.75);            // 1.25 + 0.5 + 0
    expect(t.manDays).toBe(3);
    expect(t.labor).toBe(16000 + 1.25 * 2500 + 18000 + 0.5 * 3000 + 18000);
  });
  it('進捗率：総額 null/0 は 0', () => { expect(progressRate(100, null)).toBe(0); expect(progressRate(100, 0)).toBe(0); expect(progressRate(2_500_000, 10_000_000)).toBe(0.25); });
});
