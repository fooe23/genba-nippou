import { describe, it, expect } from 'vitest';
import { monthGrid, prevMonth, nextMonth, daysBetween } from '@/lib/calc/calendar';

describe('monthGrid', () => {
  it('2026-11-01 は日曜なので先頭から始まる', () => {
    const { dates } = monthGrid('2026-11');
    expect(dates[0]).toBe('2026-11-01');
    expect(dates.filter((d) => d !== null)).toHaveLength(30);
    expect(dates.length % 7).toBe(0);
  });
  it('2026-10-01 は木曜なので先頭4つが null', () => {
    const { dates } = monthGrid('2026-10');
    expect(dates.slice(0, 4)).toEqual([null, null, null, null]);
    expect(dates[4]).toBe('2026-10-01');
    expect(dates.filter((d) => d !== null)).toHaveLength(31);
    expect(dates.length).toBe(35);
  });
  it('末尾は null で埋めて 7 の倍数（5 週または 6 週）', () => {
    const { dates } = monthGrid('2026-08'); // 8/1 は土曜 + 31 日 = 6 週
    expect(dates.length).toBe(42);
    expect(dates[6]).toBe('2026-08-01');
    expect(dates[36]).toBe('2026-08-31');
    expect(dates[37]).toBeNull();
  });
  it('うるう年の 2 月は 29 日', () => {
    expect(monthGrid('2028-02').dates.filter((d) => d !== null)).toHaveLength(29);
    expect(monthGrid('2027-02').dates.filter((d) => d !== null)).toHaveLength(28);
  });
});

describe('月送り', () => {
  it('年またぎ', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(prevMonth('2026-01')).toBe('2025-12');
  });
  it('通常', () => {
    expect(nextMonth('2026-10')).toBe('2026-11');
    expect(prevMonth('2026-10')).toBe('2026-09');
  });
});

describe('daysBetween', () => {
  it('同日は 0、月またぎ・年またぎも数える', () => {
    expect(daysBetween('2026-10-30', '2026-10-30')).toBe(0);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-11-05', '2026-11-01')).toBe(-4);
  });
});
