import { describe, it, expect } from 'vitest';
import { contentDisposition, overflowNotice, parseExportQuery } from '@/lib/export/query';
import type { ExportWarning } from '@/lib/export/types';

const SITE = '0b6c2f9e-1a2b-4c3d-8e9f-0123456789ab';

describe('parseExportQuery', () => {
  it('現場（uuid）と年月（YYYY-MM）を返す', () => {
    expect(parseExportQuery(`http://localhost/api/export?site=${SITE}&month=2026-11`)).toEqual({ siteId: SITE, month: '2026-11' });
    expect(parseExportQuery(new URL(`http://localhost/api/export?month=2026-01&site=${SITE.toUpperCase()}`))).toEqual({
      siteId: SITE.toUpperCase(),
      month: '2026-01',
    });
  });

  it('現場が無い・uuid でなければエラー', () => {
    expect(parseExportQuery('http://localhost/api/export?month=2026-11')).toEqual({ error: '現場の指定が正しくありません' });
    expect(parseExportQuery('http://localhost/api/export?site=abc&month=2026-11')).toEqual({ error: '現場の指定が正しくありません' });
  });

  it('年月が無い・形式が違えばエラー', () => {
    for (const month of ['', '2026-13', '2026-00', '2026-1', '202611', '2026-11-01', '2026/11']) {
      expect(parseExportQuery(`http://localhost/api/export?site=${SITE}&month=${encodeURIComponent(month)}`)).toEqual({
        error: '年月の指定が正しくありません',
      });
    }
    expect(parseExportQuery(`http://localhost/api/export?site=${SITE}`)).toEqual({ error: '年月の指定が正しくありません' });
  });
});

describe('contentDisposition', () => {
  it('ASCII の代わりの名前（拡張子つき）と RFC 5987 の UTF-8 名を付ける', () => {
    expect(contentDisposition('現場A_2026年11月.xlsm')).toBe(
      `attachment; filename="export.xlsm"; filename*=UTF-8''%E7%8F%BE%E5%A0%B4A_2026%E5%B9%B411%E6%9C%88.xlsm`,
    );
  });

  it("RFC 5987 で使えない ' ( ) * も % で書く", () => {
    expect(contentDisposition("A(1)'*.xlsm")).toBe(`attachment; filename="export.xlsm"; filename*=UTF-8''A%281%29%27%2A.xlsm`);
  });

  it('拡張子が無ければ export だけ', () => {
    expect(contentDisposition('現場')).toBe(`attachment; filename="export"; filename*=UTF-8''%E7%8F%BE%E5%A0%B4`);
  });

  it('inline のときは inline で、ファイル名（ASCII の代わりと UTF-8 名）は同じ', () => {
    expect(contentDisposition('〇〇邸_日報_2026-11-02.pdf', { inline: true })).toBe(
      `inline; filename="export.pdf"; filename*=UTF-8''%E3%80%87%E3%80%87%E9%82%B8_%E6%97%A5%E5%A0%B1_2026-11-02.pdf`,
    );
    expect(contentDisposition('現場.pdf', { inline: false })).toBe(`attachment; filename="export.pdf"; filename*=UTF-8''%E7%8F%BE%E5%A0%B4.pdf`);
    expect(contentDisposition('現場.pdf', {})).toMatch(/^attachment; /);
  });
});

describe('overflowNotice', () => {
  it('超過が無ければ null（名前の警告は止めない）', () => {
    const warnings: ExportWarning[] = [
      { code: 'name_not_in_master', message: '作業員『山田』がマスターにありません', date: '2026-11-03' },
      { code: 'duplicate_name', message: '作業員名『山田』が 2 件あります' },
    ];
    expect(overflowNotice([])).toBeNull();
    expect(overflowNotice(warnings)).toBeNull();
  });

  it('行の超過は「{日付} の {表} が {n} 行」で知らせる', () => {
    const warnings: ExportWarning[] = [
      { code: 'duplicate_name', message: '作業員名『山田』が 2 件あります' },
      { code: 'rows_overflow', message: '2026年11月3日 の作業員が12行で、雛形の10行を超えています', date: '2026-11-03' },
      { code: 'rows_overflow', message: '2026年11月4日 のリースが7行で、雛形の6行を超えています', date: '2026-11-04' },
    ];
    expect(overflowNotice(warnings)).toBe('この月は原本 Excel では出せません（2026年11月3日 の 作業員 が 12 行）。PDF／CSV をご利用ください');
  });

  it('件数の超過（too_many_*）はその文をそのまま入れる', () => {
    const warnings: ExportWarning[] = [{ code: 'too_many_workers', message: '作業員が 31 人います。雛形に書けるのは 30 人までです' }];
    expect(overflowNotice(warnings)).toBe(
      'この月は原本 Excel では出せません（作業員が 31 人います。雛形に書けるのは 30 人までです）。PDF／CSV をご利用ください',
    );
  });
});
