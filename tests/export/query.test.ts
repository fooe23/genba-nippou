import { describe, it, expect } from 'vitest';
import { fileNameStem } from '@/lib/export/file-name';
import { contentDisposition, MONTH_RE } from '@/lib/export/query';

describe('MONTH_RE', () => {
  it('YYYY-MM だけ', () => {
    expect(MONTH_RE.test('2026-11')).toBe(true);
    for (const m of ['', '2026-13', '2026-00', '2026-1', '202611', '2026-11-01', '2026/11']) expect(MONTH_RE.test(m)).toBe(false);
  });
});

describe('fileNameStem', () => {
  it('禁止文字と制御文字は _、前後の空白は除き、空なら「現場」', () => {
    expect(fileNameStem(' A/B:C*D?"E<F>G|H\\I ')).toBe('A_B_C_D__E_F_G_H_I');
    expect(fileNameStem('   ')).toBe('現場');
    expect(fileNameStem('〇〇様邸')).toBe('〇〇様邸');
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
