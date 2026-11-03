import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildCostXlsx } from '@/lib/reports/cost-xlsx';
import { emptyModel, sampleModel } from './cost-fixture';

async function read(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['工事原価集計表']);
  return wb.worksheets[0];
}

/** A 列が text の行。 */
function rowOf(ws: ExcelJS.Worksheet, text: string): ExcelJS.Row {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === text) return ws.getRow(r);
  throw new Error(`${text} の行がありません`);
}

describe('buildCostXlsx', () => {
  it('1 シートに見出しとセクションを縦に並べ、見出しは太字・金額は #,##0・比率は 0.0%・人工は 0.0', async () => {
    const ws = await read(await buildCostXlsx(sampleModel()));
    expect(ws.getCell('A1').value).toBe('工事原価集計表');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(rowOf(ws, '現場名').getCell(2).value).toBe('〇〇邸新築工事');

    expect(rowOf(ws, '① 原価合計').getCell(1).font?.bold).toBe(true);
    const labor = rowOf(ws, '労務費');
    expect(labor.getCell(2).value).toBe(66000);
    expect(labor.getCell(2).numFmt).toBe('#,##0');
    expect(labor.getCell(3).numFmt).toBe('0.0%');
    expect(labor.getCell(3).value).toBeCloseTo(66000 / 105828, 6);
    const total = rowOf(ws, '原価合計');
    expect(total.getCell(1).font?.bold).toBe(true);

    expect(rowOf(ws, '総人工').getCell(2).numFmt).toBe('0.0');
    expect(rowOf(ws, '飛び込み 鈴木（手入力）').getCell(6).value).toBe(30000);
    for (const name of ['② 採算', '③ 月別推移', '④ 作業員別累計', '⑤ 取引先別累計', '⑥ 車両・リース', '⑦ 工種別出来高']) rowOf(ws, name);
  });

  it('列幅は固定、A4 縦で横 1 ページに収める', async () => {
    const ws = await read(await buildCostXlsx(sampleModel()));
    expect(ws.getColumn(1).width).toBeGreaterThan(0);
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.pageSetup.fitToWidth).toBe(1);
  });

  it('日報 0 件：見出しと「日報がありません」だけ', async () => {
    const ws = await read(await buildCostXlsx(emptyModel()));
    rowOf(ws, '日報がありません');
    expect(() => rowOf(ws, '① 原価合計')).toThrow();
  });
});
