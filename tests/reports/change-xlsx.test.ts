import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildChangeXlsx } from '@/lib/reports/change-xlsx';
import { changeMeta, emptyChangeModel, sampleChangeModel, settledChangeModel } from './cost-fixture';

async function read(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['変更増減精算資料']);
  return wb.worksheets[0];
}

/** A 列が text の行。 */
function rowOf(ws: ExcelJS.Worksheet, text: string): ExcelJS.Row {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === text) return ws.getRow(r);
  throw new Error(`${text} の行がありません`);
}

describe('buildChangeXlsx', () => {
  it('件名・宛先・見出し、サマリー（#,##0）、率（0.0%）、明細（太字の列見出し）、末尾', async () => {
    const ws = await read(await buildChangeXlsx(sampleChangeModel(), changeMeta()));
    expect(ws.getCell('A1').value).toBe('追加・変更工事 精算のご提案（案）');
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.getCell('A2').value).toBe('〇〇様 御中');
    expect(rowOf(ws, '現場名').getCell(2).value).toBe('〇〇邸新築工事');

    const extra = rowOf(ws, '追加');
    expect(extra.getCell(2).value).toBe(1);
    expect(extra.getCell(3).value).toBe(36000);
    expect(extra.getCell(4).value).toBe(40756);
    expect(extra.getCell(4).numFmt).toBe('#,##0');
    expect(extra.getCell(5).value).toBe(40756);
    expect(rowOf(ws, '減').getCell(4).value).toBe(-25000);
    const total = rowOf(ws, '精算提案額');
    expect(total.getCell(5).value).toBe(1029342);
    expect(total.getCell(1).font?.bold).toBe(true);

    const overhead = rowOf(ws, '経費率');
    expect(overhead.getCell(2).value).toBe(0.15);
    expect(overhead.getCell(2).numFmt).toBe('0.0%');

    const head = rowOf(ws, '日付（当月N回目）');
    expect(head.getCell(15).value).toBe('客先確認');
    expect(head.getCell(1).font?.bold).toBe(true);
    const first = ws.getRow(head.number + 1);
    expect(first.getCell(1).value).toBe('2026/11/05\n当月1回目');
    expect(first.getCell(8).numFmt).toBe('#,##0');
    const minus = ws.getRow(head.number + 3);
    expect(minus.getCell(5).value).toBe(-10);
    expect(minus.getCell(10).value).toBe(-25000);

    expect(rowOf(ws, '会社名').getCell(2).value).toBe('株式会社オオホリ建託');
    const check = rowOf(ws, '客先確認欄');
    expect([1, 2, 4].map((c) => ws.getRow(check.number + 1).getCell(c).value)).toEqual(['確認者', '確認日', 'サイン']);
  });

  it('列幅は固定、A4 縦で横 1 ページに収める', async () => {
    const ws = await read(await buildChangeXlsx(sampleChangeModel(), changeMeta()));
    expect(ws.getColumn(1).width).toBeGreaterThan(0);
    expect(ws.getColumn(15).width).toBeGreaterThan(0);
    // 件ごとの精算の精算額（I 列。「（参考）¥8,000」）と確定額・単価（D 列。「常用 0.5人工 × ¥30,000」）は 1 行に収まる幅
    expect(ws.getColumn(9).width).toBe(16);
    expect(ws.getColumn(4).width).toBe(24);
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.orientation).toBe('portrait');
    expect(ws.pageSetup.fitToWidth).toBe(1);
  });

  it('変更行 0 件：見出しと「追加・増・変更・減の記録はありません」だけ', async () => {
    const ws = await read(await buildChangeXlsx(emptyChangeModel(), changeMeta({ site: { ...changeMeta().site, clientName: null } })));
    expect(ws.getCell('A2').value).toBe('（客先名未設定）');
    rowOf(ws, '追加・増・変更・減の記録はありません');
    expect(() => rowOf(ws, '精算提案額')).toThrow();
    expect(() => rowOf(ws, '日付（当月N回目）')).toThrow();
  });

  it('件ごとの精算：サマリーと明細の間に表（やり直しは参考、件なしの行、合計）。実績原価の見出しはどこにも無い', async () => {
    const ws = await read(await buildChangeXlsx(settledChangeModel(), changeMeta()));
    const title = rowOf(ws, '件ごとの精算');
    expect(title.number).toBeGreaterThan(rowOf(ws, '精算提案額').number);
    expect(title.number).toBeLessThan(rowOf(ws, '明細一覧').number);
    const head = ws.getRow(title.number + 1);
    expect(head.getCell(1).value).toBe('件');
    expect(head.getCell(9).value).toBe('精算額(円)');
    expect(ws.getRow(title.number + 2).getCell(9).value).toBe(39706);
    const lump = rowOf(ws, '11/05-1 追加指示 玄関収納の追加');
    expect(lump.getCell(4).value).toBe(100000);
    expect(lump.getCell(5).value).toBe('2026/11/08');
    expect(rowOf(ws, '11/05-4 やり直し 巾木の手直し').getCell(9).value).toBe('（参考）¥8,000');
    expect(rowOf(ws, '11/05-3 減 外壁塗装の一部取りやめ').getCell(9).value).toBe(-20000);
    expect(rowOf(ws, '件なし（根拠の件を選んでいない行）').getCell(9).value).toBe(13236);
    const total = rowOf(ws, '合計');
    expect(total.getCell(9).value).toBe(147942);

    expect(rowOf(ws, '追加').getCell(5).value).toBe(152942);
    const cells: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
    expect(cells.filter((v) => v.includes('実績原価(円)'))).toEqual([]);
  });

  it('月：サマリーの精算額の列は「精算額（累計）(円)」', async () => {
    const ws = await read(await buildChangeXlsx(settledChangeModel({ kind: 'month', month: '2026-11' }), changeMeta()));
    expect(rowOf(ws, '項目').getCell(5).value).toBe('精算額（累計）(円)');
  });
});
