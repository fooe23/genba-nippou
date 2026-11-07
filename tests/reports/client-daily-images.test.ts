import { describe, it, expect } from 'vitest';
import { imageFormat, mapWithLimit } from '@/lib/reports/client-daily-images';
import { makePng } from './png-fixture';

describe('imageFormat', () => {
  it('JPEG・PNG を先頭のバイトで見分け、それ以外（HEIC・PDF・空）は null', () => {
    expect(imageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg');
    expect(imageFormat(makePng(2, 2, () => [0, 0, 0]))).toBe('png');
    expect(imageFormat(Buffer.from('%PDF-1.7', 'latin1'))).toBeNull();
    expect(imageFormat(Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]))).toBeNull();
    expect(imageFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe('mapWithLimit', () => {
  it('並びを保ち、同時に動くのは limit 件まで', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, (8 - n) * 2));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
    expect(await mapWithLimit([], 4, async (n: number) => n)).toEqual([]);
  });
});
