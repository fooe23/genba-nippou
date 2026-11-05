import ExcelJS from 'exceljs';
import {
  CHANGE_SHEET_NAME,
  CHANGE_SUBJECT,
  changeDetail,
  changeFooterText,
  changeInfoRows,
  changeIssues,
  changeIssuesNote,
  changeSummary,
  CLIENT_CHECK_BOXES,
  ISSUES_TITLE,
  NO_CHANGES,
  senderRows,
  type ChangeReportMeta,
} from '@/lib/reports/change-sections';
import { BAND, box, fill, NAVY, writeTable } from '@/lib/reports/cost-xlsx';
import type { ChangeLedgerModel } from '@/lib/reports/types';

// 変更増減 社内確認用の Excel（数式なしの xlsx）。1 シートに件名・見出し（宛先は出さない）、サマリー表と率・注記、件ごとの精算、
// 明細一覧（15 列を 1 行に。根拠の件ごとに見出しと小計）、末尾（発行者・客先確認欄）を縦に並べる。金額は #,##0、率は 0.0%。列幅は固定、A4 縦で横 1 ページに
// 収める。客先用（精算のご提案）は client-change-xlsx.ts（欄の見出し・ラベル行・末尾の書き方はここから使う）。

/** 明細の 15 列（A 列は見出し・サマリーの項目名・件ごとの精算の件も兼ねる。B〜I 列は件ごとの精算の見込み額〜精算額にも使う）。 */
const COLUMN_WIDTHS = [26, 9, 11, 24, 10, 6, 10, 12, 16, 12, 12, 8, 11, 36, 8];
const LAST_COL = 'O';

/** 欄の見出し（A 列、濃紺の太字）。note は B 列に小さく（集計の範囲など）。 */
export function section(ws: ExcelJS.Worksheet, title: string, note?: string): void {
  ws.addRow([]);
  const row = ws.addRow(note ? [title, note] : [title]);
  row.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
  if (note) row.getCell(2).font = { size: 9, color: { argb: 'FF555555' } };
}

/** ラベル（太字・帯）と値の 2 列。 */
export function labelRow(ws: ExcelJS.Worksheet, label: string, value: ExcelJS.CellValue): ExcelJS.Row {
  const row = ws.addRow([label, value]);
  const k = row.getCell(1);
  k.font = { bold: true };
  k.fill = fill(BAND);
  k.border = box;
  return row;
}

/**
 * 末尾：発行者（会社名・担当者・連絡先）と確認欄（見出しは checkTitle。確認者・確認日・サイン。どれも空欄）。
 * 枠は A 列・B:C 列（結合）・D 列。
 */
export function writeTail(ws: ExcelJS.Worksheet, meta: ChangeReportMeta, checkTitle: string): void {
  section(ws, '発行者');
  for (const [label, value] of senderRows(meta)) labelRow(ws, label, value).getCell(2).border = box;

  section(ws, checkTitle);
  const labels = ws.addRow([]);
  const blanks = ws.addRow([]);
  blanks.height = 36;
  const at = [1, 2, 4];
  CLIENT_CHECK_BOXES.forEach((label, i) => {
    const l = labels.getCell(at[i]);
    l.value = label;
    l.font = { bold: true };
    l.fill = fill(BAND);
    l.border = box;
    l.alignment = { horizontal: 'center' };
    blanks.getCell(at[i]).border = box;
  });
  for (const row of [labels, blanks]) {
    ws.mergeCells(row.number, 2, row.number, 3);
    row.getCell(2).border = box;
  }
}

export async function buildChangeXlsx(model: ChangeLedgerModel, meta: ChangeReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報アプリ';
  const ws = wb.addWorksheet(CHANGE_SHEET_NAME, {
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

  const subject = ws.addRow([CHANGE_SUBJECT]);
  subject.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  subject.height = 22;
  ws.addRow([]);
  for (const [label, value] of changeInfoRows(model, meta)) labelRow(ws, label, value ?? '—');

  if (model.isEmpty) {
    ws.addRow([]);
    ws.addRow([NO_CHANGES]);
  } else {
    const { table, notes } = changeSummary(model);
    section(ws, '精算のサマリー');
    writeTable(ws, table);
    ws.addRow([]);
    for (const [label, rate] of [
      ['経費率', model.rates.overheadRate],
      ['利益率', model.rates.profitRate],
    ] as const) {
      const c = labelRow(ws, label, rate).getCell(2);
      c.numFmt = '0.0%';
      c.border = box;
    }
    for (const note of notes) ws.addRow([`※ ${note}`]).getCell(1).font = { size: 9, color: { argb: 'FF555555' } };

    const issues = changeIssues(model);
    if (issues) {
      section(ws, ISSUES_TITLE, changeIssuesNote(model));
      writeTable(ws, issues);
    }

    section(ws, '明細一覧');
    writeTable(ws, changeDetail(model));

    writeTail(ws, meta, '客先確認欄');
  }

  ws.pageSetup.printArea = `A1:${LAST_COL}${ws.rowCount}`;
  ws.headerFooter.oddFooter = `&L&8${changeFooterText(meta).replaceAll('&', '&&')}&R&8ページ &P / &N`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
