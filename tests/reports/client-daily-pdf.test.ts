import { describe, it, expect } from 'vitest';
import { renderClientDailyPdf } from '@/lib/pdf/client-daily-report';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { sampleDaily, site, withChanges } from './daily-fixture';

const AT = '2026-11-03T01:00:00Z';

function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

describe('renderClientDailyPdf', () => {
  it('客先確認の記録あり・なし：%PDF で始まり Noto Sans JP を埋め込む 1 ページ', async () => {
    for (const model of [withChanges(), sampleDaily({ issues: [] })]) {
      const pdf = await renderClientDailyPdf(model, AT);
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pdf.toString('latin1')).toContain('NotoSansJP');
      expect(pageCount(pdf)).toBe(1);
    }
  }, 60_000);

  it('日報の無い日：「日報がありません」だけの 1 ページ', async () => {
    const pdf = await renderClientDailyPdf(buildEmptyDailyReport(site, '2026-11-04'), AT);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
  }, 60_000);
});
