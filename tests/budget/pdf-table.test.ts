import { describe, expect, it } from 'vitest';
import { buildCandidates, extractTable, hasNoText, parseAmount, parsePdfTable, type PdfTextItem } from '@/lib/budget/pdf-table';

// 文字の幅：全角 10、半角 5（文字の高さ 10）。
function width(s: string): number {
  return [...s].reduce((w, ch) => w + (/[\x20-\x7e]/.test(ch) ? 5 : 10), 0);
}
/** 左揃えの文字。 */
function t(x: number, y: number, str: string): PdfTextItem {
  return { str, x, y, width: width(str), height: 10 };
}
/** 右揃えの数（右端 xr）。 */
function r(xr: number, y: number, str: string): PdfTextItem {
  return { str, x: xr - width(str), y, width: width(str), height: 10 };
}

// 列：名称 40〜 / 規格・仕様 200〜 / 単位 380〜400 / 数量 〜440 / 単価 〜490 / 金額 〜550
function itemRow(y: number, name: string, spec: string, unit: string, qty: string, price: string, amount: string): PdfTextItem[] {
  const out: PdfTextItem[] = [t(40, y, name)];
  if (spec) out.push(t(200, y, spec));
  if (unit) out.push(t(382, y, unit));
  if (qty) out.push(r(440, y, qty));
  if (price) out.push(r(490, y, price));
  if (amount) out.push(r(550, y, amount));
  return out;
}

const nakanoPage1: PdfTextItem[] = [
  t(250, 40, '注 文 書'),
  t(40, 60, '株式会社〇〇 御中'),
  r(550, 60, '2026/11/01'),
  // 見出し（「名」「称」が離れて書かれている）
  t(40, 100, '名'),
  t(60, 100, '称'),
  t(200, 100, '規格・仕様'),
  t(380, 100, '単位'),
  t(420, 100, '数量'),
  t(470, 100, '単価'),
  t(530, 100, '金額'),
  t(40, 120, '【中野橋 現場塗装工】'),
  // y が少しずれた数も同じ行
  ...itemRow(135, '剥離剤塗布、塗膜除去、廃材の回収・積込含む', '', '㎡', '450', '2,900', '1,305,000').map((i) =>
    i.str === '450' ? { ...i, y: 136.5 } : i,
  ),
  ...itemRow(150, '下塗り', '変性エポキシ樹脂塗料', '㎡', '450', '1,800', '810,000'),
  // 規格の続きの行（直前の明細につなぐ）
  t(200, 162, '2回塗り'),
  ...itemRow(180, '諸経費', '', '式', '1', '', '1,146,474'),
  ...itemRow(195, '小計', '', '', '', '', '3,261,474'),
];

const nakanoPage2: PdfTextItem[] = [
  // 2 ページめにも見出しがある
  t(40, 100, '名称'),
  t(200, 100, '規格・仕様'),
  t(380, 100, '単位'),
  t(420, 100, '数量'),
  t(470, 100, '単価'),
  t(530, 100, '金額'),
  t(40, 120, '＜変更増減分＞'),
  ...itemRow(135, '上塗り 追加', 'ふっ素樹脂塗料', '㎡', '１００', '2,000', '200,001'),
  ...itemRow(150, '玉川橋分減工分', '', '式', '1', '', '△1,819,800'),
  ...itemRow(170, '合計', '', '', '', '', '1,641,675'),
];

describe('parseAmount', () => {
  it('カンマ・円記号・全角・負の印を読む', () => {
    expect(parseAmount('1,305,000')).toBe(1305000);
    expect(parseAmount('¥1,305,000')).toBe(1305000);
    expect(parseAmount('￥1,200円')).toBe(1200);
    expect(parseAmount('１２３．５')).toBe(123.5);
    expect(parseAmount('△1,819,800')).toBe(-1819800);
    expect(parseAmount('▲5')).toBe(-5);
    expect(parseAmount('−3')).toBe(-3);
    expect(parseAmount('-1,000')).toBe(-1000);
    expect(parseAmount('(1,000)')).toBe(-1000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('  ')).toBeNull();
    expect(parseAmount('式')).toBeNaN();
    expect(parseAmount('2026/11/01')).toBeNaN();
  });
});

describe('extractTable', () => {
  it('見出しの行で列を決め、見出しより上と繰り返しの見出しを除く', () => {
    const table = extractTable([nakanoPage1, nakanoPage2]);
    expect(table.headerFound).toBe(true);
    expect(table.columns.map((c) => [c.label, c.role])).toEqual([
      ['名称', 'name'],
      ['規格・仕様', 'spec'],
      ['単位', 'unit'],
      ['数量', 'qty'],
      ['単価', 'unitPrice'],
      ['金額', 'amount'],
    ]);
    const texts = table.rows.map((row) => row.cells.join('|'));
    expect(texts.some((s) => s.includes('注 文 書'))).toBe(false);
    expect(texts.some((s) => s.includes('規格・仕様'))).toBe(false);
    // 長い名称は規格の列まではみ出しても名称の列、y が少しずれた数も同じ行
    expect(table.rows[1].cells).toEqual(['剥離剤塗布、塗膜除去、廃材の回収・積込含む', '', '㎡', '450', '2,900', '1,305,000']);
  });

  it('見出しが無いときは数の列の位置から推定する', () => {
    const items = [
      ...itemRow(100, '下塗り', '変性エポキシ', '㎡', '450', '1,800', '810,000'),
      ...itemRow(115, '中塗り', 'ふっ素中塗', '㎡', '450', '1,500', '675,000'),
      ...itemRow(130, '上塗り', 'ふっ素上塗', '㎡', '450', '1,700', '765,000'),
    ];
    const { table, candidates } = parsePdfTable([items]);
    expect(table.headerFound).toBe(false);
    expect(table.columns.map((c) => c.role)).toEqual(['name', 'spec', 'unit', 'qty', 'unitPrice', 'amount']);
    expect(candidates.map((c) => c.guess.name)).toEqual(['下塗り', '中塗り', '上塗り']);
    expect(candidates[1].guess).toMatchObject({ spec: 'ふっ素中塗', qty: 450, unit: '㎡', unitPrice: 1500, amount: 675000 });
  });
});

describe('parsePdfTable（中野橋の注文書）', () => {
  const { candidates } = parsePdfTable([nakanoPage1, nakanoPage2]);

  it('行の種類：見出し・明細・小計・合計', () => {
    expect(candidates.map((c) => [c.kind, c.guess.name || c.cells.join('')])).toEqual([
      ['heading', '【中野橋 現場塗装工】'],
      ['item', '剥離剤塗布、塗膜除去、廃材の回収・積込含む'],
      ['item', '下塗り'],
      ['item', '諸経費'],
      ['subtotal', '小計'],
      ['heading', '＜変更増減分＞'],
      ['item', '上塗り 追加'],
      ['item', '玉川橋分減工分'],
      ['total', '合計'],
    ]);
    expect(candidates.filter((c) => c.include).length).toBe(5);
    expect(candidates.filter((c) => c.kind !== 'item').every((c) => !c.include)).toBe(true);
  });

  it('数を読み、規格の続きの行をつなぐ', () => {
    const [, hakuri, shita] = candidates;
    expect(hakuri.guess).toEqual({ name: '剥離剤塗布、塗膜除去、廃材の回収・積込含む', spec: '', qty: 450, unit: '㎡', unitPrice: 2900, amount: 1305000 });
    expect(hakuri.amountMismatch).toBe(false);
    expect(hakuri.heading).toBe('【中野橋 現場塗装工】');
    expect(shita.guess.spec).toBe('変性エポキシ樹脂塗料 2回塗り');
  });

  it('1 式の金額だけの行は数量 1・単価＝金額、経費・減分を推定する', () => {
    const keihi = candidates[3];
    expect(keihi.guess).toMatchObject({ qty: 1, unit: '式', unitPrice: 1146474, amount: 1146474 });
    expect(keihi.category).toBe('expense');
    const gen = candidates[7];
    expect(gen.guess).toMatchObject({ qty: 1, unit: '式', unitPrice: -1819800, amount: -1819800 });
    expect(gen.category).toBe('reduction');
    expect(candidates[1].category).toBe('trade');
  });

  it('変更の見出しの後は区分「変更」', () => {
    expect(candidates.slice(0, 5).every((c) => c.section === 'initial')).toBe(true);
    expect(candidates[6].section).toBe('change');
    expect(candidates[7].section).toBe('change');
  });

  it('全角の数量を読み、金額が数量 × 単価と合わない行に印を付ける', () => {
    const add = candidates[6];
    expect(add.guess).toMatchObject({ qty: 100, unitPrice: 2000, amount: 200001 });
    expect(add.amountMismatch).toBe(true);
  });

  it('列の割り当てを変えると読み直す', () => {
    const table = extractTable([nakanoPage1]);
    // 規格の列を「使わない」にする
    const roles = table.columns.map((c) => (c.role === 'spec' ? 'ignore' : c.role));
    const c = buildCandidates(table, roles);
    expect(c.find((x) => x.guess.name === '下塗り')?.guess.spec).toBe('');
  });
});

describe('2 行に分かれた明細', () => {
  it('名称だけの行の次の数だけの行は 1 つの明細にする', () => {
    const header = [t(40, 100, '名称'), t(200, 100, '規格'), t(380, 100, '単位'), t(420, 100, '数量'), t(470, 100, '単価'), t(530, 100, '金額')];
    const items = [...header, t(40, 115, 'ケレン 3種'), t(382, 127, '㎡'), r(440, 127, '200'), r(490, 127, '1,000'), r(550, 127, '200,000')];
    const { candidates } = parsePdfTable([items]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: 'item', include: true });
    expect(candidates[0].guess).toMatchObject({ name: 'ケレン 3種', qty: 200, unit: '㎡', unitPrice: 1000 });
  });
});

describe('hasNoText', () => {
  it('文字の無い PDF', () => {
    expect(hasNoText([[], [{ str: ' ', x: 0, y: 0, width: 0, height: 0 }]])).toBe(true);
    expect(hasNoText([[t(0, 0, 'a')]])).toBe(false);
  });
});
