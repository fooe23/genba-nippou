import { describe, expect, it } from 'vitest';
import {
  amountFromPercent,
  subcontractContracts,
  subcontractKey,
  subcontractOverWarning,
  subcontractPaidBefore,
  subcontractProgress,
  subcontractProgressText,
  type SubcontractProgressLine,
} from '@/lib/report/subcontract-progress';

const T = 'trade-tile';
const S = 'sup-tohoku';
const K = subcontractKey(T, S);
const names = { trade: 'タイル', supplier: '東北建興' };
const sub = (amount: number, patch: Partial<SubcontractProgressLine> = {}): SubcontractProgressLine => ({
  purchaseKind: 'subcontract', siteTradeId: T, supplierId: S, issueId: null, amount, ...patch,
});

describe('請負額とこれまでの支払い', () => {
  it('実行予算の請負の行を 工種 × 会社 で足す（ほかの項目・工種や会社の無い行は数えない）', () => {
    expect(subcontractContracts([
      { item: 'subcontract', tradeId: T, supplierId: S, amount: 200000 },
      { item: 'subcontract', tradeId: T, supplierId: S, amount: 70000 },
      { item: 'jouyou', tradeId: T, supplierId: S, amount: 22000 },
      { item: 'subcontract', tradeId: null, supplierId: S, amount: 1 },
      { item: 'subcontract', tradeId: T, supplierId: null, amount: 1 },
    ])).toEqual({ [K]: 270000 });
  });
  it('ほかの日報の外注の行（件なし）を足す', () => {
    expect(subcontractPaidBefore([
      { siteTradeId: T, supplierId: S, issueId: null, amount: 100000 },
      { siteTradeId: T, supplierId: S, issueId: 'i1', amount: 50000 },
      { siteTradeId: null, supplierId: S, issueId: null, amount: 9 },
    ])).toEqual({ [K]: 100000 });
  });
});

describe('日報の外注の行の請負の進み（村山様邸）', () => {
  const view = { contracts: { [K]: 270000 }, paidBefore: { [K]: 100000 } };

  it('これまでの支払い ¥100,000 ＋ 今回 ¥170,000 ＝ ¥270,000（出来高 100%）', () => {
    const [p] = subcontractProgress([sub(170000)], view);
    expect(p).toEqual({ kind: 'contract', key: K, contract: 270000, before: 100000, current: 170000, total: 270000, percent: 100, over: false });
    expect(subcontractProgressText(p!, names)).toBe(
      'タイル・東北建興の請負額 ¥270,000（実行予算）／これまでの支払い ¥100,000 ＋ 今回 ¥170,000 ＝ ¥270,000（出来高 100%）',
    );
    expect(subcontractOverWarning(p!, names)).toBeNull();
  });

  it('同じ日報の上の行も これまでの支払い に足し、超えたら知らせる', () => {
    const ps = subcontractProgress([sub(100000), { ...sub(0), purchaseKind: 'material' }, sub(100000)], view);
    expect(ps[1]).toBeNull();
    expect(ps[2]).toMatchObject({ before: 200000, total: 300000, over: true });
    expect(subcontractOverWarning(ps[2]!, names)).toBe('タイル・東北建興の支払いの累計 ¥300,000 が請負額 ¥270,000 を超えています（¥30,000）');
  });

  it('件を選んだ外注は追加の発注で、% にも これまで にも入れない', () => {
    const ps = subcontractProgress([sub(50000, { issueId: 'i1' }), sub(10000)], view);
    expect(ps[0]).toEqual({ kind: 'issue', issueId: 'i1' });
    expect(subcontractProgressText(ps[0]!, { ...names, issue: '11/10 追加 浴室の壁' })).toBe('追加の発注（件：11/10 追加 浴室の壁）。請負額の出来高には数えません');
    expect(ps[1]).toMatchObject({ before: 100000, current: 10000 });
  });

  it('実行予算に請負額が無い、工種・支払先が無い行', () => {
    const [a, b, c] = subcontractProgress([sub(1, { supplierId: 'other' }), sub(1, { siteTradeId: null }), sub(1, { supplierId: null })], view);
    expect(a).toEqual({ kind: 'noContract', key: subcontractKey(T, 'other') });
    expect(subcontractProgressText(a!, names)).toBe('タイル・東北建興：実行予算に請負額がありません');
    expect(b).toBeNull();
    expect(c).toBeNull();
  });

  it('出来高の %：10 未満は小数 1 桁', () => {
    const [p] = subcontractProgress([sub(10000)], { contracts: { [K]: 270000 }, paidBefore: {} });
    expect(subcontractProgressText(p!, names)).toContain('（出来高 3.7%）');
  });
});

describe('今回の出来高 % → 支払金額', () => {
  it('請負額 × % を円に四捨五入', () => {
    expect(amountFromPercent(270000, 63)).toBe(170100);
    expect(amountFromPercent(270000, 33.3)).toBe(89910);
    expect(amountFromPercent(100001, 50)).toBe(50001);
    expect(amountFromPercent(270000, null)).toBeNull();
    expect(amountFromPercent(270000, -1)).toBeNull();
  });
});
