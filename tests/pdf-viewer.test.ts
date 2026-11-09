import { describe, expect, it } from 'vitest';
import {
  downloadHref,
  fileNameFromDisposition,
  inlineHref,
  normalizeTitle,
  pdfViewerHref,
  validateBackPath,
  validatePdfSrc,
} from '@/lib/pdf-viewer';
import { contentDisposition } from '@/lib/export/query';

const DAILY = '/api/reports/daily?site=abc&date=2026-11-08&format=pdf&disposition=inline';

describe('validatePdfSrc', () => {
  it('許可した 4 つの API のパスだけ通す', () => {
    expect(validatePdfSrc(DAILY)).toBe(DAILY);
    expect(validatePdfSrc('/api/reports/cost?site=a&period=all&format=pdf')).toBe('/api/reports/cost?site=a&period=all&format=pdf');
    expect(validatePdfSrc('/api/reports/changes?site=a&period=all&format=pdf&audience=client')).not.toBeNull();
    expect(validatePdfSrc('/api/reports/signed?report=x')).toBe('/api/reports/signed?report=x');
  });
  it('# は捨てる', () => {
    expect(validatePdfSrc('/api/reports/signed?report=x#p=2')).toBe('/api/reports/signed?report=x');
  });
  it('ほかのパス・別のサイト・おかしな形は null', () => {
    for (const bad of [
      '',
      'api/reports/daily',
      '/api/export?site=a&month=2026-11',
      '/api/reports',
      '/api/reports/daily/x',
      '/api/reports/dailyx',
      '/api/reports/daily/../signed/../../admin',
      '/api/reports/x/../../../login',
      '//evil.example.com/api/reports/daily',
      '/\\evil.example.com/api/reports/daily',
      'https://evil.example.com/api/reports/daily',
      'http:/api/reports/daily',
      'javascript:alert(1)',
      '/api/reports/daily\n',
      '/API/REPORTS/DAILY',
      '/api/reports/%64aily',
      `/api/reports/daily?${'a'.repeat(2100)}`,
    ]) {
      expect(validatePdfSrc(bad), bad).toBeNull();
    }
    expect(validatePdfSrc(undefined)).toBeNull();
    expect(validatePdfSrc(['/api/reports/daily'])).toBeNull();
  });
  it('.. で許可したパスに着くものは、着いた先のパスで返す', () => {
    expect(validatePdfSrc('/api/x/../reports/daily?a=1')).toBe('/api/reports/daily?a=1');
  });
});

describe('validatePdfSrc（予算の PDF）', () => {
  it('/api/budget/pdf を通す（format を持たない）', () => {
    expect(validatePdfSrc('/api/budget/pdf?site=s&kind=setup')).toBe('/api/budget/pdf?site=s&kind=setup');
    expect(validatePdfSrc('/api/budget/pdf?site=s&kind=report&disposition=inline')).toBe('/api/budget/pdf?site=s&kind=report&disposition=inline');
    expect(validatePdfSrc('/api/budget/report?site=s')).toBeNull(); // 集計 Excel は通さない
    expect(validatePdfSrc('/api/budget/template?site=s')).toBeNull();
  });
  it('pdfViewerHref・downloadHref', () => {
    const href = pdfViewerHref({ src: '/api/budget/pdf?site=s&kind=setup', title: '実行予算', back: '/sites/s/budget/setup' })!;
    const q = new URL(href, 'http://x').searchParams;
    expect(q.get('src')).toBe('/api/budget/pdf?site=s&kind=setup');
    expect(q.get('back')).toBe('/sites/s/budget/setup');
    expect(downloadHref('/api/budget/pdf?site=s&kind=report')).toBe('/api/budget/pdf?site=s&kind=report&disposition=attachment');
  });
});

describe('validateBackPath', () => {
  it('同じサイトのパスを通す', () => {
    expect(validateBackPath('/sites/abc/reports/2026-11-08')).toBe('/sites/abc/reports/2026-11-08');
    expect(validateBackPath('/sites/abc/export?x=1#export-cost')).toBe('/sites/abc/export?x=1#export-cost');
    expect(validateBackPath('/')).toBe('/');
  });
  it('別のサイト・// ・API・ビューアー自身は null', () => {
    for (const bad of [
      '',
      'sites/abc',
      '//evil.example.com',
      '/\\evil.example.com',
      'https://evil.example.com/',
      'javascript:alert(1)',
      '/api/reports/daily',
      '/pdf?src=/api/reports/daily',
      '/sites\t/abc',
    ]) {
      expect(validateBackPath(bad), bad).toBeNull();
    }
    expect(validateBackPath(null)).toBeNull();
  });
});

describe('downloadHref・inlineHref', () => {
  it('disposition を attachment / inline にする', () => {
    expect(downloadHref(DAILY)).toBe('/api/reports/daily?site=abc&date=2026-11-08&format=pdf&disposition=attachment');
    expect(downloadHref('/api/reports/signed?report=r&history=2')).toBe('/api/reports/signed?report=r&history=2&disposition=attachment');
    expect(inlineHref('/api/reports/signed?report=r')).toBe('/api/reports/signed?report=r&disposition=inline');
    expect(inlineHref(DAILY)).toBe(DAILY);
  });
  it('許可していない src は null', () => {
    expect(downloadHref('/api/export?site=a')).toBeNull();
    expect(downloadHref('https://evil.example.com/api/reports/daily')).toBeNull();
    expect(inlineHref('//evil.example.com/x')).toBeNull();
  });
});

describe('pdfViewerHref', () => {
  it('src・title・back をクエリにする', () => {
    const href = pdfViewerHref({ src: DAILY, title: '日報 11/08', back: '/sites/abc/reports/2026-11-08' });
    expect(href).not.toBeNull();
    const q = new URL(href!, 'http://x').searchParams;
    expect(new URL(href!, 'http://x').pathname).toBe('/pdf');
    expect(q.get('src')).toBe(DAILY);
    expect(q.get('title')).toBe('日報 11/08');
    expect(q.get('back')).toBe('/sites/abc/reports/2026-11-08');
  });
  it('おかしな back・空の title は付けない', () => {
    const q = new URL(pdfViewerHref({ src: DAILY, title: '  ', back: '//evil' })!, 'http://x').searchParams;
    expect(q.has('title')).toBe(false);
    expect(q.has('back')).toBe(false);
  });
  it('許可していない src は null', () => {
    expect(pdfViewerHref({ src: '/api/export?site=a' })).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('空白をまとめ、長すぎれば切る', () => {
    expect(normalizeTitle(' 日報\n 11/08 ')).toBe('日報 11/08');
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle(1)).toBeNull();
    expect(normalizeTitle('あ'.repeat(100))).toBe(`${'あ'.repeat(80)}…`);
  });
});

describe('fileNameFromDisposition', () => {
  it('filename* を優先して日本語の名前を取る', () => {
    expect(fileNameFromDisposition(contentDisposition('日報_現場A_20261108.pdf', { inline: true }), 'x.pdf')).toBe('日報_現場A_20261108.pdf');
  });
  it('filename だけ・無いとき', () => {
    expect(fileNameFromDisposition('attachment; filename="a.pdf"', 'x.pdf')).toBe('a.pdf');
    expect(fileNameFromDisposition(null, 'x.pdf')).toBe('x.pdf');
    expect(fileNameFromDisposition("inline; filename*=UTF-8''%E0%A4", 'x.pdf')).toBe('x.pdf');
  });
});

describe('ドットでたたむと別のサイトになる形（2026-11-08 の見直し）', () => {
  const tricky = ['/..//evil.example.com', '/.//evil.example.com', '/sites/..//evil.example.com', '/x/../..//evil.example.com'];
  it('戻り先として通さない', () => {
    for (const p of tricky) expect(validateBackPath(p), p).toBeNull();
  });
  it('PDF の src としても通さない', () => {
    for (const p of tricky) expect(validatePdfSrc(p), p).toBeNull();
  });
  it('帳票の API は PDF だけ', () => {
    expect(validatePdfSrc('/api/reports/daily?site=a&date=2026-11-08&format=csv')).toBeNull();
    expect(validatePdfSrc('/api/reports/cost?site=a&period=all&format=xlsx')).toBeNull();
    expect(validatePdfSrc('/api/reports/daily?site=a&date=2026-11-08&format=pdf')).not.toBeNull();
  });
});
