import ExcelJS from 'exceljs';
import { clientSettlement } from '@/lib/reports/change-model';
import { addressee, NO_CHANGES, type ChangeReportMeta } from '@/lib/reports/change-sections';
import { labelRow, section, writeTail } from '@/lib/reports/change-xlsx';
import {
  CLIENT_CHANGE_SHEET_NAME,
  CLIENT_CHANGE_TITLE,
  CLIENT_CHECK_TITLE,
  CLIENT_DETAIL_TITLE,
  CLIENT_ISSUES_TITLE,
  CLIENT_SUMMARY_TITLE,
  clientChangeDetail,
  clientChangeFooterText,
  clientChangeInfoRows,
  clientChangeIssues,
  clientChangeSummary,
  clientNotes,
} from '@/lib/reports/client-change-sections';
import { NAVY, writeTable } from '@/lib/reports/cost-xlsx';
import type { ChangeLedgerModel } from '@/lib/reports/types';

// 客先に渡す「追加・変更工事 精算のご提案（案）」の Excel（数式なしの xlsx。中身は客先用 PDF と同じ）。1 シートに題名・宛先・
// 見出し、精算のまとめと注記、件ごとの内容、作業の明細（11 列を 1 行に）、末尾（発行者・お客様確認欄）を縦に並べる。
// 金額は #,##0。列幅は固定、A4 縦で横 1 ページに収める。原価・見込み額・提案額・率・単価・申告額は出さない。

/** 明細の 11 列（A 列は見出し・まとめの項目・件ごとの内容の件も兼ねる。文字は折り返す）。 */
const COLUMN_WIDTHS = [26, 20, 18, 28, 9, 6, 7, 16, 8, 10, 7];
const LAST_COL = 'K';

export async function buildClientChangeXlsx(model: ChangeLedgerModel, meta: ChangeReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報アプリ';
  const ws = wb.addWorksheet(CLIENT_CHANGE_SHEET_NAME, {
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

  const title = ws.addRow([CLIENT_CHANGE_TITLE]);
  title.getCell(1).font = { bold: true, size: 14, color: { argb: NAVY } };
  title.height = 22;
  ws.addRow([addressee(meta.site)]).getCell(1).font = { bold: true, size: 12 };
  ws.addRow([]);
  for (const [label, value] of clientChangeInfoRows(model, meta)) labelRow(ws, label, value ?? '—');

  if (model.isEmpty) {
    ws.addRow([]);
    ws.addRow([NO_CHANGES]);
  } else {
    const cs = clientSettlement(model);
    section(ws, CLIENT_SUMMARY_TITLE);
    writeTable(ws, clientChangeSummary(model, cs));
    for (const note of clientNotes(model, cs)) ws.addRow([`※ ${note}`]).getCell(1).font = { size: 9, color: { argb: 'FF555555' } };

    const issues = clientChangeIssues(model, cs);
    if (issues) {
      section(ws, CLIENT_ISSUES_TITLE);
      writeTable(ws, issues);
    }

    const detail = clientChangeDetail(model);
    if (detail.rows.length > 0) {
      section(ws, CLIENT_DETAIL_TITLE);
      writeTable(ws, detail);
    }

    writeTail(ws, meta, CLIENT_CHECK_TITLE);
  }

  ws.pageSetup.printArea = `A1:${LAST_COL}${ws.rowCount}`;
  ws.headerFooter.oddFooter = `&L&8${clientChangeFooterText(meta).replaceAll('&', '&&')}&R&8ページ &P / &N`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
