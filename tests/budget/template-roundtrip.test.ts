import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { lineAmount } from '@/lib/budget/schemas';
import { parseBudgetWorkbook } from '@/lib/budget/parse-template';
import { buildBudgetWorkbook } from '@/lib/budget/template-xlsx';
import { emptyBudgetData, type BudgetData, type BudgetLine, type ContractItem } from '@/lib/budget/types';

const T_HAKURI = '11111111-1111-4111-8111-111111111111';
const T_BLAST = '22222222-2222-4222-8222-222222222222';
const T_TOSOU = '33333333-3333-4333-8333-333333333333';
const T_EMPTY = '44444444-4444-4444-8444-444444444444';
const P_MARU = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P_SANKAKU = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const partners = [
  { id: P_MARU, name: '〇〇塗装' },
  { id: P_SANKAKU, name: '△△工業' },
];
const site = { name: '中野橋', code: '0612', dailyRate: 20000 };

let n = 0;
function line(v: Omit<BudgetLine, 'id' | 'amount' | 'sortOrder'>): BudgetLine {
  n++;
  return { ...v, id: `line-${n}`, amount: lineAmount(v.qty, v.unitPrice), sortOrder: n };
}
function item(v: Omit<ContractItem, 'id' | 'amount' | 'sortOrder'>): ContractItem {
  n++;
  return { ...v, id: `item-${n}`, amount: lineAmount(v.qty, v.unitPrice), sortOrder: n };
}

function sample(): BudgetData {
  return {
    ...emptyBudgetData(),
    trades: [
      { id: T_HAKURI, name: '剥離', sortOrder: 0 },
      { id: T_BLAST, name: 'ブラスト', sortOrder: 1 },
      { id: T_TOSOU, name: '塗装', sortOrder: 2 },
      { id: T_EMPTY, name: '足場（予算なし）', sortOrder: 3 },
    ],
    budgetLines: [
      line({ tradeId: T_HAKURI, performer: 'own', supplierId: null, item: 'labor', note: '剥離剤塗布・除去', qty: 80, unit: '人工', unitPrice: 20000 }),
      line({ tradeId: T_BLAST, performer: 'own', supplierId: null, item: 'labor', note: '', qty: 120.5, unit: '人工', unitPrice: 19500 }),
      line({ tradeId: T_TOSOU, performer: 'partner', supplierId: P_MARU, item: 'subcontract', note: '上塗 450㎡', qty: 1, unit: '式', unitPrice: 400000 }),
      line({ tradeId: T_TOSOU, performer: 'partner', supplierId: P_SANKAKU, item: 'jouyou', note: '応援', qty: 5, unit: '人工', unitPrice: 22000 }),
      line({ tradeId: T_TOSOU, performer: 'own', supplierId: null, item: 'labor', note: '下塗〜上塗', qty: 45, unit: '人工', unitPrice: 20000 }),
      line({ tradeId: null, performer: 'own', supplierId: null, item: 'material', note: '塗料・剥離剤・研削材', qty: 1, unit: '式', unitPrice: 800000 }),
      line({ tradeId: null, performer: 'own', supplierId: null, item: 'lease', note: 'ブラスト機・発電機', qty: 2, unit: '月', unitPrice: 150000 }),
      line({ tradeId: null, performer: 'own', supplierId: null, item: 'other', note: '燃料・宿泊', qty: 1, unit: '式', unitPrice: 100000 }),
    ],
    contractItems: [
      item({ section: 'initial', name: '剥離剤塗布、塗膜除去', spec: '中野橋', qty: 450, unit: '㎡', unitPrice: 2900, tradeId: T_HAKURI, category: 'trade' }),
      item({ section: 'initial', name: '素地調整', spec: '中野橋', qty: 450.25, unit: '㎡', unitPrice: 5100.5, tradeId: T_BLAST, category: 'trade' }),
      item({ section: 'initial', name: '諸経費', spec: '', qty: 1, unit: '式', unitPrice: 1146474, tradeId: null, category: 'expense' }),
      item({ section: 'initial', name: 'まだ識別していない行', spec: '', qty: 3, unit: 'm', unitPrice: 100, tradeId: null, category: 'trade' }),
      item({ section: 'change', name: '剥離剤塗布、塗膜除去', spec: '追加', qty: 590, unit: '㎡', unitPrice: 2900, tradeId: T_HAKURI, category: 'trade' }),
      item({ section: 'change', name: '玉川橋分減工分', spec: '', qty: 1, unit: '式', unitPrice: -1819800, tradeId: null, category: 'reduction' }),
    ],
  };
}

/** id を名前に置き換えた中身（比べる用）。 */
function shape(data: BudgetData) {
  const names = new Map(data.trades.map((t) => [t.id, t.name]));
  const sup = new Map(partners.map((p) => [p.id, p.name]));
  return {
    trades: [...data.trades].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.name),
    budgetLines: data.budgetLines.map((l) => ({
      trade: l.tradeId ? names.get(l.tradeId) : null,
      performer: l.performer,
      supplier: l.supplierId ? sup.get(l.supplierId) : null,
      item: l.item,
      note: l.note,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      amount: l.amount,
    })),
    contractItems: data.contractItems.map((i) => ({
      section: i.section,
      name: i.name,
      spec: i.spec,
      qty: i.qty,
      unit: i.unit,
      unitPrice: i.unitPrice,
      amount: i.amount,
      trade: i.tradeId ? names.get(i.tradeId) : null,
      category: i.category,
    })),
  };
}

async function toArrayBuffer(buf: Buffer): Promise<ArrayBuffer> {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** ExcelJS で雛形を開いて書き換え、Buffer に戻す。 */
async function edit(buf: Buffer, fn: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toArrayBuffer(buf));
  fn(wb);
  return toArrayBuffer(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
}

describe('実行予算・元請けの内訳の雛形：書き出し → 取り込み', () => {
  it('直さずに取り込み直すと、工種・予算の行・内訳の行がまったく同じ（id を除く）', async () => {
    const data = sample();
    const buf = await buildBudgetWorkbook(data, site, partners);
    const parsed = parseBudgetWorkbook(await toArrayBuffer(buf), { partners, dailyRate: site.dailyRate });
    expect(parsed.errors).toEqual([]);

    // 取り込んだ結果を BudgetData の形に戻す（工種の id は名前、金額は数量 × 単価）
    const ids = new Map(parsed.trades.map((name, i) => [name, `t-${i}`]));
    const back: BudgetData = {
      ...emptyBudgetData(),
      trades: parsed.trades.map((name, i) => ({ id: `t-${i}`, name, sortOrder: i })),
      budgetLines: parsed.budgetLines.map((l, i) => ({
        id: `l-${i}`,
        tradeId: l.tradeName ? ids.get(l.tradeName)! : null,
        performer: l.performer,
        supplierId: l.supplierId,
        item: l.item,
        note: l.note,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        amount: lineAmount(l.qty, l.unitPrice),
        sortOrder: i,
      })),
      contractItems: parsed.contractItems.map((c, i) => ({
        id: `c-${i}`,
        section: c.section,
        name: c.name,
        spec: c.spec,
        qty: c.qty,
        unit: c.unit,
        unitPrice: c.unitPrice,
        amount: lineAmount(c.qty, c.unitPrice),
        tradeId: c.tradeName ? ids.get(c.tradeName)! : null,
        category: c.category,
        sortOrder: i,
      })),
    };
    expect(shape(back)).toEqual(shape(data));
    expect(parsed.trades).toContain('足場（予算なし）'); // 予算・内訳に出てこない工種も残る
    expect(parsed.hasBudgetSheet).toBe(true);
    expect(parsed.hasContractSheet).toBe(true);
  });

  it('空の雛形：工種だけで、予算・内訳の行は無い（金額の式の空の行は読まない）', async () => {
    const data = { ...sample(), budgetLines: [], contractItems: [] };
    const buf = await buildBudgetWorkbook(data, site, partners);
    const parsed = parseBudgetWorkbook(await toArrayBuffer(buf), { partners, dailyRate: null });
    expect(parsed.errors).toEqual([]);
    expect(parsed.trades).toEqual(['剥離', 'ブラスト', '塗装', '足場（予算なし）']);
    expect(parsed.budgetLines).toEqual([]);
    expect(parsed.contractItems).toEqual([]);
  });

  it('シートと見出し・プルダウンが見本の並び', async () => {
    const buf = await buildBudgetWorkbook(sample(), site, partners);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await toArrayBuffer(buf));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['実行予算', '元請けの内訳', '選択肢']);
    const b = wb.getWorksheet('実行予算')!;
    expect(String(b.getCell('A1').value)).toContain('中野橋');
    expect(String(b.getCell('A1').value)).toContain('20,000');
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => b.getRow(2).getCell(c).value)).toEqual([
      '工種', '施工者', '項目', '内容・メモ', '数量', '単位', '単価', '金額',
    ]);
    const c = wb.getWorksheet('元請けの内訳')!;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => c.getRow(2).getCell(i).value)).toEqual([
      '区分', '名称', '規格・仕様', '数量', '単位', '単価', '金額', '工種（識別）',
    ]);
    expect(b.getCell('A3').dataValidation?.type).toBe('list');
    expect(b.getCell('B3').dataValidation?.type).toBe('list');
    expect(c.getCell('H3').dataValidation?.type).toBe('list');
    const o = wb.getWorksheet('選択肢')!;
    expect(o.getCell('B2').value).toBe('自社');
    expect(o.getCell('B4').value).toBe('〇〇塗装');
  });
});

describe('取り込みの誤り（行番号つき）', () => {
  async function withBudgetRows(rows: (string | number | null)[][], opts = { dailyRate: 20000 as number | null }) {
    const buf = await buildBudgetWorkbook({ ...emptyBudgetData(), trades: [{ id: T_TOSOU, name: '塗装', sortOrder: 0 }] }, site, partners);
    const ab = await edit(buf, (wb) => {
      const ws = wb.getWorksheet('実行予算')!;
      rows.forEach((r, i) => r.forEach((v, j) => (ws.getRow(3 + i).getCell(j + 1).value = v)));
    });
    return parseBudgetWorkbook(ab, { partners, dailyRate: opts.dailyRate });
  }

  it('施工者の名前がマスターの協力会社に無い → errors（その行は入れない）', async () => {
    const parsed = await withBudgetRows([
      ['塗装', '〇〇塗装', '請負', '', 1, '式', 100000],
      ['塗装', '□□建設', '請負', '', 1, '式', 100000],
    ]);
    expect(parsed.budgetLines).toHaveLength(1);
    expect(parsed.budgetLines[0].supplierId).toBe(P_MARU);
    expect(parsed.errors).toEqual([{ sheet: '実行予算', row: 4, message: expect.stringContaining('□□建設') }]);
  });

  it('全角・空白の違いは同じ会社として読む', async () => {
    const parsed = await withBudgetRows([['塗装', ' △△ 工業 ', '常用', '', 5, '人工', 22000]]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.budgetLines[0].supplierId).toBe(P_SANKAKU);
  });

  it('項目と施工者の組み合わせの誤り → errors（行番号つき）', async () => {
    const parsed = await withBudgetRows([
      ['塗装', '〇〇塗装', '労務', '', 1, '人工', 20000], // 3 行目：労務に協力会社
      ['塗装', '自社', '請負', '', 1, '式', 1], // 4 行目：請負に自社
      ['塗装', '—', '材料', '', 1, '式', 1], // 5 行目：材料に工種
      ['（現場全体）', '自社', '労務', '', 1, '人工', 1], // 6 行目：労務に工種なし
      ['塗装', '自社', '手当', '', 1, '式', 1], // 7 行目：項目が無い
      ['（現場全体）', '—', '材料', '', 1, '式', 500], // 8 行目：正しい
    ]);
    expect(parsed.errors.map((e) => e.row)).toEqual([3, 4, 5, 6, 7]);
    expect(parsed.errors.every((e) => e.sheet === '実行予算')).toBe(true);
    expect(parsed.errors[0].message).toContain('労務は自社');
    expect(parsed.errors[2].message).toContain('現場全体');
    expect(parsed.budgetLines).toHaveLength(1);
    expect(parsed.budgetLines[0]).toMatchObject({ row: 8, tradeName: null, item: 'material', performer: 'own', supplierId: null });
  });

  it('自社の労務の単価が空欄なら設定日当、設定が無ければ誤り', async () => {
    const ok = await withBudgetRows([['塗装', '自社', '労務', '', 10, '人工', null]]);
    expect(ok.errors).toEqual([]);
    expect(ok.budgetLines[0].unitPrice).toBe(20000);
    const ng = await withBudgetRows([['塗装', '自社', '労務', '', 10, '人工', null]], { dailyRate: null });
    expect(ng.errors).toEqual([{ sheet: '実行予算', row: 3, message: '単価を入力してください' }]);
  });

  it('新しい工種の名前は工種に足される', async () => {
    const parsed = await withBudgetRows([['ケレン', '自社', '労務', '', 3, '人工', 20000]]);
    expect(parsed.trades).toEqual(['塗装', 'ケレン']);
  });

  it('内訳：区分・数量の誤りと、単価の無い一式の行', async () => {
    const buf = await buildBudgetWorkbook(emptyBudgetData(), site, partners);
    const ab = await edit(buf, (wb) => {
      const ws = wb.getWorksheet('元請けの内訳')!;
      const rows: (string | number | null)[][] = [
        ['追加', '名称', '', 1, '式', 100, null, ''], // 3：区分の誤り
        ['当初', '数量なし', '', null, '式', 100, null, ''], // 4：数量なし
        ['当初', '一式の行', '', null, '式', null, 50000, '経費'], // 5：金額だけ → 1 × 50000
        ['', '識別なし', '', 2, 'm', 300, null, ''], // 6：区分の空欄は当初
      ];
      rows.forEach((r, i) => r.forEach((v, j) => (ws.getRow(3 + i).getCell(j + 1).value = v)));
    });
    const parsed = parseBudgetWorkbook(ab, { partners, dailyRate: null });
    expect(parsed.errors.map((e) => [e.sheet, e.row])).toEqual([
      ['元請けの内訳', 3],
      ['元請けの内訳', 4],
    ]);
    expect(parsed.contractItems).toEqual([
      { row: 5, section: 'initial', name: '一式の行', spec: '', qty: 1, unit: '式', unitPrice: 50000, category: 'expense', tradeName: null },
      { row: 6, section: 'initial', name: '識別なし', spec: '', qty: 2, unit: 'm', unitPrice: 300, category: 'trade', tradeName: null },
    ]);
  });

  it('雛形でないファイル → errors', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getCell('A1').value = 'x';
    const ab = await toArrayBuffer(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer));
    const parsed = parseBudgetWorkbook(ab, { partners, dailyRate: null });
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.hasBudgetSheet).toBe(false);
  });
});
