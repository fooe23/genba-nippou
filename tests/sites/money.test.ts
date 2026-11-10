import { describe, expect, it } from 'vitest';
import { isMissingFunctionError, mergeSiteMoney, NO_SITE_MONEY, siteMoneyMap, toSiteMoney } from '@/lib/sites/money';
import { resolveSummaryTab, visibleSummaryTabs } from '@/components/summary/SummaryTabs';

// 現場のお金の列（gn_site_money の行・SQL 前の表の行）の読み取りと、集計のタブを見る人で絞る判定。

describe('toSiteMoney', () => {
  it('numeric の文字列を数にし、null・未定義は null', () => {
    expect(toSiteMoney({ contract_amount: '1200000', estimated_amount: 0, default_daily_rate: null })).toEqual({
      contractAmount: 1200000,
      estimatedAmount: 0,
      defaultDailyRate: null,
    });
    expect(toSiteMoney({})).toEqual(NO_SITE_MONEY);
  });
});

describe('siteMoneyMap', () => {
  it('関数の行は site_id、表の行は id を鍵にする。鍵の無い行は捨てる', () => {
    const map = siteMoneyMap([
      { site_id: 'a', contract_amount: 100, estimated_amount: null, default_daily_rate: '25000' },
      { id: 'b', contract_amount: null, estimated_amount: '50', default_daily_rate: null },
      { contract_amount: 1 },
    ]);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(map.get('a')).toEqual({ contractAmount: 100, estimatedAmount: null, defaultDailyRate: 25000 });
    expect(map.get('b')).toEqual({ contractAmount: null, estimatedAmount: 50, defaultDailyRate: null });
  });
  it('null・空は空の Map', () => {
    expect(siteMoneyMap(null).size).toBe(0);
    expect(siteMoneyMap([]).size).toBe(0);
  });
});

describe('mergeSiteMoney', () => {
  it('お金のある現場は重ね、無い現場（協力会社・読めない）は 3 つとも null', () => {
    const money = siteMoneyMap([{ site_id: 'a', contract_amount: 100, estimated_amount: 80, default_daily_rate: 20000 }]);
    expect(mergeSiteMoney({ id: 'a', name: 'A' }, money)).toEqual({
      id: 'a',
      name: 'A',
      contractAmount: 100,
      estimatedAmount: 80,
      defaultDailyRate: 20000,
    });
    expect(mergeSiteMoney({ id: 'b', name: 'B' }, money)).toEqual({ id: 'b', name: 'B', ...NO_SITE_MONEY });
    expect(mergeSiteMoney({ id: 'a', name: 'A' }, new Map())).toEqual({ id: 'a', name: 'A', ...NO_SITE_MONEY });
  });
});

describe('isMissingFunctionError', () => {
  it('関数がまだ無い（PGRST202・42883）ときだけ true', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunctionError({ code: '42883' })).toBe(true);
    expect(isMissingFunctionError({ code: '42501' })).toBe(false);
    expect(isMissingFunctionError({ code: null })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

describe('集計のタブ', () => {
  it('社員・管理者は 4 つ、協力会社は現場原価集計を出さない', () => {
    expect(visibleSummaryTabs(true).map((t) => t.key)).toEqual(['monthly', 'cost', 'attendance', 'workers']);
    expect(visibleSummaryTabs(false).map((t) => t.key)).toEqual(['monthly', 'attendance', 'workers']);
  });
  it('協力会社が ?tab=cost を開いても月次集計になる', () => {
    expect(resolveSummaryTab('cost', true)).toBe('cost');
    expect(resolveSummaryTab('cost', false)).toBe('monthly');
    expect(resolveSummaryTab('workers', false)).toBe('workers');
    expect(resolveSummaryTab(undefined, true)).toBe('monthly');
    expect(resolveSummaryTab('xxx', false)).toBe('monthly');
  });
});
