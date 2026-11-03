import { describe, it, expect } from 'vitest';
import { toCsv } from '@/lib/reports/csv';

const BOM = '﻿';

describe('toCsv', () => {
  it('先頭に BOM、行の区切りは CRLF（最後の行にも付ける）', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe(`${BOM}a,b\r\nc,d\r\n`);
  });

  it('空の行は空行になる', () => {
    expect(toCsv([['a'], [], ['b']])).toBe(`${BOM}a\r\n\r\nb\r\n`);
  });

  it('null は空、数値は String(n)（桁区切りなし）', () => {
    expect(toCsv([[null, 1234567, 0.5, -3, '']])).toBe(`${BOM},1234567,0.5,-3,\r\n`);
  });

  it('" , CR LF を含むときだけ " で囲み、" は 2 つ重ねる', () => {
    expect(toCsv([['木造 "在来"', 'a,b', 'x\ny', 'x\ry', '日本語 そのまま']])).toBe(
      `${BOM}"木造 ""在来""","a,b","x\ny","x\ry",日本語 そのまま\r\n`,
    );
  });
});
