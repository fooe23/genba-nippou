import { describe, it, expect, vi } from 'vitest';
import { Font } from '@react-pdf/renderer';
import { renderChangePdf } from '@/lib/pdf/change-ledger';
import { changeMeta, emptyChangeModel, sampleChangeModel, settledChangeModel } from './cost-fixture';

describe('renderChangePdf', () => {
  it('%PDF で始まるバッファを返し、Noto Sans JP とロゴを埋め込む（フォントの登録は 1 回だけ）', async () => {
    const register = vi.spyOn(Font, 'register');
    const pdf = await renderChangePdf(sampleChangeModel(), changeMeta());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const raw = pdf.toString('latin1');
    expect(raw).toContain('NotoSansJP');
    expect(raw).toContain('/Subtype /Image');

    await renderChangePdf(sampleChangeModel({ kind: 'month', month: '2026-11' }), changeMeta({ company: { name: null, contact: null } }));
    expect(register.mock.calls.filter(([f]) => f.family === 'NotoSansJP')).toHaveLength(1);
  }, 60_000);

  it('変更行 0 件・客先名なし・当初金額なしでも PDF を返す', async () => {
    const m = emptyChangeModel();
    const meta = changeMeta({ site: { ...changeMeta().site, clientName: null }, reportSpan: { from: null, to: null } });
    const pdf = await renderChangePdf({ ...m, settlement: { ...m.settlement, base: null, proposed: null } }, meta);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('NotoSansJP');
  }, 60_000);

  it('件ごとの精算（一式・常用・未定・やり直し・件なし）のある資料も PDF を返す（工期全体・月）', async () => {
    for (const period of [{ kind: 'all' } as const, { kind: 'month', month: '2026-11' } as const]) {
      const pdf = await renderChangePdf(settledChangeModel(period), changeMeta());
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    }
  }, 60_000);
});
