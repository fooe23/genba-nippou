import { describe, it, expect } from 'vitest';
import { visitNumbers, visitLabel } from '@/lib/calc/visit';
const dates = ['2026-10-28', '2026-10-30', '2026-11-02', '2026-11-05', '2026-11-04'];
describe('回目', () => {
  it('11/5 は当月3回目・通算5回目', () => expect(visitNumbers(dates, '2026-11-05')).toEqual({ monthIndex: 3, totalIndex: 5 }));
  it('10/28 は当月1回目・通算1回目', () => expect(visitNumbers(dates, '2026-10-28')).toEqual({ monthIndex: 1, totalIndex: 1 }));
  it('未保存の新しい日付も自分を含めて数える', () => expect(visitNumbers(dates, '2026-11-10')).toEqual({ monthIndex: 4, totalIndex: 6 }));
  it('表記', () => expect(visitLabel('2026-11-05', { monthIndex: 3, totalIndex: 18 })).toBe('2026/11/5（当月3回目・通算18回目）'));
});
