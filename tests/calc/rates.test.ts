import { describe, it, expect } from 'vitest';
import { rateAt } from '@/lib/calc/rates';
const h = [{ amount: 18000, effectiveFrom: '2026-04-01' }, { amount: 19000, effectiveFrom: '2026-10-01' }];
describe('単価履歴', () => {
  it('改定日以降は新単価', () => expect(rateAt(h, '2026-10-01')).toBe(19000));
  it('改定日前は旧単価', () => expect(rateAt(h, '2026-09-30')).toBe(18000));
  it('履歴より前の日付は null', () => expect(rateAt(h, '2026-03-31')).toBeNull());
  it('履歴なしは null', () => expect(rateAt([], '2026-10-01')).toBeNull());
});
