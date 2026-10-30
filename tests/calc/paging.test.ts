import { describe, it, expect } from 'vitest';
import { chunk, fetchAllPages } from '@/lib/calc/paging';

describe('chunk', () => {
  it('size ごとに分ける', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('fetchAllPages', () => {
  const makeFetch = (total: number) => {
    const calls: [number, number][] = [];
    const fn = async (from: number, to: number) => {
      calls.push([from, to]);
      const rows: number[] = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push(i);
      return rows;
    };
    return { fn, calls };
  };
  it('1000 件を超えても全件取る', async () => {
    const { fn, calls } = makeFetch(2300);
    const rows = await fetchAllPages(fn, 1000);
    expect(rows).toHaveLength(2300);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('ちょうどページサイズなら空ページまで確認する', async () => {
    const { fn, calls } = makeFetch(1000);
    expect(await fetchAllPages(fn, 1000)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });
  it('0 件でも 1 回で終わる', async () => {
    const { fn, calls } = makeFetch(0);
    expect(await fetchAllPages(fn, 1000)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
