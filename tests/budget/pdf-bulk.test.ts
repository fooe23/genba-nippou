import { describe, expect, it } from 'vitest';
import {
  groupByHeading,
  initialExpanded,
  NO_HEADING_TITLE,
  pageSummaries,
  pagesLabel,
  setInclude,
  setTag,
  summarize,
  type BulkRow,
} from '@/lib/budget/pdf-bulk';

type R = BulkRow & { amount: number | null };

let n = 0;
function row(kind: BulkRow['kind'], page: number, opts: Partial<R> = {}): R {
  n += 1;
  return {
    key: `k${n}`,
    include: kind === 'item',
    kind,
    page,
    tag: '',
    name: kind === 'heading' ? `見出し${n}` : `行${n}`,
    amount: 100,
    ...opts,
  };
}
const amountOf = (r: R) => r.amount;

describe('groupByHeading', () => {
  it('見出しより前の行は「見出しなし」、見出しごとに束ねる', () => {
    const a = row('item', 1);
    const h1 = row('heading', 1, { name: '【仮設工事】' });
    const b = row('item', 1);
    const s = row('subtotal', 2);
    const h2 = row('heading', 2, { name: '【内装工事】' });
    const c = row('item', 3);
    const groups = groupByHeading([a, h1, b, s, h2, c]);
    expect(groups.map((g) => g.title)).toEqual([NO_HEADING_TITLE, '【仮設工事】', '【内装工事】']);
    expect(groups[0].keys).toEqual([a.key]);
    expect(groups[1].keys).toEqual([h1.key, b.key, s.key]);
    expect(groups[1].pages).toEqual([1, 2]);
    expect(groups[2]).toMatchObject({
      id: h2.key,
      keys: [h2.key, c.key],
      pages: [2, 3],
    });
  });

  it('続く見出しは 1 つの束にまとめる', () => {
    const h1 = row('heading', 1, { name: '建築工事' });
    const h2 = row('heading', 1, { name: '仮設工事' });
    const a = row('item', 1);
    const groups = groupByHeading([h1, h2, a]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('建築工事／仮設工事');
    expect(groups[0].keys).toEqual([h1.key, h2.key, a.key]);
  });

  it('行が無ければ束も無い', () => {
    expect(groupByHeading([])).toEqual([]);
  });
});

describe('pagesLabel', () => {
  it('1 ページ・続き・飛び', () => {
    expect(pagesLabel([3])).toBe('3 ページ');
    expect(pagesLabel([3, 4, 5])).toBe('3〜5 ページ');
    expect(pagesLabel([3, 5])).toBe('3・5 ページ');
    expect(pagesLabel([])).toBe('');
  });
});

describe('summaries', () => {
  it('取り込む行だけ数え、金額を足す', () => {
    const rows = [row('item', 1, { amount: 1000, tag: 't1' }), row('item', 1, { amount: null }), row('heading', 1), row('item', 2, { include: false })];
    expect(summarize(rows, amountOf)).toEqual({
      count: 2,
      amount: 1000,
      untagged: 1,
    });
    const pages = pageSummaries(rows, amountOf);
    expect(pages).toEqual([
      { page: 1, count: 2, amount: 1000, untagged: 1, checked: true },
      { page: 2, count: 0, amount: 0, untagged: 0, checked: false },
    ]);
  });
});

describe('setInclude', () => {
  it('付けるときは明細の行だけ、外すときは全部', () => {
    const rows = [row('heading', 1), row('item', 1, { include: false }), row('subtotal', 1), row('item', 2, { include: false })];
    const on = setInclude(rows, (r) => r.page === 1, true);
    expect(on.map((r) => r.include)).toEqual([false, true, false, false]);
    const withSub = on.map((r) => (r.kind === 'subtotal' ? { ...r, include: true } : r));
    const off = setInclude(withSub, (r) => r.page === 1, false);
    expect(off.map((r) => r.include)).toEqual([false, false, false, false]);
  });
});

describe('setTag', () => {
  it('取り込む行だけに付け、onlyEmpty なら工種がまだの行だけ', () => {
    const rows = [row('item', 1, { tag: 't1' }), row('item', 1), row('item', 1, { include: false })];
    expect(setTag(rows, () => true, 'x', true).map((r) => r.tag)).toEqual(['t1', 'x', '']);
    expect(setTag(rows, () => true, 'x', false).map((r) => r.tag)).toEqual(['x', 'x', '']);
  });
});

describe('initialExpanded', () => {
  it('行が少なければ全部開く、多ければ工種がまだの束だけ開く', () => {
    const h1 = row('heading', 1);
    const a = row('item', 1, { tag: 't1' });
    const h2 = row('heading', 2);
    const b = row('item', 2);
    const rows = [h1, a, h2, b];
    const groups = groupByHeading(rows);
    expect(initialExpanded(rows, groups)).toEqual({
      [h1.key]: true,
      [h2.key]: true,
    });
    expect(initialExpanded(rows, groups, 3)).toEqual({
      [h1.key]: false,
      [h2.key]: true,
    });
  });
});
