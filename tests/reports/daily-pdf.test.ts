import { describe, it, expect, vi } from 'vitest';
import { Font } from '@react-pdf/renderer';
import { renderDailyPdf } from '@/lib/pdf/daily-report';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { dailyInput, report, sampleDaily, site, withChanges } from './daily-fixture';

const AT = '2026-11-03T01:00:00Z';

/** PDF のページ数（/Type /Page の数。/Pages は数えない）。 */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

describe('renderDailyPdf', () => {
  it('1 日分：%PDF で始まり Noto Sans JP を埋め込む。1〜2 ページ。フォントの登録は 1 回だけ', async () => {
    const register = vi.spyOn(Font, 'register');
    const pdf = await renderDailyPdf([sampleDaily()], AT);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.toString('latin1')).toContain('NotoSansJP');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
    expect(pageCount(pdf)).toBeLessThanOrEqual(2);

    await renderDailyPdf([sampleDaily()], AT);
    expect(register.mock.calls.filter(([f]) => f.family === 'NotoSansJP')).toHaveLength(1);
  }, 60_000);

  it('月まとめ：日ごとに改ページする（2 日分のページ数 = それぞれのページ数の和）', async () => {
    const day1 = sampleDaily();
    const day2 = sampleDaily({ report: report('2026-11-05'), issues: [], cumulativeOutputBefore: 250000 });
    const [one, two, both] = await Promise.all([
      renderDailyPdf([day1], AT),
      renderDailyPdf([day2], AT),
      renderDailyPdf([day1, day2], AT),
    ]);
    expect(both.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pageCount(both)).toBe(pageCount(one) + pageCount(two));
    expect(pageCount(both)).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('明細の無い日報（表はすべて「なし」）でも PDF を返す', async () => {
    const pdf = await renderDailyPdf([sampleDaily({ report: report('2026-11-02', { lines: [], issuesText: '', notesText: '' }), issues: [] })], AT);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
  }, 60_000);

  it('日報 0 件（日・月）：「日報がありません」だけの 1 ページ', async () => {
    for (const date of ['2026-11-04', '2026-12']) {
      const pdf = await renderDailyPdf([buildEmptyDailyReport(site, date)], AT);
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pdf.toString('latin1')).toContain('NotoSansJP');
      expect(pageCount(pdf)).toBe(1);
    }
  }, 60_000);

  it('客先確認の記録と追加・増・変更・減の行がある日：PDF を返す（1〜2 ページ）。記録が無い日（空の枠）も同じ', async () => {
    for (const model of [withChanges(), withChanges({ clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null })]) {
      const pdf = await renderDailyPdf([model], AT);
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
      expect(pageCount(pdf)).toBeLessThanOrEqual(2);
    }
  }, 60_000);

  it('出力日時を省略しても作れる', async () => {
    const pdf = await renderDailyPdf([sampleDaily(dailyInput())]);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 60_000);
});
