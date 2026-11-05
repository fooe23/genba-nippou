import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildClientChangeXlsx } from '@/lib/reports/client-change-xlsx';
import { changeMeta, emptyChangeModel, settledChangeModel } from './cost-fixture';

async function read(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(['精算のご提案']);
  return wb.worksheets[0];
}

function rowOf(ws: ExcelJS.Worksheet, text: string): ExcelJS.Row {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === text) return ws.getRow(r);
  throw new Error(`${text} の行がありません`);
}

function allValues(ws: ExcelJS.Worksheet): string[] {
  const cells: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
  return cells;
}

describe('buildClientChangeXlsx', () => {
  it('題名・宛先・見出し、まとめ（#,##0・見積中の注記）、件ごとの内容、作業の明細、発行者・お客様確認欄', async () => {
    const ws = await read(await buildClientChangeXlsx(settledChangeModel(), changeMeta()));
    expect(ws.getCell('A1').value).toBe('追加・変更工事 精算のご提案（案）');
    expect(ws.getCell('A2').value).toBe('〇〇様');
    expect(rowOf(ws, '現場名').getCell(2).value).toBe('〇〇邸新築工事');

    expect(rowOf(ws, '項目').getCell(3).value).toBe('金額(円)');
    const extra = rowOf(ws, '追加');
    expect(extra.getCell(2).value).toBe(1);
    expect(extra.getCell(3).value).toBe(113236);
    expect(extra.getCell(3).numFmt).toBe('#,##0');
    expect(rowOf(ws, '減').getCell(3).value).toBe(-20000);
    expect(rowOf(ws, '精算提案額').getCell(3).value).toBe(1108236);
    rowOf(ws, '※ 見積中の件（1 件）は金額に含めていません。確定しだい改めてご提示します。');

    const pending = rowOf(ws, '11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。');
    expect(pending.getCell(3).value).toBe('見積中');
    expect(pending.getCell(4).value).toBe('—');
    expect(rowOf(ws, '11/05-3 減 外壁塗装の一部取りやめ').getCell(4).value).toBe(-20000);

    const head = rowOf(ws, '日付');
    expect(head.getCell(11).value).toBe('確認');
    // 作業の明細は件ごと：見出し（件ごとの内容と同じ名前）→ 行 → 小計（A〜人工の列）
    expect(ws.getRow(head.number + 1).getCell(1).value).toBe('11/02-1 追加指示 施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。');
    expect(ws.getRow(head.number + 3).getCell(1).value).toBe('小計 1 日・1.5 人工');
    // 客先用には所属別の人工（社内用）を出さない
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.value))));
    expect(texts.some((t) => t.includes('所属') || t.includes('自社') || t.includes('協力会社'))).toBe(false);
    const minus = ws.getRow(head.number + 8);
    expect(minus.getCell(4).value).toBe('外壁塗装の一部取りやめ');
    expect(minus.getCell(5).value).toBe(-10);
    expect(rowOf(ws, '根拠の件なし').number).toBeGreaterThan(minus.number);

    expect(rowOf(ws, '会社名').getCell(2).value).toBe('株式会社オオホリ建託');
    const check = rowOf(ws, 'お客様確認欄');
    expect([1, 2, 4].map((c) => ws.getRow(check.number + 1).getCell(c).value)).toEqual(['確認者', '確認日', 'サイン']);

    const values = allValues(ws);
    for (const word of ['実績原価', '見込み額', '提案額(円)', '経費率', '申告額', '単価(円)', 'やり直し']) {
      expect(values.filter((v) => v.includes(word))).toEqual([]);
    }
    expect(ws.pageSetup.paperSize).toBe(9);
    expect(ws.pageSetup.fitToWidth).toBe(1);
  });

  it('月：「金額（累計）(円)」と累計の注記', async () => {
    const ws = await read(await buildClientChangeXlsx(settledChangeModel({ kind: 'month', month: '2026-11' }), changeMeta()));
    expect(rowOf(ws, '項目').getCell(3).value).toBe('金額（累計）(円)');
    rowOf(ws, '※ 件数・金額は月末までの累計です。');
  });

  it('変更行 0 件：見出しと「追加・増・変更・減の記録はありません」だけ', async () => {
    const ws = await read(await buildClientChangeXlsx(emptyChangeModel(), changeMeta()));
    rowOf(ws, '追加・増・変更・減の記録はありません');
    expect(() => rowOf(ws, '精算提案額')).toThrow();
    expect(() => rowOf(ws, '日付')).toThrow();
  });
});
