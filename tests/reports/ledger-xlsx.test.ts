import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildLedgerAttendance } from '@/lib/reports/ledger-attendance';
import { buildLedgerXlsx, LEDGER_SHEET_NAMES } from '@/lib/reports/ledger-xlsx';
import { ledgerFileName } from '@/lib/reports/query';
import { emptyModel } from './cost-fixture';
import { ledgerInput, ledgerModel, ledgerReport, ownLabor } from './ledger-fixture';

const ALL = { kind: 'all' } as const;

async function build(input = ledgerInput(), period: { kind: 'all' } | { kind: 'month'; month: string } = ALL): Promise<ExcelJS.Workbook> {
  const buf = await buildLedgerXlsx(ledgerModel(period, input), buildLedgerAttendance(input, period));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** A 列（または col 列）が text の最初の行（after より後）。 */
function rowOf(ws: ExcelJS.Worksheet, text: string, after = 0, col = 1): ExcelJS.Row {
  for (let r = after + 1; r <= ws.rowCount; r++) if (ws.getCell(r, col).value === text) return ws.getRow(r);
  throw new Error(`${text} の行がありません`);
}

// 書くときは result 0 も <v>0</v> で入るが、exceljs は読み直すと 0 の result を落とす（undefined）ので 0 として扱う。
type Formula = { formula: string; result: number };
const isFormula = (v: unknown): v is Formula => typeof v === 'object' && v !== null && 'formula' in v;

/** 'D5:D7' の範囲の数値の和（文字・空は 0）。 */
function sumRange(ws: ExcelJS.Worksheet, range: string): number {
  const [a, b] = range.split(':');
  const from = ws.getCell(a);
  const to = ws.getCell(b);
  let s = 0;
  for (let r = Number(from.row); r <= Number(to.row); r++) {
    for (let c = Number(from.col); c <= Number(to.col); c++) {
      const v = ws.getCell(r, c).value;
      if (typeof v === 'number') s += v;
      else if (isFormula(v)) s += v.result ?? 0;
    }
  }
  return s;
}

function formulas(ws: ExcelJS.Worksheet): { cell: ExcelJS.Cell; f: Formula }[] {
  const out: { cell: ExcelJS.Cell; f: Formula }[] = [];
  ws.eachRow((row) => row.eachCell((cell) => isFormula(cell.value) && out.push({ cell, f: cell.value })));
  return out;
}

describe('buildLedgerXlsx', () => {
  it('シートは 現場原価集計・出面一覧 の 2 枚', async () => {
    const wb = await build();
    expect(wb.worksheets.map((w) => w.name)).toEqual([...LEDGER_SHEET_NAMES]);
    expect(LEDGER_SHEET_NAMES).toEqual(['現場原価集計', '出面一覧']);
  });

  it('現場原価集計：原価合計は SUM の式（範囲は ① の最初〜最後のデータの行）で 215,000、⑦ に外注の行、② の総人工・累計出来高', async () => {
    const ws = (await build()).getWorksheet('現場原価集計')!;
    expect(ws.getCell('A1').value).toBe('現場原価集計　〇〇様邸');
    const total = rowOf(ws, '原価合計').getCell(2).value as Formula;
    const first = rowOf(ws, '労務費').number;
    const last = rowOf(ws, '買掛費').number;
    expect(total).toEqual({ formula: `SUM(B${first}:B${last})`, result: 215000 });
    // 構成比は値のまま
    expect(typeof rowOf(ws, '原価合計').getCell(3).value).toBe('number');

    const tile = rowOf(ws, 'タイル（外注・〇〇工務店）');
    expect(tile.getCell(7).value).toBe(170000);
    const seventh = rowOf(ws, '⑦ 工種別出来高', 0, 1).number;
    const t7 = rowOf(ws, '合計', seventh).getCell(7).value as Formula;
    expect(t7.result).toBe(215000);
    expect(t7.formula).toMatch(/^SUM\(G\d+:G\d+\)$/);

    expect(rowOf(ws, '総人工').getCell(2).value).toBe(2);
    expect(rowOf(ws, '累計出来高(円)').getCell(2).value).toBe(215000);
  });

  it('〇〇様邸：工事原価集計表（buildCostReport）と台帳の両シートで 原価 215,000・外注 170,000・出来高 215,000・総人工 2.0（うち請負 1.0）', async () => {
    const m = ledgerModel();
    expect([m.costs.total, m.affiliations.total.subcontractPaid, m.trades.total.output, m.profit.totalManDays, m.affiliations.total.ukeoiManDays]).toEqual([
      215000, 170000, 215000, 2, 1,
    ]);
    const wb = await build();
    const cost = wb.getWorksheet('現場原価集計')!;
    const aff = rowOf(cost, '④-2 所属別の人工・労務費').number;
    const affTotal = rowOf(cost, '合計', aff);
    expect((affTotal.getCell(6).value as Formula).result).toBe(170000);
    expect((affTotal.getCell(4).value as Formula).result).toBe(1);
    expect((affTotal.getCell(5).value as Formula).result).toBe(2);
    const att = wb.getWorksheet('出面一覧')!;
    const head = rowOf(att, '作業員');
    let totalCol = 0;
    for (let c = 1; c <= head.cellCount; c++) if (head.getCell(c).value === '人工計') totalCol = c;
    expect((rowOf(att, '日ごとの合計').getCell(totalCol).value as Formula).result).toBe(2);
    expect((rowOf(att, 'うち請負').getCell(totalCol).value as Formula).result).toBe(1);
  });

  it('すべての SUM・SUMIF・COUNT の式：範囲の値から計算した値 ＝ 入れておいた result', async () => {
    for (const period of [ALL, { kind: 'month', month: '2026-11' } as const]) {
      const wb = await build(undefined, period);
      let n = 0;
      for (const ws of wb.worksheets) {
        for (const { cell, f: raw } of formulas(ws)) {
          n++;
          const f = { ...raw, result: raw.result ?? 0 };
          const sum = /^SUM\(([A-Z]+\d+:[A-Z]+\d+)\)$/.exec(f.formula);
          const count = /^COUNT\(([A-Z]+\d+:[A-Z]+\d+)\)$/.exec(f.formula);
          const sumif = /^SUMIF\(\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+),"請負",([A-Z]+\d+:[A-Z]+\d+)\)$/.exec(f.formula);
          if (sum) expect(sumRange(ws, sum[1]), `${ws.name}!${cell.address}`).toBeCloseTo(f.result, 6);
          else if (count) {
            const [a, b] = count[1].split(':');
            let c = 0;
            for (let col = Number(ws.getCell(a).col); col <= Number(ws.getCell(b).col); col++) if (typeof ws.getCell(Number(ws.getCell(a).row), col).value === 'number') c++;
            expect(c, `${ws.name}!${cell.address}`).toBe(f.result);
          } else if (sumif) {
            const [, kc, kr1, , kr2, range] = sumif;
            const valueCol = Number(ws.getCell(range.split(':')[0]).col);
            let s = 0;
            for (let r = Number(kr1); r <= Number(kr2); r++) {
              if (ws.getCell(`${kc}${r}`).value === '請負') {
                const v = ws.getCell(r, valueCol).value;
                s += typeof v === 'number' ? v : isFormula(v) ? (v.result ?? 0) : 0;
              }
            }
            expect(s, `${ws.name}!${cell.address}`).toBeCloseTo(f.result, 6);
          } else throw new Error(`知らない式 ${f.formula}`);
        }
      }
      expect(n).toBeGreaterThan(20);
    }
  });

  it('出面一覧：Ｓさん（自社）・〇〇工務店（名前なし）（請負）、11/10 の日ごとの合計 2.0・うち請負 1.0、人工計の合計 2.0', async () => {
    const ws = (await build()).getWorksheet('出面一覧')!;
    expect(ws.getCell('A1').value).toBe('出面一覧　〇〇様邸　2026年11月');
    const head = rowOf(ws, '作業員');
    const col = (label: string) => {
      for (let c = 1; c <= head.cellCount; c++) if (String(head.getCell(c).value).startsWith(label)) return c;
      throw new Error(label);
    };
    const d10 = col('11/10');
    expect(String(head.getCell(d10).value)).toContain('火');
    const s = rowOf(ws, 'Ｓさん');
    expect([s.getCell(2).value, s.getCell(3).value, s.getCell(d10).value]).toEqual(['自社', '自社', 1]);
    const u = rowOf(ws, '〇〇工務店（名前なし）');
    expect([u.getCell(2).value, u.getCell(3).value, u.getCell(d10).value]).toEqual(['〇〇工務店', '請負', 1]);
    expect(u.getCell(d10).numFmt).toContain('3名');
    expect((u.getCell(col('人工計')).value as Formula).result).toBe(1);
    expect((u.getCell(col('出勤日数')).value as Formula).result).toBe(1);

    const totals = rowOf(ws, '日ごとの合計');
    expect((totals.getCell(d10).value as Formula).result).toBe(2);
    expect((totals.getCell(col('人工計')).value as Formula).result).toBe(2);
    const ukeoi = rowOf(ws, 'うち請負');
    expect((ukeoi.getCell(d10).value as Formula).result).toBe(1);
    expect((ukeoi.getCell(d10).value as Formula).formula).toMatch(/^SUMIF\(\$C\$\d+:\$C\$\d+,"請負",/);

    // 2026-11-07 は土曜、11-08 は日曜
    const fg = (c: ExcelJS.Cell) => (c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
    expect(fg(head.getCell(col('11/7')))).toBe('FFDBEAFE');
    expect(fg(s.getCell(col('11/7')))).toBe('FFDBEAFE');
    expect(fg(s.getCell(col('11/8')))).toBe('FFFEE2E2');
    expect(fg(s.getCell(d10))).toBeUndefined();
    rowOf(ws, '繰越初期値は含みません（現場原価集計の ④ には含みます）');
  });

  it('2 か月なら表が 2 つ（月ごとに題の行）', async () => {
    const input = ledgerInput([ledgerReport('2026-10-31', [ownLabor()]), ledgerReport('2026-11-10', [ownLabor()])]);
    const ws = (await build(input)).getWorksheet('出面一覧')!;
    rowOf(ws, '出面一覧　〇〇様邸　2026年10月');
    rowOf(ws, '出面一覧　〇〇様邸　2026年11月');
  });

  it('見た目：列見出しは紺・白字、表の題は水色、字体 Meiryo、印刷 A4 横／A3 横、見出しを固定', async () => {
    const wb = await build();
    const cost = wb.getWorksheet('現場原価集計')!;
    const head = rowOf(cost, '費目');
    expect((head.getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF1F3864');
    expect(head.getCell(1).font?.color?.argb).toBe('FFFFFFFF');
    expect(head.getCell(1).font?.bold).toBe(true);
    expect((rowOf(cost, '① 原価合計').getCell(1).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFD9E1F2');
    expect(rowOf(cost, '労務費').getCell(1).font?.name).toBe('Meiryo');
    expect(cost.pageSetup).toMatchObject({ paperSize: 9, orientation: 'landscape', fitToWidth: 1 });
    expect(cost.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });

    const att = wb.getWorksheet('出面一覧')!;
    expect(att.pageSetup).toMatchObject({ paperSize: 8, orientation: 'landscape', fitToWidth: 1 });
    expect(att.views[0]).toMatchObject({ state: 'frozen', xSplit: 3, ySplit: 1 });
    expect(rowOf(att, 'Ｓさん').getCell(1).font?.name).toBe('Meiryo');
  });

  it('日報が無いモデルでも作れる（日報がありません・出面がありません）', async () => {
    const buf = await buildLedgerXlsx(emptyModel(), []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    rowOf(wb.getWorksheet('現場原価集計')!, '日報がありません');
    rowOf(wb.getWorksheet('出面一覧')!, '出面がありません');
  });

  it('協力会社の名前が = で始まっても文字のセルのまま', async () => {
    const input = ledgerInput();
    input.suppliers[1] = { ...input.suppliers[1], name: '=1+1' };
    const wb = await build(input);
    const att = wb.getWorksheet('出面一覧')!;
    expect(rowOf(att, '〇〇工務店（名前なし）').getCell(2).value).toBe('=1+1');
    const cost = wb.getWorksheet('現場原価集計')!;
    expect(rowOf(cost, '=1+1').getCell(1).value).toBe('=1+1');
  });
});

describe('ledgerFileName', () => {
  it('工期全体は出力日、月は YYYY年MM月', () => {
    expect(ledgerFileName('〇〇様邸', ALL, '2026-11-12')).toBe('〇〇様邸_現場管理台帳_20261112.xlsx');
    expect(ledgerFileName('〇〇様邸', { kind: 'month', month: '2026-11' }, '2026-11-12')).toBe('〇〇様邸_現場管理台帳_2026年11月.xlsx');
  });
});
