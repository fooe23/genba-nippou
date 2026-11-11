import ExcelJS from 'exceljs';
import {
  cellNumber,
  costSections,
  footerText,
  headerRows,
  NO_REPORTS,
  type Cell,
  type NumFmt,
  type SectionTable,
} from '@/lib/reports/cost-sections';
import type { LedgerAttendanceMonth } from '@/lib/reports/ledger-attendance';
import type { CostReportModel } from '@/lib/reports/types';

// 現場管理台帳の Excel（.xlsx・マクロなし。2026-11-11）。アプリの計算（buildCostReport）から exceljs でいちから作る。
// - 「現場原価集計」：工事原価集計表（PDF）と同じ中身（costSections）。合計の行の sumColumns の列は SUM の式（計算済みの値つき）。
// - 「出面一覧」：作業員 × 日付（buildLedgerAttendance）。月ごとに 1 つの表。人工計・出勤日数・日ごとの合計・うち請負は式。
// 見た目は以前の台帳（V34）にそろえる：紺の見出し・白字、水色の帯、メイリオ、細い罫線、見出しの固定。

export const LEDGER_SHEET_NAMES = ['現場原価集計', '出面一覧'] as const;
export const NO_ATTENDANCE = '出面がありません';
export const ATTENDANCE_NOTE = '繰越初期値は含みません（現場原価集計の ④ には含みます）';

const NAVY = 'FF1F3864';
const WHITE = 'FFFFFFFF';
const BAND = 'FFD9E1F2';
const TOTAL_BAND = 'FFF2F2F2';
const SAT = 'FFDBEAFE';
const SUN = 'FFFEE2E2';
const RULE = 'FFBFBFBF';
const FONT = 'Meiryo';

const thin = { style: 'thin', color: { argb: RULE } } as const;
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const NUM_FMT: Record<NumFmt, string | undefined> = {
  yen: '#,##0',
  int: '#,##0',
  dec1: '0.0',
  qty: undefined, // 標準（小数があるときだけ出る）
  pct: '0.0%',
};

/** 列番号 → 'A'〜。 */
function colName(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function headStyle(c: ExcelJS.Cell, numeric: boolean): void {
  c.font = { bold: true, color: { argb: WHITE } };
  c.fill = fill(NAVY);
  c.border = box;
  c.alignment = { horizontal: numeric ? 'right' : 'left', vertical: 'middle', wrapText: true };
}

/** 文字は文字の値のまま（= で始まっても式にしない）、数値は Excel に書く数値と書式。 */
function writeCell(target: ExcelJS.Cell, c: Cell, numeric: boolean): void {
  if (c === null || (typeof c === 'object' && c.value === null)) {
    target.value = '—';
  } else if (typeof c === 'string') {
    target.value = c;
  } else {
    target.value = cellNumber(c.value as number, c.fmt, false);
    const fmt = NUM_FMT[c.fmt];
    if (fmt) target.numFmt = fmt;
  }
  target.border = box;
  target.alignment = numeric ? { horizontal: 'right', vertical: 'middle' } : { vertical: 'middle', wrapText: true };
}

/**
 * 表を 1 列目から書く：列見出し（紺・白字）→ 行 → 合計の行（太字）。合計の行の sumColumns の列（合計が数値のとき）は
 * データの最初の行〜最後の行の SUM の式に、計算済みの値（result）を添える。ほかは値。
 */
export function writeLedgerTable(ws: ExcelJS.Worksheet, t: SectionTable): void {
  const head = ws.addRow(t.columns.map((c) => c.label));
  t.columns.forEach((col, i) => headStyle(head.getCell(i + 1), col.num));
  const body = (cells: Cell[]) => {
    const row = ws.addRow([]);
    cells.forEach((c, i) => writeCell(row.getCell(i + 1), c, t.columns[i].num));
    return row;
  };
  const rows = t.groups ? t.groups.flatMap((g) => g.rows) : t.rows;
  const first = ws.rowCount + 1;
  for (const r of rows) body(r);
  const last = ws.rowCount;
  if (t.total) {
    const row = body(t.total);
    const sums = new Set(t.sumColumns ?? []);
    t.total.forEach((c, i) => {
      if (!sums.has(i) || rows.length === 0 || c === null || typeof c === 'string' || c.value === null) return;
      const col = colName(i + 1);
      row.getCell(i + 1).value = { formula: `SUM(${col}${first}:${col}${last})`, result: cellNumber(c.value, c.fmt, false) };
    });
    row.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = fill(TOTAL_BAND);
      cell.border = { ...box, top: { style: 'medium', color: { argb: NAVY } } };
    });
  }
  for (const r of t.after ?? []) body(r);
}

/** 題の行（紺・白字・太字。A〜width 列を結合）。 */
function titleRow(ws: ExcelJS.Worksheet, text: string, width: number): ExcelJS.Row {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, width);
  const c = row.getCell(1);
  c.font = { bold: true, size: 14, color: { argb: WHITE } };
  c.fill = fill(NAVY);
  c.alignment = { vertical: 'middle' };
  row.height = 24;
  return row;
}

/** 全部のセルの字体をメイリオに（大きさ・太字・色はそのまま。大きさの無いセルは 9pt）。 */
function applyFont(ws: ExcelJS.Worksheet): void {
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 9, ...cell.font, name: FONT };
    }),
  );
}

/** A3（exceljs の PaperSize に名前が無いので数で。Excel の用紙番号 8）。 */
const A3 = 8 as ExcelJS.PaperSize;

const PAGE_MARGINS = { left: 0.39, right: 0.39, top: 0.59, bottom: 0.59, header: 0.3, footer: 0.3 };

// ─── 現場原価集計 ───

/** A 列（名前）・B 列（2 列目の文字）・C〜K 列（数値）。③ が 11 列で最も広い。 */
const COST_WIDTHS = [28, 18, 13, 13, 13, 13, 13, 13, 13, 13, 13];

function costSheet(wb: ExcelJS.Workbook, model: CostReportModel): void {
  const width = COST_WIDTHS.length;
  const ws = wb.addWorksheet(LEDGER_SHEET_NAMES[0], {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: PAGE_MARGINS },
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  ws.columns = COST_WIDTHS.map((w) => ({ width: w }));

  titleRow(ws, `${LEDGER_SHEET_NAMES[0]}　${model.header.siteName}`, width);
  for (const [label, value] of headerRows(model)) {
    const row = ws.addRow([label, value ?? '—']);
    ws.mergeCells(row.number, 2, row.number, width);
    const k = row.getCell(1);
    k.font = { bold: true };
    k.fill = fill(BAND);
    k.border = box;
    const v = row.getCell(2);
    v.border = box;
    v.alignment = { vertical: 'middle', wrapText: true };
  }

  const sections = costSections(model);
  if (sections.length === 0) {
    ws.addRow([]);
    ws.addRow([NO_REPORTS]);
  }
  for (const s of sections) {
    ws.addRow([]);
    // 表の題の帯（表の幅いっぱい）。補足は B 列に小さく。
    const span = Math.max(2, ...s.tables.map((t) => t.columns.length));
    const head = ws.addRow(s.note ? [s.title, s.note] : [s.title]);
    for (let i = 1; i <= span; i++) head.getCell(i).fill = fill(BAND);
    head.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
    if (s.note) head.getCell(2).font = { size: 8, color: { argb: 'FF555555' } };
    for (const t of s.tables) writeLedgerTable(ws, t);
  }

  if (sections.length > 0) {
    // 署名欄（作成者 = 出力した人、確認者・承認者は空欄）。右端の 3 列。工事原価集計表の Excel と同じ。
    ws.addRow([]);
    const labels = ws.addRow([]);
    const names = ws.addRow([]);
    names.height = 36;
    (['作成者', '確認者', '承認者'] as const).forEach((label, i) => {
      const col = width - 2 + i;
      const l = labels.getCell(col);
      l.value = label;
      l.font = { bold: true };
      l.fill = fill(BAND);
      l.border = box;
      l.alignment = { horizontal: 'center' };
      const n = names.getCell(col);
      n.value = i === 0 ? model.signature.createdBy : '';
      n.border = box;
      n.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
  }

  ws.pageSetup.printArea = `A1:${colName(width)}${ws.rowCount}`;
  ws.headerFooter.oddFooter = `&L&8${footerText(model).replaceAll('&', '&&')}&R&8ページ &P / &N`;
  applyFont(ws);
}

// ─── 出面一覧 ───

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
/** 作業員・所属・区分の 3 列の後に日付、その後に人工計・出勤日数。 */
const FIXED_COLS = 3;
const MAX_DAYS = 31;
/** 日の列の幅（名前なしの行があるときは「0.75（12名）」が入る幅）。 */
export const DAY_WIDTH = 6.5;
export const UNNAMED_DAY_WIDTH = 11;

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function dayFill(date: string): string | null {
  const w = weekday(date);
  return w === 6 ? SAT : w === 0 ? SUN : null;
}

function monthTitle(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function attendanceTable(ws: ExcelJS.Worksheet, siteName: string, m: LedgerAttendanceMonth): void {
  const dayCol = (i: number) => FIXED_COLS + 1 + i;
  const totalCol = dayCol(m.days.length);
  const countCol = totalCol + 1;
  const firstDay = colName(dayCol(0));
  const lastDay = colName(dayCol(m.days.length - 1));

  titleRow(ws, `${LEDGER_SHEET_NAMES[1]}　${siteName}　${monthTitle(m.month)}`, countCol);

  const head = ws.addRow(['作業員', '所属', '区分']);
  head.height = 30;
  for (let c = 1; c <= FIXED_COLS; c++) headStyle(head.getCell(c), false);
  m.days.forEach((d, i) => {
    const c = head.getCell(dayCol(i));
    c.value = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}\n${WEEKDAYS[weekday(d)]}`;
    headStyle(c, true);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const color = dayFill(d);
    if (color) {
      c.fill = fill(color);
      c.font = { bold: true, color: { argb: NAVY } };
    }
  });
  head.getCell(totalCol).value = '人工計';
  head.getCell(countCol).value = '出勤日数';
  headStyle(head.getCell(totalCol), true);
  headStyle(head.getCell(countCol), true);

  const first = ws.rowCount + 1;
  for (const r of m.rows) {
    const row = ws.addRow([r.name, r.affiliationLabel, r.kind]);
    for (let c = 1; c <= FIXED_COLS; c++) {
      row.getCell(c).border = box;
      row.getCell(c).alignment = { vertical: 'middle', wrapText: c === 1 };
    }
    m.days.forEach((d, i) => {
      const c = row.getCell(dayCol(i));
      const v = r.byDate[d];
      if (v) {
        c.value = v.manDays;
        // 名前なしの行は人数を表示の書式で添える（値は人工なので足し算はそのまま）
        c.numFmt = r.unnamed ? `0.0#"（${v.headcount}名）"` : '0.0#';
      }
      c.border = box;
      c.alignment = { horizontal: 'right', vertical: 'middle' };
      const color = dayFill(d);
      if (color) c.fill = fill(color);
    });
    const n = row.number;
    const total = row.getCell(totalCol);
    total.value = { formula: `SUM(${firstDay}${n}:${lastDay}${n})`, result: r.manDays };
    total.numFmt = '0.0#';
    const count = row.getCell(countCol);
    count.value = { formula: `COUNT(${firstDay}${n}:${lastDay}${n})`, result: r.workDays };
    count.numFmt = '0';
    for (const c of [total, count]) {
      c.border = box;
      c.font = { bold: true };
      c.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  }
  const last = ws.rowCount;

  const kindRange = `$C$${first}:$C$${last}`;
  const footer = (label: string, value: (col: string, date: string | null) => ExcelJS.CellFormulaValue) => {
    const row = ws.addRow([label]);
    ws.mergeCells(row.number, 1, row.number, FIXED_COLS);
    m.days.forEach((d, i) => (row.getCell(dayCol(i)).value = value(colName(dayCol(i)), d)));
    row.getCell(totalCol).value = value(colName(totalCol), null);
    for (let c = 1; c <= countCol; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true };
      cell.fill = fill(TOTAL_BAND);
      cell.border = c <= totalCol ? { ...box, top: { style: 'medium', color: { argb: NAVY } } } : box;
      if (c > FIXED_COLS) {
        cell.numFmt = '0.0#';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    }
    return row;
  };
  footer('日ごとの合計', (col, d) => ({ formula: `SUM(${col}${first}:${col}${last})`, result: d === null ? m.manDays : (m.dayTotals[d] ?? 0) }));
  const ukeoi = footer('うち請負', (col, d) => ({
    formula: `SUMIF(${kindRange},"請負",${col}${first}:${col}${last})`,
    result: d === null ? m.ukeoiManDays : (m.ukeoiDayTotals[d] ?? 0),
  }));
  ukeoi.eachCell((c) => (c.border = box));
  ws.addRow([]);
}

function attendanceSheet(wb: ExcelJS.Workbook, model: CostReportModel, months: LedgerAttendanceMonth[]): void {
  const ws = wb.addWorksheet(LEDGER_SHEET_NAMES[1], {
    pageSetup: { paperSize: A3, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: PAGE_MARGINS },
    views: [{ state: 'frozen', xSplit: FIXED_COLS, ySplit: 1 }],
  });
  // 名前なしの行の日のセルは「1.0（3名）」と出るので、幅 6.5 では入らず ### になる。そのときは日の列を広げる。
  const dayWidth = months.some((m) => m.rows.some((r) => r.unnamed)) ? UNNAMED_DAY_WIDTH : DAY_WIDTH;
  ws.columns = [{ width: 24 }, { width: 16 }, { width: 6 }, ...Array.from({ length: MAX_DAYS }, () => ({ width: dayWidth })), { width: 8 }, { width: 8 }];

  if (months.length === 0) {
    titleRow(ws, `${LEDGER_SHEET_NAMES[1]}　${model.header.siteName}`, FIXED_COLS + MAX_DAYS + 2);
    ws.addRow([NO_ATTENDANCE]);
  }
  for (const m of months) attendanceTable(ws, model.header.siteName, m);
  if (months.length > 0) {
    const note = ws.addRow([ATTENDANCE_NOTE]);
    note.getCell(1).font = { size: 8, color: { argb: 'FF555555' } };
  }

  const widest = Math.max(0, ...months.map((m) => m.days.length));
  ws.pageSetup.printArea = `A1:${colName(FIXED_COLS + Math.max(widest, 1) + 2)}${ws.rowCount}`;
  ws.headerFooter.oddFooter = `&L&8${footerText(model).replaceAll('&', '&&')}&R&8ページ &P / &N`;
  applyFont(ws);
}

export async function buildLedgerXlsx(model: CostReportModel, attendance: LedgerAttendanceMonth[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報アプリ';
  costSheet(wb, model);
  attendanceSheet(wb, model, attendance);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
