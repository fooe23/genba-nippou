import { describe, it, expect } from 'vitest';
import { yen, jpDate, jpDateTime, monthKey, todayJst } from '@/lib/calc/format';
describe('表示整形', () => {
  it('yen は四捨五入して桁区切り', () => expect(yen(19260)).toBe('¥19,260'));
  it('yen 0 は ¥0', () => expect(yen(0)).toBe('¥0'));
  it('yen 負数は -¥ 表記', () => expect(yen(-1234)).toBe('-¥1,234'));
  it('jpDate は月日をゼロ埋めしない', () => expect(jpDate('2026-11-05')).toBe('2026/11/5'));
  it('monthKey は年月', () => expect(monthKey('2026-11-05')).toBe('2026-11'));
  it('todayJst は YYYY-MM-DD 形式', () => expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  it('jpDateTime は日本時間の YYYY/MM/DD HH:mm', () => {
    expect(jpDateTime('2026-11-02T03:04:05.123456+00:00')).toBe('2026/11/02 12:04');
    expect(jpDateTime('2026-12-31T15:00:00Z')).toBe('2027/01/01 00:00');
  });
  it('jpDateTime は読めない値をそのまま返す', () => expect(jpDateTime('x')).toBe('x'));
});
