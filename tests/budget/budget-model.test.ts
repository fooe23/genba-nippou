import { describe, expect, it } from 'vitest';
import { apportion, buildBudgetModel, normalizeUnit, type BudgetModel, type TradeRow } from '@/lib/budget/budget-model';
import {
  SP_NONE, SP_PAINT, SP_TWO, T_BLAST, T_PAINT, T_SCAFF, T_SEAL,
  nakanoData, nakanoInput, noAffiliation, own, partner, work,
} from './fixture-nakano';

const trade = (m: BudgetModel, id: string): TradeRow => {
  const t = m.trades.find((x) => x.tradeId === id);
  if (!t) throw new Error(`no trade ${id}`);
  return t;
};
const day = (t: { days: { date: string; amount: number; manDays: number }[] }, date: string) => t.days.find((d) => d.date === date);
const performer = (t: TradeRow, supplierId: string | null) => t.actual.byPerformer.find((p) => p.supplierId === supplierId);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 日ごとに、工種＋予算外の労務費・人工の和がその日の労務の行の和と一致すること。 */
function expectDaySumsExact(m: BudgetModel, input: ReturnType<typeof nakanoInput>) {
  for (const r of input.reports.filter((x) => x.date <= input.asOf)) {
    const labor = r.lines.filter((l) => l.kind === 'labor');
    const amount = labor.reduce((s, l) => s + l.stored.amount, 0);
    const manDays = labor.reduce((s, l) => s + l.stored.manDays, 0);
    const parts = [...m.trades, m.outside].map((t) => day(t, r.date)).filter((d) => d !== undefined);
    expect(parts.reduce((s, d) => s + d.amount, 0)).toBe(amount);
    expect(r2(parts.reduce((s, d) => s + d.manDays, 0))).toBe(r2(manDays));
    for (const d of parts) expect(Number.isInteger(d.amount)).toBe(true);
  }
}

describe('apportion', () => {
  it('円単位で比例配分し、端数は重みの最も大きい先へ（和は元と一致）', () => {
    const w = [{ key: 'a', w: 1, order: 0 }, { key: 'b', w: 1, order: 1 }, { key: 'c', w: 1, order: 2 }];
    const out = apportion(10000, w, 1);
    expect(Object.fromEntries(out)).toEqual({ a: 3334, b: 3333, c: 3333 });
  });
  it('人工は 0.01 単位', () => {
    const out = apportion(1, [{ key: 'a', w: 2, order: 0 }, { key: 'b', w: 1, order: 1 }], 0.01);
    expect(Object.fromEntries(out)).toEqual({ a: 0.67, b: 0.33 });
  });
  it('重みが無ければ空、0 は空', () => {
    expect(apportion(100, [{ key: 'a', w: 0, order: 0 }], 1).size).toBe(0);
    expect(apportion(0, [{ key: 'a', w: 1, order: 0 }], 1).size).toBe(0);
  });
});

describe('normalizeUnit', () => {
  it('前後の空白・全角・㎡・大文字をそろえる', () => {
    expect(normalizeUnit(' ㎡ ')).toBe('m2');
    expect(normalizeUnit('ｍ２')).toBe('m2');
    expect(normalizeUnit('M2')).toBe('m2');
  });
});

describe('buildBudgetModel（中野橋）', () => {
  const input = nakanoInput();
  const m = buildBudgetModel(input);

  it('自社がブラスト・〇〇塗装が塗装の日：〇〇塗装の労務費は塗装だけ、自社は投入人工の比', () => {
    const blast = trade(m, T_BLAST);
    const paint = trade(m, T_PAINT);
    // 〇〇塗装 44000 は全部塗装、自社 60000 はブラスト 3：塗装 2
    expect(day(paint, '2026-10-01')).toMatchObject({ amount: 44000 + 24000, manDays: 3.2 });
    expect(day(blast, '2026-10-01')).toMatchObject({ amount: 36000, manDays: 1.8 });
    expect(performer(paint, SP_PAINT)).toMatchObject({ actualAmount: 44000, actualManDays: 2 });
    expect(performer(blast, SP_PAINT)).toBeUndefined();
    expect(day(m.outside, '2026-10-01')).toBeUndefined();
  });

  it('工種の合計＋予算外＝その日の労務費・人工（すべての日）', () => {
    expectDaySumsExact(m, input);
    expect(m.total.actualAmount - m.siteWide.actual.amount).toBe(227000);
  });

  it('2 つの工種に入っている協力会社はその日の投入人工の比（それらの工種の中で）、予算外は重みに入る', () => {
    // 10/02：△△工業 22000 → ブラスト 1：足場 3。自社 40000 → ブラスト 1：足場 3：予算外 1
    expect(performer(trade(m, T_BLAST), SP_TWO)).toMatchObject({ actualAmount: 5500, actualManDays: 0.25 });
    expect(performer(trade(m, T_SCAFF), SP_TWO)).toMatchObject({ actualAmount: 16500, actualManDays: 0.75 });
    expect(performer(trade(m, T_SCAFF), null)).toMatchObject({ actualAmount: 24000, actualManDays: 1.2 });
    expect(day(m.outside, '2026-10-02')).toMatchObject({ amount: 8000, manDays: 0.4, workManDays: 1 });
  });

  it('どこにも入っていない協力会社はその日の行の比', () => {
    // 10/03：□□建設 21000 → ブラスト 2：塗装 1
    expect(performer(trade(m, T_BLAST), SP_NONE)).toMatchObject({ actualAmount: 14000, actualManDays: 0.67, name: '□□建設', partnerContract: 300000 });
    expect(performer(trade(m, T_PAINT), SP_NONE)).toMatchObject({ actualAmount: 7000, actualManDays: 0.33 });
  });

  it('工種の付いた行の無い日は全部予算外', () => {
    expect(day(m.outside, '2026-10-04')).toMatchObject({ amount: 20000, manDays: 1 });
    for (const t of m.trades) expect(day(t, '2026-10-04')).toBeUndefined();
    expect(m.outside).toMatchObject({ amount: 28000, manDays: 1.4, workLineCount: 2, workManDays: 2 });
  });

  it('工種ごとの合計と予算', () => {
    expect(trade(m, T_BLAST).actual).toMatchObject({ amount: 76834, manDays: 3.79 });
    expect(trade(m, T_PAINT).actual).toMatchObject({ amount: 81666, manDays: 3.86 });
    expect(trade(m, T_SCAFF).actual).toMatchObject({ amount: 40500, manDays: 1.95 });
    expect(trade(m, T_BLAST).budget).toMatchObject({ amount: 1420000, manDays: 70 });
    expect(trade(m, T_PAINT).budget).toMatchObject({ amount: 2500000, manDays: 0 });
    expect(m.outside.budget).toEqual({ amount: 40000, manDays: 2 });
  });

  it('asOf より後の日報は数えない', () => {
    expect(day(trade(m, T_BLAST), '2026-10-20')).toBeUndefined();
    const later = buildBudgetModel(nakanoInput({ asOf: '2026-10-31' }));
    expect(trade(later, T_BLAST).actual.amount).toBe(76834 + 20000);
  });

  it('数量から：単位が同じ内訳の行だけを分母（当初＋変更、㎡ と m2 は同じ）、単位の違う日報の行は数えない', () => {
    const blast = trade(m, T_BLAST);
    expect(blast.actual).toMatchObject({ qty: 180, unit: 'm2' });
    expect(blast.progress.fromQty).toBeCloseTo(12, 9);
    expect(blast.progress).toMatchObject({ override: null, used: blast.progress.fromQty });
    expect(day(blast, '2026-10-02')).toMatchObject({ qty: 50, unit: 'm2' });
    // 塗装：内訳は m2 1500（300 万）と 式 1（50 万）→ 金額の大きい m2。10 m の行は数えない
    const paint = trade(m, T_PAINT);
    expect(paint.actual).toMatchObject({ qty: 80, unit: 'm2' });
    expect(paint.progress.fromQty).toBeCloseTo((80 / 1500) * 100, 9);
    expect(day(paint, '2026-10-03')).toMatchObject({ qty: null, unit: null });
  });

  it('上書きがあれば used＝上書き', () => {
    expect(trade(m, T_PAINT).progress).toMatchObject({ override: 40, used: 40 });
    expect(trade(m, T_PAINT).forecast).toBe(Math.round(81666 / 0.4));
  });

  it('見込み＝実績 ÷ (used/100)、見込みの粗利＝内訳の金額 − 見込み', () => {
    const blast = trade(m, T_BLAST);
    expect(blast.contractAmount).toBe(2250000);
    expect(blast.forecast).toBe(640283);
    expect(blast.forecastProfit).toBe(2250000 - 640283);
    expect(blast.status).toBe('ok');
  });

  it('分母 0 なら数量からは null、見込み null・status none', () => {
    const seal = trade(m, T_SEAL);
    expect(seal.progress).toEqual({ used: null, fromQty: null, override: null });
    expect(seal).toMatchObject({ forecast: null, forecastProfit: null, status: 'none' });
  });

  it('単位が「式」だけで日報に数量が無い工種は 0 %：見込み null・status none（0 除算しない）', () => {
    const scaff = trade(m, T_SCAFF);
    expect(scaff.progress).toEqual({ used: 0, fromQty: 0, override: null });
    expect(scaff).toMatchObject({ forecast: null, forecastProfit: null, status: 'none' });
  });

  it('判定：予算超え・赤字の見込み・上書き 0 は none、上書きは 0〜100 に収める', () => {
    const withOverride = (percent: number) => {
      const data = nakanoData();
      data.progress = [{ tradeId: T_BLAST, percent, setBy: null, setAt: '2026-10-05T00:00:00Z' }];
      return trade(buildBudgetModel(nakanoInput({ data })), T_BLAST);
    };
    expect(withOverride(5)).toMatchObject({ forecast: 1536680, status: 'overBudget' });
    expect(withOverride(3).status).toBe('loss');
    expect(withOverride(0)).toMatchObject({ forecast: null, forecastProfit: null, status: 'none' });
    expect(withOverride(150).progress.used).toBe(100);
  });

  it('内訳の経費・減分（と未識別の行）は工種に入らず、合計の内訳の金額にだけ入る', () => {
    const tradesSum = m.trades.reduce((s, t) => s + t.contractAmount, 0);
    expect(tradesSum).toBe(6550000);
    expect(m.total).toMatchObject({
      contractAmount: 6800000,
      contractTradeAmount: 6550000,
      contractExpense: 300000,
      contractReduction: -100000,
      contractUnassigned: 50000,
    });
    expect(m.siteWide.contractExpense).toBe(300000);
  });

  it('現場全体：材料・リース・その他の予算、燃料・リース・現金・掛けの実績', () => {
    expect(m.siteWide.budget).toEqual({ material: 400000, lease: 150000, other: 50000, amount: 600000 });
    expect(m.siteWide.actual).toEqual({ fuel: 3000, lease: 5000, cash: 1200, credit: 15000, amount: 24200 });
    expect(m.total.budgetAmount).toBe(1420000 + 2500000 + 110000 + 40000 + 600000);
  });

  it('協力会社の請負金額が partnerContract に出る、施工者の行（自社 → 協力会社）', () => {
    const paint = trade(m, T_PAINT);
    expect(paint.budget.byPerformer[0]).toMatchObject({ performer: 'own', supplierId: null, name: '自社', budgetAmount: 0, budgetManDays: null, actualAmount: 30666 });
    expect(performer(paint, SP_PAINT)).toMatchObject({ performer: 'partner', name: '〇〇塗装', budgetAmount: 2500000, budgetManDays: null, partnerContract: 2600000 });
    const blast = trade(m, T_BLAST);
    expect(performer(blast, null)).toMatchObject({ budgetAmount: 1200000, budgetManDays: 60 });
    expect(performer(blast, SP_TWO)).toMatchObject({ name: '△△工業', budgetAmount: 220000, budgetManDays: 10, partnerContract: null });
    // 予算に無い工種（シール）も自社の行は出る
    expect(trade(m, T_SEAL).budget.byPerformer).toHaveLength(1);
  });

  it('日の明細：作業内容の行と投入人工', () => {
    const d = day(trade(m, T_BLAST), '2026-10-02');
    expect(d).toMatchObject({ workManDays: 1, lines: [{ trade: 'ブラスト工', qty: 50, unit: '㎡', manDays: 1 }] });
  });
});

describe('buildBudgetModel（振り分けの細部）', () => {
  const base = (lines: ReturnType<typeof own>[]) => nakanoInput({ reports: [{ date: '2026-10-01', lines }] });

  it('1 つの工種だけの協力会社は、その工種にその日の行が無くても全部その工種', () => {
    const input = base([partner(SP_PAINT, '〇〇', 22000), work({ tradeId: T_BLAST, manDays: 2 })]);
    const m = buildBudgetModel(input);
    expect(day(trade(m, T_PAINT), '2026-10-01')).toMatchObject({ amount: 22000, manDays: 1 });
    expect(day(trade(m, T_BLAST), '2026-10-01')).toMatchObject({ amount: 0, manDays: 0, workManDays: 2 });
    expectDaySumsExact(m, input);
  });

  it('2 つの工種の協力会社で、その日にどちらの工種も重みが無ければ等分', () => {
    const input = base([partner(SP_TWO, '△△', 22001), work({ tradeId: T_PAINT, manDays: 1 })]);
    const m = buildBudgetModel(input);
    expect(day(trade(m, T_BLAST), '2026-10-01')).toMatchObject({ amount: 11001, manDays: 0.5 });
    expect(day(trade(m, T_SCAFF), '2026-10-01')).toMatchObject({ amount: 11000, manDays: 0.5 });
    expectDaySumsExact(m, input);
  });

  it('工種の付いた行の無い日は、工種に入っている協力会社も予算外', () => {
    const input = base([partner(SP_PAINT, '〇〇'), work({ trade: '片付け', manDays: 1 })]);
    const m = buildBudgetModel(input);
    expect(m.outside).toMatchObject({ amount: 22000, manDays: 1 });
    expect(m.outside.byPerformer).toEqual([expect.objectContaining({ supplierId: SP_PAINT, name: '〇〇塗装', actualAmount: 22000 })]);
  });

  it('投入人工がすべて空（0）なら工種の付いた行で等分（工種の決まらない行は外す）', () => {
    const input = base([
      own('A', 30000, 1.5),
      work({ tradeId: T_BLAST, manDays: 0 }),
      work({ tradeId: T_BLAST, manDays: 0 }),
      work({ tradeId: T_PAINT, manDays: 0 }),
      work({ trade: '予算外', manDays: 0 }),
    ]);
    const m = buildBudgetModel(input);
    expect(day(trade(m, T_BLAST), '2026-10-01')).toMatchObject({ amount: 20000, manDays: 1 });
    expect(day(trade(m, T_PAINT), '2026-10-01')).toMatchObject({ amount: 10000, manDays: 0.5 });
    expect(m.outside.amount).toBe(0);
    expectDaySumsExact(m, input);
  });

  it('所属なしは自社の行にまとめ、会社の写しの無い協力会社はその日の比', () => {
    const input = base([
      noAffiliation('飛び込み', 15000, 1),
      partner(null, '不明', 10000, 1),
      work({ tradeId: T_BLAST, manDays: 1 }),
      work({ tradeId: T_PAINT, manDays: 1 }),
    ]);
    const m = buildBudgetModel(input);
    expect(performer(trade(m, T_BLAST), null)).toMatchObject({ performer: 'own', actualAmount: 7500 });
    const unknown = trade(m, T_PAINT).actual.byPerformer.find((p) => p.performer === 'partner' && p.supplierId === null);
    expect(unknown).toMatchObject({ supplierId: null, name: '協力会社', actualAmount: 5000, actualManDays: 0.5 });
    expectDaySumsExact(m, input);
  });

  it('現場の工種に無い参照は予算外', () => {
    const input = base([own('A'), work({ tradeId: 'deleted', manDays: 1 })]);
    const m = buildBudgetModel(input);
    expect(m.outside.amount).toBe(20000);
  });

  it('端数の多い日でも和が一致（円・0.01 人工）', () => {
    const input = base([
      own('A', 23457, 1.13), own('B', 19999, 0.87), partner(SP_NONE, '□□', 21111, 1.01), partner(SP_TWO, '△△', 22223, 0.99),
      work({ tradeId: T_BLAST, manDays: 1.3 }),
      work({ tradeId: T_PAINT, manDays: 0.7 }),
      work({ tradeId: T_SCAFF, manDays: 1.1 }),
      work({ trade: '雑', manDays: 0.9 }),
    ]);
    expectDaySumsExact(buildBudgetModel(input), input);
  });

  it('内訳の単位が複数：金額の最も大きい単位で数量からを出す', () => {
    const data = nakanoData();
    data.contractItems = [
      { id: 'x1', section: 'initial', name: '', spec: '', qty: 10, unit: 't', unitPrice: 1000, amount: 10000, tradeId: T_BLAST, category: 'trade', sortOrder: 1 },
      { id: 'x2', section: 'initial', name: '', spec: '', qty: 200, unit: 'm2', unitPrice: 500, amount: 100000, tradeId: T_BLAST, category: 'trade', sortOrder: 2 },
    ];
    const input = nakanoInput({
      data,
      reports: [{ date: '2026-10-01', lines: [own('A'), work({ tradeId: T_BLAST, manDays: 1, qty: 50, unit: 'm2' }), work({ tradeId: T_BLAST, manDays: 1, qty: 5, unit: 't' })] }],
    });
    const blast = trade(buildBudgetModel(input), T_BLAST);
    expect(blast.actual).toMatchObject({ qty: 50, unit: 'm2' });
    expect(blast.progress.fromQty).toBe(25);
    expect(blast.forecast).toBe(80000);
  });
});
