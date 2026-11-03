import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { cellDate, cellMinutes, cellTime, DAY_LAYOUT, isDaySheetWorkbook, parseDaySheet } from '@/lib/import/day-sheet';

const ROOT = process.cwd();
const TEMPLATE = path.join(ROOT, 'templates', '現場管理日報_1日追加用_雛形.xlsm');

/** "B8" → [7, 1]（grid の行・列の添字）。 */
function addr(a: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(a);
  const col = m[1].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return [Number(m[2]) - 1, col];
}

/** セル番地 → 値 の対応から、A1 始まりの grid（sheet_to_json の header:1 と同じ形）を作る。 */
function gridWith(cells: Record<string, unknown>): unknown[][] {
  const grid: unknown[][] = Array.from({ length: 80 }, () => Array(12).fill(null));
  for (const [a, v] of Object.entries(cells)) {
    const [r, c] = addr(a);
    grid[r][c] = v;
  }
  return grid;
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

describe('DAY_LAYOUT は Python の layout.py と同じ位置', () => {
  const py = readFileSync(path.join(ROOT, 'python', 'genba_export', 'layout.py'), 'utf8');

  it('単独セル（DAY_CELLS）', () => {
    const block = /DAY_CELLS = \{([\s\S]*?)\n\}/.exec(py)?.[1] ?? '';
    const pyCells = Object.fromEntries([...block.matchAll(/"(\w+)":\s*"([A-Z]+\d+)"/g)].map((m) => [camel(m[1]), m[2]]));
    expect(Object.keys(pyCells).length).toBeGreaterThan(10);
    for (const [key, cell] of Object.entries(DAY_LAYOUT.cells)) {
      expect(cell, key).toBe(pyCells[key]);
    }
  });

  it('明細表（DAY_TABLES）の行範囲と列', () => {
    const block = /DAY_TABLES = \{([\s\S]*?)\n\}/.exec(py)?.[1] ?? '';
    const re =
      /"(\w+)": \{\s*"label": "[^"]*", "first_row": (\d+), "last_row": (\d+)[^\n]*\n\s*"columns": \{([^}]*)\},[\s\S]*?"formula_columns": ([^\n]*)\n/g;
    const pyTables = [...block.matchAll(re)].map((m) => ({
      key: m[1],
      firstRow: Number(m[2]),
      lastRow: Number(m[3]),
      columns: Object.fromEntries([
        ...[...m[4].matchAll(/"(\w+)": "([A-Z]+)"/g)].map((c) => [camel(c[1]), c[2]]),
        ...[...m[5].matchAll(/"(\w+)": \{"column": "([A-Z]+)"/g)].map((c) => [camel(c[1]), c[2]]),
      ]),
    }));
    expect(pyTables.map((t) => t.key)).toEqual(['labor', 'fuel', 'lease', 'cash', 'credit', 'work']);
    expect(Object.keys(DAY_LAYOUT.tables)).toEqual(pyTables.map((t) => t.key));
    for (const t of pyTables) {
      const ts = DAY_LAYOUT.tables[t.key as keyof typeof DAY_LAYOUT.tables];
      expect({ firstRow: ts.firstRow, lastRow: ts.lastRow, columns: ts.columns }, t.key).toEqual({
        firstRow: t.firstRow,
        lastRow: t.lastRow,
        columns: t.columns,
      });
    }
  });
});

describe('1 日分の雛形（実ファイル）', () => {
  const wb = XLSX.read(readFileSync(TEMPLATE), { type: 'buffer', sheets: DAY_LAYOUT.sheet });
  const ws = wb.Sheets[DAY_LAYOUT.sheet];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, range: XLSX.utils.decode_range(`A1:${ws['!ref']?.split(':')[1]}`) });

  it('シートは マスター・現場情報マスター・1回目', () => {
    expect(wb.SheetNames).toEqual(['マスター', '現場情報マスター', '1回目']);
    expect(isDaySheetWorkbook(wb.SheetNames)).toBe(true);
    expect(isDaySheetWorkbook(['マスター'])).toBe(false);
  });

  it('入力セルはすべて空（数式の列 J・F は除く）', () => {
    const filled: string[] = [];
    for (const cell of Object.values(DAY_LAYOUT.cells)) if (ws[cell] !== undefined) filled.push(cell);
    for (const [key, t] of Object.entries(DAY_LAYOUT.tables)) {
      const formula = new Set<string>(key === 'labor' ? ['J'] : key === 'lease' ? ['F'] : []);
      for (let r = t.firstRow; r <= t.lastRow; r++) {
        for (const col of Object.values(t.columns)) {
          if (formula.has(col)) continue;
          if (ws[`${col}${r}`] !== undefined) filled.push(`${col}${r}`);
        }
      }
    }
    expect(filled).toEqual([]);
    // 数式の列（日当・リース単価の VLOOKUP）は数式のまま。
    expect(ws.J8.f).toContain('VLOOKUP');
    expect(ws.F27.f).toContain('VLOOKUP');
  });

  it('空の雛形を読むと何も無い', () => {
    const p = parseDaySheet(grid);
    expect(p).toEqual({
      date: null,
      weather: null,
      supervisor: null,
      common: { start: null, end: null, breakMin: null, gapMin: null },
      labor: [],
      fuel: [],
      lease: [],
      cash: [],
      credit: [],
      work: [],
      issuesText: '',
      notesText: '',
      notes: [],
    });
  });
});

describe('parseDaySheet（手で作った grid）', () => {
  it('基本情報と共通時間（シリアル値の日付・時刻）', () => {
    const p = parseDaySheet(
      gridWith({ F2: 46329, F3: ' 晴れ ', F4: '山田', B6: 8 / 24, C6: 17 / 24, D6: 60, E6: 0 }),
    );
    expect(p.date).toBe('2026-11-03');
    expect(p.weather).toBe('晴れ');
    expect(p.supervisor).toBe('山田');
    expect(p.common).toEqual({ start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 });
    expect(p.notes).toEqual([]);
  });

  it('共通時間が空なら null（文字の時刻・日付も読める）', () => {
    const p = parseDaySheet(gridWith({ F2: '2026/11/3', C6: '17:30' }));
    expect(p.date).toBe('2026-11-03');
    expect(p.common).toEqual({ start: null, end: '17:30', breakMin: null, gapMin: null });
  });

  it('作業員の表（8〜17 行。名前の無い行は飛ばす。J 列の日当も読む）', () => {
    const p = parseDaySheet(
      gridWith({
        B8: '山田 太郎',
        J8: 18000,
        B9: '  鈴木  ',
        C9: '7:00',
        D9: 16 / 24,
        E9: '30',
        F9: 15,
        J9: 0,
        L9: '早上がり',
        C10: '8:00',
        J10: 18000,
        B17: '佐藤',
      }),
    );
    expect(p.labor).toEqual([
      { name: '山田 太郎', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 18000, note: '' },
      { name: '鈴木', time: { start: '07:00', end: '16:00', breakMin: 30, gapMin: 15 }, dailyRate: 0, note: '早上がり' },
      { name: '佐藤', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: null, note: '' },
    ]);
  });

  it('車両・リース・現金・買掛・作業内容の表', () => {
    const p = parseDaySheet(
      gridWith({
        B21: 'ハイエース 1234',
        D21: 42.5,
        E21: '165',
        H21: '資材運搬',
        B23: '軽トラ',
        B27: '発電機',
        C27: '2kVA',
        D27: '日',
        E27: 1,
        F27: 3000,
        H27: '',
        B36: 'ビス',
        C36: '3.8×32',
        D36: '箱',
        E36: 2,
        F36: '1,200',
        H36: 'ホームセンター',
        B45: '合板',
        C45: '12mm',
        D45: '枚',
        E45: 10,
        F45: 1500,
        H45: '○○建材',
        B63: '大工',
        C63: '床下地',
        E63: 20,
        F63: '㎡',
        G63: 1.5,
        I63: 3000,
        C64: '片付け',
        H60: 0,
      }),
    );
    expect(p.fuel).toEqual([
      { name: 'ハイエース 1234', distanceKm: 42.5, pricePerL: 165, note: '資材運搬' },
      { name: '軽トラ', distanceKm: null, pricePerL: null, note: '' },
    ]);
    expect(p.lease).toEqual([{ name: '発電機', spec: '2kVA', unit: '日', qty: 1, unitPrice: 3000, note: '' }]);
    expect(p.cash).toEqual([{ name: 'ビス', spec: '3.8×32', unit: '箱', qty: 2, unitPrice: 1200, vendor: 'ホームセンター' }]);
    expect(p.credit).toEqual([{ name: '合板', spec: '12mm', unit: '枚', qty: 10, unitPrice: 1500, vendor: '○○建材' }]);
    expect(p.work).toEqual([
      { trade: '大工', description: '床下地', qty: 20, unit: '㎡', manDays: 1.5, unitPrice: 3000 },
      { trade: '', description: '片付け', qty: null, unit: '', manDays: null, unitPrice: null },
    ]);
    expect(p.notes).toEqual([]);
  });

  it('重要事項・連絡事項（連絡事項の先頭の【通算M回目】は除く）', () => {
    const p = parseDaySheet(gridWith({ A71: '  足場の点検  ', A76: '【通算12回目】\n明日は雨天中止' }));
    expect(p.issuesText).toBe('足場の点検');
    expect(p.notesText).toBe('明日は雨天中止');
  });

  it('読めない値は空欄にして注記を出す。E60・H60 は取り込まない旨を注記する', () => {
    const p = parseDaySheet(gridWith({ F2: '来週', B6: '朝', B8: '山田', E8: 'abc', B21: '軽トラ', D21: '遠い', E60: 120000, H60: 50000 }));
    expect(p.date).toBeNull();
    expect(p.common.start).toBeNull();
    expect(p.labor[0].time.breakMin).toBeNull();
    expect(p.fuel[0].distanceKm).toBeNull();
    expect(p.notes).toEqual([
      '日付（F2）を読み取れないため空欄にしました（来週）',
      '共通時間の開始（B6）を読み取れないため空欄にしました（朝）',
      '作業員の 8 行目：休憩（E8）を読み取れないため空欄にしました（abc）',
      '車両の 21 行目：走行距離（D21）を読み取れないため空欄にしました（遠い）',
      'ファイルの累計原価（E60）・本日出来高（H60）は取り込みません（アプリが明細から計算します）',
    ]);
  });

  it('A1 から始まらない短い grid でも落ちない', () => {
    expect(parseDaySheet([]).labor).toEqual([]);
  });
});

describe('値の読み取り', () => {
  it('cellTime：シリアル値・HH:MM の文字・Date', () => {
    expect(cellTime(null)).toEqual({ ok: true, value: null });
    expect(cellTime('')).toEqual({ ok: true, value: null });
    expect(cellTime(0.5)).toEqual({ ok: true, value: '12:00' });
    expect(cellTime(8.5 / 24)).toEqual({ ok: true, value: '08:30' });
    expect(cellTime(46329 + 17.25 / 24)).toEqual({ ok: true, value: '17:15' });
    expect(cellTime(0.99999999)).toEqual({ ok: true, value: '00:00' });
    expect(cellTime('8:05')).toEqual({ ok: true, value: '08:05' });
    expect(cellTime('１７：３０')).toEqual({ ok: true, value: '17:30' });
    expect(cellTime('07:00:00')).toEqual({ ok: true, value: '07:00' });
    expect(cellTime(new Date(1899, 11, 30, 7, 59, 59, 900))).toEqual({ ok: true, value: '08:00' });
    expect(cellTime('25:00')).toEqual({ ok: false });
    expect(cellTime('朝')).toEqual({ ok: false });
    expect(cellTime(-0.1)).toEqual({ ok: false });
  });

  it('cellDate：シリアル値・Date・YYYY-MM-DD／YYYY/MM/DD の文字', () => {
    expect(cellDate(null)).toEqual({ ok: true, value: null });
    expect(cellDate(46329)).toEqual({ ok: true, value: '2026-11-03' });
    expect(cellDate(46329.75)).toEqual({ ok: true, value: '2026-11-03' });
    expect(cellDate(new Date(2026, 10, 3))).toEqual({ ok: true, value: '2026-11-03' });
    expect(cellDate('2026-11-03')).toEqual({ ok: true, value: '2026-11-03' });
    expect(cellDate('2026/1/5')).toEqual({ ok: true, value: '2026-01-05' });
    expect(cellDate('２０２６／１１／０３')).toEqual({ ok: true, value: '2026-11-03' });
    expect(cellDate('2026/02/30')).toEqual({ ok: false });
    expect(cellDate('来週')).toEqual({ ok: false });
    expect(cellDate(0)).toEqual({ ok: false });
  });

  it('cellMinutes：整数の分・「30分」・時刻（0:30）', () => {
    expect(cellMinutes(null)).toEqual({ ok: true, value: null });
    expect(cellMinutes(60)).toEqual({ ok: true, value: 60 });
    expect(cellMinutes('45')).toEqual({ ok: true, value: 45 });
    expect(cellMinutes('30分')).toEqual({ ok: true, value: 30 });
    expect(cellMinutes(0.5 / 24)).toEqual({ ok: true, value: 30 });
    expect(cellMinutes('1:15')).toEqual({ ok: true, value: 75 });
    expect(cellMinutes(30.5)).toEqual({ ok: false });
    expect(cellMinutes(-5)).toEqual({ ok: false });
    expect(cellMinutes('abc')).toEqual({ ok: false });
  });
});
