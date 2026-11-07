import { describe, it, expect } from 'vitest';
import { renderClientDailyReportPdf, type ClientPhotoImage } from '@/lib/pdf/client-daily-report';
import { buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { sampleDaily, site, withChanges } from './daily-fixture';
import { samplePhoto, sampleSignature } from './png-fixture';

const AT = '2026-11-03T01:00:00Z';

function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
}

/** 埋め込んだ画像の数（XObject の Image）。 */
function imageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Subtype\s*\/Image/g)?.length ?? 0;
}

/** 見本の写真 n 枚（横長・縦長・正方形を混ぜる。小さな PNG）。 */
function photos(n: number): ClientPhotoImage[] {
  const sizes: [number, number][] = [[64, 48], [36, 48], [48, 48], [96, 54]];
  return Array.from({ length: n }, (_, i) => {
    const [w, h] = sizes[i % sizes.length];
    return { caption: `11/02-${i + 1} 写真 ${i + 1}`, image: { data: samplePhoto(w, h, i), format: 'png' as const } };
  });
}

describe('renderClientDailyReportPdf', () => {
  it('客先確認の記録あり・なし：%PDF で始まり Noto Sans JP を埋め込む 1 ページ（写真なし）', async () => {
    for (const model of [withChanges(), sampleDaily({ issues: [] })]) {
      const pdf = await renderClientDailyReportPdf(model, { outputAt: AT });
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(pdf.toString('latin1')).toContain('NotoSansJP');
      expect(pageCount(pdf)).toBe(1);
      expect(imageCount(pdf)).toBe(0);
    }
  }, 60_000);

  it('日報の無い日：「日報がありません」だけの 1 ページ（写真を渡しても出さない）', async () => {
    const pdf = await renderClientDailyReportPdf(buildEmptyDailyReport(site, '2026-11-04'), { outputAt: AT, photos: photos(2) });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
    expect(imageCount(pdf)).toBe(0);
  }, 60_000);

  it('写真 1・3・8・20 枚とサイン：写真とサインの画像を埋め込み、多いと次のページに続く', async () => {
    const pages: number[] = [];
    for (const n of [1, 3, 8, 20]) {
      const pdf = await renderClientDailyReportPdf(withChanges(), { outputAt: AT, photos: photos(n), signaturePng: sampleSignature() });
      expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(imageCount(pdf)).toBe(n + 1);
      pages.push(pageCount(pdf));
    }
    expect(pages[0]).toBeGreaterThanOrEqual(1);
    expect(pages[2]).toBeGreaterThan(pages[0]);
    expect(pages[3]).toBeGreaterThan(pages[2]);
  }, 60_000);

  it('読めなかった写真は枠に文だけ（画像を埋め込まない）。サインが無ければサイン欄は空', async () => {
    const list: ClientPhotoImage[] = [{ caption: '11/02-1 読めない写真', image: null }, ...photos(1)];
    const pdf = await renderClientDailyReportPdf(sampleDaily(), { outputAt: AT, photos: list });
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(imageCount(pdf)).toBe(1);
  }, 60_000);
});
