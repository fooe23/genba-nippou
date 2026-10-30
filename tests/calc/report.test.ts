import { describe, it, expect } from 'vitest';
import { hoursBetween, commonHours, effectiveHours, manDays, laborCost, fuelCost, amount, productivity, reportTotals, progressRate } from '@/lib/calc/report';
const common = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };

describe('時間', () => {
  it('hoursBetween 08:00→17:00 は 9', () => expect(hoursBetween('08:00', '17:00')).toBe(9));
  it('commonHours 8-17 休憩60 は 8', () => expect(commonHours(common)).toBe(8));
  it('個別時間が無ければ共通実働', () => expect(effectiveHours({ start: null, end: null, breakMin: null, gapMin: null }, common)).toBe(8));
  it('個別 09:00-15:30 休憩null 中抜30 → 休憩は共通60を使い 5.0', () => expect(effectiveHours({ start: '09:00', end: '15:30', breakMin: null, gapMin: 30 }, common)).toBe(5));
  it('終了が開始より前なら 0', () => expect(effectiveHours({ start: '17:00', end: '08:00', breakMin: 0, gapMin: 0 }, common)).toBe(0));
  it('共通の start が無ければ 0', () => expect(commonHours({ start: null, end: null, breakMin: 60, gapMin: 0 })).toBe(0));
});
describe('人工・労務費', () => {
  it('8時間は 1.07 人工', () => expect(manDays(8)).toBe(1.07));
  it('7.5時間は 1 人工', () => expect(manDays(7.5)).toBe(1));
  it('労務費 18000 × 1.07 = 19260', () => expect(laborCost(18000, 1.07)).toBe(19260));
  it('日当 null は 0', () => expect(laborCost(null, 1)).toBe(0));
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
      { kind: 'labor', workerId: 'w1', workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '' },
      { kind: 'labor', workerId: 'w2', workerName: '佐藤', time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 }, dailyRate: 15000, note: '' },
      { kind: 'fuel', vehicleId: 'v1', vehicleName: 'ハイエース', kmPerL: 10, distanceKm: 40, pricePerL: 170, note: '' },
      { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '', unit: '式', qty: 1, unitPrice: 3500, note: '' },
      { kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: 'コメリ' },
      { kind: 'credit', itemName: 'タイル', spec: '', unit: '枚', qty: 50, unitPrice: 250, supplierId: null, vendor: 'ABC建材' },
      { kind: 'work', estimateItemId: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', manDays: 1.6, unitPrice: 1200, source: 'extra' },
    ], common);
    expect(t.workerCount).toBe(2);
    expect(t.laborHours).toBe(12);                 // 8 + 4
    expect(t.manDays).toBe(1.6);                   // 1.07 + 0.53
    expect(t.labor).toBe(19260 + 7950);            // 18000×1.07 + 15000×0.53
    expect(t.fuel).toBe(680); expect(t.lease).toBe(3500); expect(t.cash).toBe(1400); expect(t.credit).toBe(12500);
    expect(t.cost).toBe(19260 + 7950 + 680 + 3500 + 1400 + 12500);
    expect(t.output).toBe(42000);
  });
  it('進捗率：総額 null/0 は 0', () => { expect(progressRate(100, null)).toBe(0); expect(progressRate(100, 0)).toBe(0); expect(progressRate(2_500_000, 10_000_000)).toBe(0.25); });
});
