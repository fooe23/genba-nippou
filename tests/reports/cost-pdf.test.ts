import { describe, it, expect, vi } from 'vitest';
import { Font } from '@react-pdf/renderer';
import { renderCostPdf } from '@/lib/pdf/cost-report';
import { emptyModel, sampleModel } from './cost-fixture';

describe('renderCostPdf', () => {
  it('%PDF で始まるバッファを返し、Noto Sans JP を埋め込む（登録は 1 回だけ）', async () => {
    const register = vi.spyOn(Font, 'register');
    const pdf = await renderCostPdf(sampleModel());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('NotoSansJP');

    await renderCostPdf(sampleModel({ kind: 'month', month: '2026-11' }));
    expect(register.mock.calls.filter(([f]) => f.family === 'NotoSansJP')).toHaveLength(1);
  }, 60_000);

  it('日報 0 件でも PDF を返す', async () => {
    const pdf = await renderCostPdf(emptyModel());
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('NotoSansJP');
  }, 60_000);
});
