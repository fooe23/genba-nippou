import ExcelJS from 'exceljs';
import {
  cellNumber,
  costSections,
  COST_REPORT_TITLE,
  footerText,
  headerRows,
  NO_REPORTS,
  type Cell,
  type NumFmt,
  type SectionTable,
} from '@/lib/reports/cost-sections';
import type { CostReportModel } from '@/lib/reports/types';

// 工事原価集計表の Excel（数式なしの xlsx）。1 シートに見出しと ①〜⑦ を縦に並べる。
// 見出しは太字、金額は #,##0、比率は 0.0%（値は 0..1）、人工・歩掛は 0.0。列幅は固定、A4 縦で横 1 ページに収める。

export const NAVY = 'FF1F3A5F';
const RULE = 'FFC9D1DC';
export const BAND = 'FFEEF2F7';
const TOTAL_BAND = 'FFF6F8FB';

/** A 列（名前）・B 列（2 列目の文字）・C〜K 列（数値）。③ が 11 列で最も広い。 */
const COLUMN_WIDTHS = [26, 16, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5];
const LAST_COL = 'K';

const NUM_FMT: Record<NumFmt, string | undefined> = {
  yen: '#,##0',
  int: '#,##0',
  dec1: '0.0',
  qty: undefined, // 標準（小数があるときだけ出る）
  pct: '0.0%',
};

const thin = { style: 'thin', color: { argb: RULE } } as const;
export const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
export const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

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

/** 表（太字の列見出し・罫線・数値の書式・太字の合計行）を 1 列目から書く（変更増減 精算資料でも使う）。 */
export function writeTable(ws: ExcelJS.Worksheet, t: SectionTable): void {
  const head = ws.addRow(t.columns.map((c) => c.label));
  t.columns.forEach((col, i) => {
    const cell = head.getCell(i + 1);
    cell.font = { bold: true };
    cell.fill = fill(BAND);
    cell.border = box;
    cell.alignment = { horizontal: col.num ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  const body = (cells: Cell[]) => {
    const row = ws.addRow([]);
    cells.forEach((c, i) => writeCell(row.getCell(i + 1), c, t.columns[i].num));
    return row;
  };
  for (const r of t.rows) body(r);
  if (t.total) {
    const row = body(t.total);
    row.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = fill(TOTAL_BAND);
      cell.border = { ...box, top: { style: 'medium', color: { argb: NAVY } } };
    });
  }
}

export async function buildCostXlsx(model: CostReportModel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報アプリ';
  const ws = wb.addWorksheet(COST_REPORT_TITLE, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.59, right: 0.59, top: 0.59, bottom: 0.79, header: 0.3, footer: 0.3 },
    },
  });
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const title = ws.addRow([COST_REPORT_TITLE]);
  title.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  title.height = 22;

  for (const [label, value] of headerRows(model)) {
    const row = ws.addRow([label, value ?? '—']);
    const k = row.getCell(1);
    k.font = { bold: true };
    k.fill = fill(BAND);
    k.border = box;
  }

  const sections = costSections(model);
  if (sections.length === 0) {
    ws.addRow([]);
    ws.addRow([NO_REPORTS]);
  }
  for (const s of sections) {
    ws.addRow([]);
    const head = ws.addRow(s.note ? [s.title, s.note] : [s.title]);
    head.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
    if (s.note) head.getCell(2).font = { size: 9, color: { argb: 'FF555555' } };
    for (const t of s.tables) writeTable(ws, t);
  }

  if (sections.length > 0) {
    // 署名欄（作成者 = 出力した人、確認者・承認者は空欄）。右端の 3 列。
    ws.addRow([]);
    const sig = model.signature;
    const labels = ws.addRow([]);
    const names = ws.addRow([]);
    names.height = 36;
    (['作成者', '確認者', '承認者'] as const).forEach((label, i) => {
      const col = COLUMN_WIDTHS.length - 2 + i;
      const l = labels.getCell(col);
      l.value = label;
      l.font = { bold: true };
      l.fill = fill(BAND);
      l.border = box;
      l.alignment = { horizontal: 'center' };
      const n = names.getCell(col);
      n.value = i === 0 ? sig.createdBy : '';
      n.border = box;
      n.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
  }

  ws.pageSetup.printArea = `A1:${LAST_COL}${ws.rowCount}`;
  ws.headerFooter.oddFooter = `&L&8${footerText(model).replaceAll('&', '&&')}&R&8ページ &P / &N`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
