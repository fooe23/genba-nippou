import { emptyRows, findBlocks, findNameColumn, readBlocks } from './parse-sheet';
import type { ImportKind, ParseResult } from './types';

// 種別ごとの CSV（1 行目が見出し＝Excel と同じ見出し名、2 行目からデータ）の読み取り。

/** UTF-8（BOM 可）で読み、置換文字（U+FFFD）が出たら Shift_JIS で読み直す。 */
export function decodeCsv(buf: ArrayBuffer | Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('shift_jis').decode(buf);
}

/** RFC 4180 相当の小さなパーサ（引用符・引用符内の改行とカンマ・"" のエスケープ、CRLF／LF／CR）。 */
export function parseCsvGrid(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    grid.push(row);
  }
  return grid;
}

const DETECT_ORDER: ImportKind[] = ['workers', 'suppliers', 'vehicles', 'leaseItems'];

/** 見出し（1 行目）から種別を判定する。判定できなければ Error。 */
export function parseCsvText(text: string): { kind: ImportKind; grid: string[][] } {
  const grid = parseCsvGrid(text);
  const header = grid[0] ?? [];
  const kind = DETECT_ORDER.find((k) => findNameColumn(k, header) >= 0);
  if (!kind) {
    throw new Error('CSV の見出しから種別を判定できません（「作業員名」「取引先名」「車両名／ナンバー」「品目名」のいずれかの列が必要です）。');
  }
  return { kind, grid };
}

/** 見出し名で列を決めて読む（parseMasterSheet と同じ検証）。rowNo は CSV の何行目か（見出しが 1 行目）。 */
export function csvToRows(kind: ImportKind, grid: string[][]): ParseResult {
  const blocks = findBlocks(grid[0] ?? [], [kind]);
  if (blocks.length === 0) return { rows: emptyRows(), errors: [], source: 'csv', detected: [] };
  const { rows, errors } = readBlocks(grid, 0, blocks, { stopAtSection: false });
  return { rows, errors, source: 'csv', detected: [kind] };
}
