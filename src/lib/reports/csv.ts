// CSV の書き出し（純関数）。Excel でそのまま開けるよう UTF-8 の BOM を付け、改行は CRLF。

const NEEDS_QUOTE = /[",\t\r\n]/;
/** Excel が数式として読む先頭の文字。 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * 数式の注入を防ぐ：= + - @ タブ CR で始まる文字列（"-5" など数値の文字列を除く）の先頭に ' を付ける
 * （Excel は先頭の ' を「文字列」の印として扱う）。CSV と、予算と実績の集計 Excel で使う。
 */
export function neutralizeFormula(v: string): string {
  return FORMULA_START.test(v) && !Number.isFinite(Number(v)) ? `'${v}` : v;
}

function cell(v: string | number | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  const s = neutralizeFormula(v);
  return NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * 行の配列を CSV にする。null は空欄、数値は String(n)、" , タブ CR LF を含む値だけ " で囲む（" は 2 つ重ねる）。
 * = + - @ タブ CR で始まる文字列（数値の文字列を除く）は先頭に ' を付ける。
 */
export function toCsv(rows: (string | number | null)[][]): string {
  return '﻿' + rows.map((r) => r.map(cell).join(',') + '\r\n').join('');
}
