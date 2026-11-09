import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildBudgetModel } from '@/lib/budget/budget-model';
import { parseBudgetWorkbook } from '@/lib/budget/parse-template';
import { budgetReportFileName, buildBudgetReportXlsx, REPORT_SHEET_NAMES } from '@/lib/budget/report-xlsx';
import { budgetSummaryTable, statusText } from '@/lib/budget/report-sections';
import { neutralizeFormula } from '@/lib/reports/csv';
import { SP_NONE, SP_PAINT, SP_TWO, nakanoData, nakanoInput, own } from './fixture-nakano';

const partners = [
  { id: SP_PAINT, name: '〇〇塗装' },
  { id: SP_TWO, name: '△△工業' },
  { id: SP_NONE, name: '□□建設' },
];
const meta = { siteName: '中野橋', projectNo: '0612', outputAt: '2026-10-10T03:00:00Z' };

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  return wb;
}

/** シートの全セルの値（文字）を行ごとに。 */
function rowsOf(ws: ExcelJS.Worksheet): unknown[][] {
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const vals = row.values as unknown[];
    out.push(vals.slice(1));
  });
  return out;
}

describe('予算と実績の集計 Excel', () => {
  it('シート名と順（7 枚＋隠した選択肢）', async () => {
    const wb = await load(await buildBudgetReportXlsx(nakanoInput(), meta, partners));
    expect(wb.worksheets.map((w) => w.name)).toEqual([...REPORT_SHEET_NAMES, '選択肢']);
    expect(REPORT_SHEET_NAMES).toEqual(['予算と実績', '工種×施工者', '日々の実績', '月別の推移', '出面', '元請けの内訳と数量', '実行予算']);
    expect(wb.getWorksheet('選択肢')!.state).toBe('hidden');
    expect(wb.worksheets.filter((w) => w.state !== 'hidden')).toHaveLength(7);
  });

  it('① の工種の行が画面のモデルと一致する', async () => {
    const input = nakanoInput();
    const model = buildBudgetModel(input);
    const ws = (await load(await buildBudgetReportXlsx(input, meta, partners))).getWorksheet('予算と実績')!;
    const rows = rowsOf(ws);
    const head = rows.findIndex((r) => r[0] === '工種');
    expect(head).toBeGreaterThan(0);
    model.trades.forEach((t, i) => {
      const r = rows[head + 1 + i];
      expect(r[0]).toBe(t.name);
      expect(r[1]).toBe(t.contractAmount);
      expect(r[2]).toBe(t.budget.amount);
      expect(r[4]).toBe(t.actual.amount);
      expect(r[8]).toBe(t.forecast ?? '—');
      expect(r[9]).toBe(t.forecastProfit ?? '—');
      expect(r[10]).toBe(statusText(t));
    });
    const total = rows.find((r) => r[0] === '合計')!;
    expect(total[1]).toBe(model.total.contractAmount);
    expect(total[2]).toBe(model.total.budgetAmount);
    expect(total[4]).toBe(model.total.actualAmount);
    // 表の行数は sections と同じ（工種＋予算外＋現場全体）
    expect(budgetSummaryTable(model).rows).toHaveLength(model.trades.length + 2);
  });

  it('⑦ を取り込むと同じ予算（内訳は変えない）', async () => {
    // 工種の無い労務の行（予算外の予算）も、工種を空欄にして書き出し・取り込みで戻る
    const base = nakanoData();
    expect(base.budgetLines.some((l) => l.tradeId === null && l.item === 'labor')).toBe(true);
    const input = nakanoInput({ data: base });
    const buf = await buildBudgetReportXlsx(input, meta, partners);
    const parsed = parseBudgetWorkbook(new Uint8Array(buf), { partners, dailyRate: input.dailyRate });
    expect(parsed.errors).toEqual([]);
    expect(parsed.hasBudgetSheet).toBe(true);
    expect(parsed.hasContractSheet).toBe(false);
    expect(parsed.contractItems).toEqual([]);
    const data = base;
    expect(parsed.trades).toEqual(data.trades.map((t) => t.name));
    const names = new Map(data.trades.map((t) => [t.id, t.name]));
    expect(
      parsed.budgetLines.map((l) => [l.tradeName, l.performer, l.supplierId, l.item, l.note, l.qty, l.unit, l.unitPrice]),
    ).toEqual(
      [...data.budgetLines]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((l) => [l.tradeId ? names.get(l.tradeId) : null, l.performer, l.supplierId, l.item, l.note, l.qty, l.unit, l.unitPrice]),
    );
  });

  it('数式の注入対策：①〜⑥ の = + - @ で始まる文字に \' を付ける（⑦ はそのまま）', async () => {
    const data = nakanoData();
    data.trades[0] = { ...data.trades[0], name: '=HYPERLINK("x")' };
    const input = nakanoInput({ data });
    input.reports.push({ date: '2026-10-05', lines: [own('@SUM(A1)')] });
    const wb = await load(await buildBudgetReportXlsx(input, meta, partners));
    const all = (name: string) => rowsOf(wb.getWorksheet(name)!).flat();
    expect(all('予算と実績')).toContain(`'=HYPERLINK("x")`);
    expect(all('工種×施工者')).toContain(`'=HYPERLINK("x")`);
    expect(all('出面')).toContain("'@SUM(A1)");
    for (const name of REPORT_SHEET_NAMES.slice(0, 6)) {
      for (const v of all(name)) if (typeof v === 'string') expect(/^[=+\-@]/.test(v) && !Number.isFinite(Number(v)), `${name}: ${v}`).toBe(false);
    }
    expect(all('実行予算')).toContain('=HYPERLINK("x")');
    expect(neutralizeFormula('-5')).toBe('-5');
    expect(neutralizeFormula('+81 3')).toBe("'+81 3");
  });

  it('③ 日々の実績・⑤ 出面・④ 月別の推移の中身', async () => {
    const input = nakanoInput();
    const model = buildBudgetModel(input);
    const wb = await load(await buildBudgetReportXlsx(input, meta, partners));
    const daily = rowsOf(wb.getWorksheet('日々の実績')!);
    const subtotals = daily.filter((r) => r[0] === '小計');
    expect(subtotals).toHaveLength(model.trades.length + 1);
    const laborSum = subtotals.reduce((s, r) => s + Number(r[9]), 0);
    expect(laborSum).toBe(model.trades.reduce((s, t) => s + t.actual.amount, 0) + model.outside.amount);

    const att = rowsOf(wb.getWorksheet('出面')!);
    const head = att.find((r) => r[0] === '所属')!;
    expect(head.slice(3)).toEqual(['10/01', '10/02', '10/03', '10/04']); // 10/20 は asOf より後
    expect(att.find((r) => r[1] === '〇〇 1')?.[0]).toBe('〇〇塗装');

    const monthly = rowsOf(wb.getWorksheet('月別の推移')!);
    const oct = monthly.find((r) => r[0] === '2026年10月')!;
    expect(oct[2]).toBe(model.trades.reduce((s, t) => s + t.actual.amount, 0) + model.outside.amount);
    expect(oct[3]).toBe(3000);
  });

  it('ファイル名', () => {
    expect(budgetReportFileName('中野橋 / 塗装', '2026-11-10')).toBe('中野橋 _ 塗装_予算と実績_20261110.xlsx');
  });
});
