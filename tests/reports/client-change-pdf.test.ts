import { describe, it, expect } from 'vitest';
import { renderClientChangePdf } from '@/lib/pdf/client-change-ledger';
import { changeMeta, emptyChangeModel, settledChangeModel, spanningChangeModel } from './cost-fixture';

describe('renderClientChangePdf', () => {
  it('%PDF で始まり、Noto Sans JP とロゴを埋め込む（工期全体・月）', async () => {
    for (const period of [{ kind: 'all' } as const, { kind: 'month', month: '2026-11' } as const]) {
      const pdf = await renderClientChangePdf(settledChangeModel(period), changeMeta());
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      const raw = pdf.toString('latin1');
      expect(raw).toContain('NotoSansJP');
      expect(raw).toContain('/Subtype /Image');
    }
  }, 60_000);

  it('変更行 0 件・客先名なし・当初金額なしでも PDF を返す', async () => {
    const m = emptyChangeModel();
    const meta = changeMeta({ site: { ...changeMeta().site, clientName: null }, company: { name: null, contact: null } });
    const pdf = await renderClientChangePdf({ ...m, settlement: { ...m.settlement, base: null, proposed: null } }, meta);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 60_000);

  it('件が 2 日にまたがる明細（件ごとの見出しと小計）でも PDF を返す', async () => {
    const pdf = await renderClientChangePdf(spanningChangeModel(), changeMeta());
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 60_000);
});
