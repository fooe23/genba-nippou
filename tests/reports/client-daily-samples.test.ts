import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { Issue } from '@/lib/db/reports';
import { renderClientDailyReportPdf, type ClientPhotoImage } from '@/lib/pdf/client-daily-report';
import { issues, lines, changeWorkLines, report, sampleDaily } from './daily-fixture';
import { samplePhoto, sampleSignature } from './png-fixture';

// 現場日報（お客様用）の見本 PDF（写真 0・1・3・8 枚、サインあり・なし）を docs/superpowers/samples/ に書き出す。
// ふだんは動かさない：WRITE_PDF_SAMPLES=1 npx vitest run tests/reports/client-daily-samples.test.ts

const OUT = 'docs/superpowers/samples';
const AT = '2026-11-06T07:30:00Z';

const sampleIssues: Issue[] = [
  { ...issues[0], id: 'i1', body: '2 階トイレの手すりを追加（施主様より）', kind: 'extra', instructedBy: '施主様', instructionMethod: 'oral' },
  { ...issues[1], id: 'i2', body: '外壁の色を変更（色見本で確認）', kind: 'change', instructedBy: '設計 山田', instructionMethod: 'phone', status: 'open', doneAt: null },
];

const CAPTIONS = [
  '11/02-1 手すりの位置',
  '11/02-1 下地の補強',
  '11/02-2 外壁の色見本（左が新しい色）',
  '10/30-3 土間コンクリートの打設前の配筋。かぶり厚さを確認しました',
  '朝の現場の様子',
  '',
  '片付け後',
  '搬入した資材',
];

/** 横長（4:3）・縦長（3:4）・ワイド（16:9）・正方形を混ぜる。 */
const SIZES: [number, number][] = [[320, 240], [240, 320], [320, 180], [240, 240]];

function photos(n: number, failAt?: number): ClientPhotoImage[] {
  return Array.from({ length: n }, (_, i) => {
    const [w, h] = SIZES[i % SIZES.length];
    return {
      caption: CAPTIONS[i % CAPTIONS.length],
      image: i === failAt ? null : { data: samplePhoto(w, h, i * 0.9), format: 'png' as const },
    };
  });
}

const signedModel = () =>
  sampleDaily({
    issues: sampleIssues,
    report: report('2026-11-02', {
      lines: [...lines, ...changeWorkLines],
      clientConfirmedBy: '施主 〇〇様',
      clientConfirmedAt: '2026-11-02T08:15:00+00:00',
      clientConfirmedNote: '手すりの位置と外壁の色を現地で確認。',
    }),
  });

const unsignedModel = () => sampleDaily({ issues: sampleIssues, report: report('2026-11-02', { lines: [...lines, ...changeWorkLines] }) });

describe.skipIf(!process.env.WRITE_PDF_SAMPLES)('見本 PDF を書き出す', () => {
  it('写真 0・1・3・8 枚、サインあり・なし', async () => {
    mkdirSync(OUT, { recursive: true });
    const cases: [string, ClientPhotoImage[], boolean][] = [
      ['0', [], false],
      ['0-signed', [], true],
      ['1-signed', photos(1), true],
      ['3', photos(3, 2), false],
      ['8-signed', photos(8), true],
    ];
    for (const [name, list, signed] of cases) {
      const pdf = await renderClientDailyReportPdf(signed ? signedModel() : unsignedModel(), {
        outputAt: AT,
        photos: list,
        signaturePng: signed ? sampleSignature() : undefined,
      });
      writeFileSync(`${OUT}/client-daily-photos-${name}.pdf`, pdf);
    }
  }, 120_000);
});
