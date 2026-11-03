import { describe, expect, it } from 'vitest';
import { changeTotals } from '@/lib/calc/change';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { ChangeKind, WorkLine } from '@/lib/types';

function work(changeKind: ChangeKind, qty: number | null, unitPrice: number | null): WorkLine {
  return {
    kind: 'work', estimateItemId: null, trade: '大工', description: '', qty, unit: '㎡', manDays: null, unitPrice, source: 'extra',
    ...EMPTY_WORK_CHANGE, changeKind,
  };
}

describe('changeTotals（本日の追加・変更・減）', () => {
  it('行が無ければすべて 0', () => {
    expect(changeTotals([])).toEqual({ extra: 0, change: 0, minus: 0, net: 0 });
  });
  it('区分ごとに 数量 × 単価 を足す（契約内は数えない）', () => {
    const r = changeTotals([
      work('contract', 10, 1000),
      work('extra', 4, 3000),
      work('extra', 1, null),
      work('change', 3, 1000),
      work('minus', 5, 1000),
    ]);
    expect(r).toEqual({ extra: 12000, change: 3000, minus: -5000, net: 10000 });
  });
  it('減は正で入れても負で数える（負で入れた行もそのまま負）', () => {
    expect(changeTotals([work('minus', 2, 1500), work('minus', -1, 1000)])).toEqual({ extra: 0, change: 0, minus: -4000, net: -4000 });
  });
  it('契約内だけなら 0', () => {
    expect(changeTotals([work('contract', 10, 1000)])).toEqual({ extra: 0, change: 0, minus: 0, net: 0 });
  });
});
