// CSV の書き出し（純関数）。Excel でそのまま開けるよう UTF-8 の BOM を付け、改行は CRLF。

const NEEDS_QUOTE = /[",\r\n]/;

function cell(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? String(v) : v;
  return NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** 行の配列を CSV にする。null は空欄、数値は String(n)、" , CR LF を含む値だけ " で囲む（" は 2 つ重ねる）。 */
export function toCsv(rows: (string | number | null)[][]): string {
  return '﻿' + rows.map((r) => r.map(cell).join(',') + '\r\n').join('');
}
