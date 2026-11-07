import { describe, expect, it } from 'vitest';
import { attachmentBadgeCounts, fitWithin } from '@/lib/calc/image-resize';

describe('fitWithin', () => {
  it('横長の写真は幅を 1600 にする', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
  });
  it('縦長の写真は高さを 1600 にする', () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('小さい写真は拡大しない', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });
  it('極端に細長い写真も短い辺は 1 以上', () => {
    const r = fitWithin(5000, 10);
    expect(r.width).toBe(1600);
    expect(r.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(r.height)).toBe(true);
    const t = fitWithin(10, 5000);
    expect(t).toEqual({ width: 3, height: 1600 });
    expect(fitWithin(1, 100000).width).toBe(1);
  });
  it('上限を変えられ、結果は整数', () => {
    const r = fitWithin(3001, 2001, 1000);
    expect(r).toEqual({ width: 1000, height: 667 });
  });
  it('正の数でない大きさはそのまま', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 100 });
  });
});

describe('attachmentBadgeCounts', () => {
  it('ファイルの有無と写真・リンクの数', () => {
    expect(attachmentBadgeCounts([])).toEqual({ hasFile: false, photos: 0, links: 0 });
    expect(
      attachmentBadgeCounts([{ kind: 'photo' }, { kind: 'photo' }, { kind: 'file' }, { kind: 'link' }, { kind: 'file' }]),
    ).toEqual({ hasFile: true, photos: 2, links: 1 });
    expect(attachmentBadgeCounts([{ kind: 'link' }, { kind: 'other' }])).toEqual({ hasFile: false, photos: 0, links: 1 });
  });
});
