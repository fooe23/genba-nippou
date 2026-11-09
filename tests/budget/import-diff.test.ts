import { describe, expect, it } from 'vitest';
import { diffImport, planTradeSaves, toBudgetLineInputs, toContractItemInputs } from '@/lib/budget/import-diff';
import type { ParsedBudgetLine, ParsedContractItem } from '@/lib/budget/parse-template';
import { emptyBudgetData, type BudgetData } from '@/lib/budget/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

function current(extra: Partial<BudgetData> = {}): BudgetData {
  return {
    ...emptyBudgetData(),
    trades: [
      { id: A, name: '剥離', sortOrder: 0 },
      { id: B, name: 'ブラスト', sortOrder: 1 },
      { id: C, name: '塗装', sortOrder: 2 },
      { id: D, name: '足場', sortOrder: 3 },
    ],
    ...extra,
  };
}

const labor = (tradeName: string | null, row = 3): ParsedBudgetLine => ({
  row, tradeName, performer: 'own', supplierId: null, supplierName: null, item: 'labor', note: '', qty: 1, unit: '人工', unitPrice: 20000,
});
const contract = (tradeName: string | null, row = 3): ParsedContractItem => ({
  row, section: 'initial', name: '行', spec: '', qty: 1, unit: '式', unitPrice: 100, category: 'trade', tradeName,
});

describe('取り込み前の差分', () => {
  it('Excel の新しい名前は addTrades、日報で使っている工種が Excel に無ければ keptMissingTrades（消さない）', () => {
    const parsed = { trades: ['剥離', 'ケレン'], budgetLines: [labor('剥離'), labor('ケレン', 4)], contractItems: [] };
    const diff = diffImport(current(), parsed, 'replace', new Set([B]));
    expect(diff.addTrades).toEqual(['ケレン']);
    expect(diff.keptMissingTrades).toEqual(['ブラスト']);
    expect(diff.removeTrades).toEqual(['塗装', '足場']);
    expect(diff.budgetLinesCount).toBe(2);
    expect(diff.contractItemsCount).toBe(0);
  });

  it('読み替え表・進み具合の履歴（% を消した行も）で使っている工種も残す', () => {
    const data = current({
      aliases: [{ tradeText: 'ブラスト工', tradeId: B }],
      // 上書きを消した（% が null の最新の行）工種は progress に出ないが、履歴があるので消せない
      progress: [],
      progressTradeIds: [C],
    });
    const diff = diffImport(data, { trades: ['剥離'], budgetLines: [labor('剥離')], contractItems: [contract('剥離')] }, 'replace');
    expect(diff.keptMissingTrades).toEqual(['ブラスト', '塗装']);
    expect(diff.removeTrades).toEqual(['足場']);
  });

  it('入れ替えない内訳（変更の行として足す・内訳の行が無い）と、入れ替えない予算（予算の行が無い）が使う工種も残す', () => {
    const data = current({
      contractItems: [
        { id: 'i1', section: 'initial', name: 'x', spec: '', qty: 1, unit: '式', unitPrice: 1, amount: 1, tradeId: C, category: 'trade', sortOrder: 0 },
      ],
      budgetLines: [
        { id: 'l1', tradeId: D, performer: 'own', supplierId: null, item: 'labor', note: '', qty: 1, unit: '人工', unitPrice: 1, amount: 1, sortOrder: 0 },
      ],
    });
    const append = diffImport(data, { trades: ['剥離'], budgetLines: [labor('剥離')], contractItems: [contract('剥離')] }, 'appendChange');
    expect(append.keptMissingTrades).toEqual(['塗装']);
    expect(append.removeTrades).toEqual(['ブラスト', '足場']);

    const replace = diffImport(data, { trades: ['剥離'], budgetLines: [labor('剥離')], contractItems: [contract('剥離')] }, 'replace');
    expect(replace.keptMissingTrades).toEqual([]);

    const noBudget = diffImport(data, { trades: ['剥離'], budgetLines: [], contractItems: [contract('剥離')] }, 'replace');
    expect(noBudget.keptMissingTrades).toEqual(['足場']);
    expect(noBudget.budgetLinesCount).toBe(0);
  });
});

describe('取り込みの手順', () => {
  it('1 回目は消さずに足す（Excel の順 → 残す工種 → 消す工種）、2 回目で消す', () => {
    const parsed = { trades: ['ケレン', '剥離'], budgetLines: [labor('ケレン')], contractItems: [] };
    const data = current();
    const diff = diffImport(data, parsed, 'replace', new Set([B]));
    const plan = planTradeSaves(data, parsed, diff);
    expect(plan.first).toEqual([
      { id: null, name: 'ケレン' },
      { id: A, name: '剥離' },
      { id: B, name: 'ブラスト' },
      { id: C, name: '塗装' },
      { id: D, name: '足場' },
    ]);
    expect(plan.final).toEqual(plan.first.slice(0, 3));
  });

  it('消す工種が無ければ 2 回目は無い', () => {
    const parsed = { trades: ['剥離', 'ブラスト', '塗装', '足場'], budgetLines: [], contractItems: [] };
    const data = current();
    expect(planTradeSaves(data, parsed, diffImport(data, parsed, 'replace')).final).toBeNull();
  });

  it('行を Action の入力にする（工種の名前 → id、経費・減分は工種なし）', () => {
    const ids = new Map([['剥離', A]]);
    const parsed = {
      trades: ['剥離'],
      budgetLines: [labor('剥離'), { ...labor(null), item: 'material' as const }],
      contractItems: [contract('剥離'), { ...contract(null), category: 'expense' as const }],
    };
    expect(toBudgetLineInputs(parsed, ids).map((l) => l.tradeId)).toEqual([A, null]);
    expect(toContractItemInputs(parsed, ids).map((i) => [i.tradeId, i.category])).toEqual([
      [A, 'trade'],
      [null, 'expense'],
    ]);
  });
});
