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

  it('= + - @ タブ CR で始まる文字列は先頭に \' を付ける（数式の注入を防ぐ）。数値の文字列と数値はそのまま', () => {
    expect(toCsv([['=SUM(A1)', '+1+1', '-5', '@foo', '+3.5', -5]])).toBe(`${BOM}'=SUM(A1),'+1+1,-5,'@foo,+3.5,-5\r\n`);
  });

  it('タブで始まる・" と , を含む数式は \' を付けてから " で囲む', () => {
    expect(toCsv([['\t=cmd', '=a,b']])).toBe(`${BOM}"'\t=cmd","'=a,b"\r\n`);
    expect(toCsv([['=a,"b"']])).toBe(`${BOM}"'=a,""b"""\r\n`);
  });
});
