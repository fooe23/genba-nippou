import { describe, expect, it } from 'vitest';
import { csvToRows, decodeCsv, parseCsvGrid, parseCsvText } from '@/lib/import/parse-csv';

describe('parseCsvGrid', () => {
  it('引用符・引用符内のカンマと改行・"" のエスケープ・CRLF', () => {
    const text = 'a,"b,c","d\r\ne","f""g"\r\n1,2,3,4\r\n';
    expect(parseCsvGrid(text)).toEqual([
      ['a', 'b,c', 'd\r\ne', 'f"g'],
      ['1', '2', '3', '4'],
    ]);
  });
  it('BOM を除き、最後の改行が無くても読む', () => {
    expect(parseCsvGrid('﻿作業員名\n山田')).toEqual([['作業員名'], ['山田']]);
  });
});

describe('parseCsvText（種別の判定）', () => {
  it.each([
    ['No.,作業員名,区分（職種）', 'workers'],
    ['取引先名,区分,担当者,備考', 'suppliers'],
    ['車両名／ナンバー,種別,燃費(km/L),備考', 'vehicles'],
    ['品目名,規格,リース単価（円/日）,備考', 'leaseItems'],
  ])('%s → %s', (header, kind) => {
    expect(parseCsvText(`${header}\n`).kind).toBe(kind);
  });
  it('判定できなければエラー', () => {
    expect(() => parseCsvText('名前,金額\n')).toThrow('種別を判定できません');
  });
});

describe('csvToRows', () => {
  it('見出し名で列を決め、No. 列が無くても読む。値の改行・カンマも保つ', () => {
    const text = '﻿作業員名,設定日当（円）,備考,区分（職種）\r\n山田,"18,000","朝礼係,\r\n月末精算",大工\r\n,,,\r\n鈴木,x,,\r\n';
    const { kind, grid } = parseCsvText(text);
    const r = csvToRows(kind, grid);
    expect(r.source).toBe('csv');
    expect(r.detected).toEqual(['workers']);
    expect(r.rows.workers).toEqual([{ name: '山田', trade: '大工', dailyRate: 18000, overtimeRate: null, note: '朝礼係,\r\n月末精算' }]);
    expect(r.errors).toEqual([{ kind: 'workers', rowNo: 4, name: '鈴木', message: '設定日当が数値ではありません（x）' }]);
  });
});

describe('decodeCsv', () => {
  it('UTF-8（BOM 付き）', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('品目名\n発電機\n')]);
    expect(decodeCsv(bytes.buffer)).toBe('品目名\n発電機\n');
  });
  it('Shift_JIS', () => {
    // "作業員名,設定日当（円）\r\n山田 太郎,18000\r\n" の Shift_JIS バイト列
    const sjis = new Uint8Array([
      141, 236, 139, 198, 136, 245, 150, 188, 44, 144, 221, 146, 232, 147, 250, 147, 150, 129, 105, 137, 126, 129, 106, 13, 10,
      142, 82, 147, 99, 32, 145, 190, 152, 89, 44, 49, 56, 48, 48, 48, 13, 10,
    ]);
    const text = decodeCsv(sjis.buffer);
    expect(text).toBe('作業員名,設定日当（円）\r\n山田 太郎,18000\r\n');
    const { kind, grid } = parseCsvText(text);
    expect(csvToRows(kind, grid).rows.workers).toEqual([{ name: '山田 太郎', trade: null, dailyRate: 18000, overtimeRate: null, note: null }]);
  });
});
