import { describe, expect, it } from 'vitest';
import { aliasMap, resolveTradeId, tradesByNameMap, unmappedTradeTexts } from '@/lib/budget/resolve-trade';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const T3 = '00000000-0000-4000-8000-000000000003';

const tradesByName = new Map([
  ['ブラスト', T1],
  ['塗装', T2],
]);
const aliases = new Map([
  ['ブラスト工', T1],
  ['（6月:作業内容欄より判定）', T3],
]);

describe('resolveTradeId', () => {
  it('参照がある行は参照（文字が別の工種の名前でも）', () => {
    expect(resolveTradeId({ siteTradeId: T3, trade: '塗装' }, aliases, tradesByName)).toBe(T3);
  });
  it('参照が無ければ読み替え表（前後の空白を除いた文字で）', () => {
    expect(resolveTradeId({ siteTradeId: null, trade: '  ブラスト工 ' }, aliases, tradesByName)).toBe(T1);
  });
  it('読み替え表は工種名より先', () => {
    const a = new Map([['塗装', T3]]);
    expect(resolveTradeId({ siteTradeId: null, trade: '塗装' }, a, tradesByName)).toBe(T3);
  });
  it('読み替え表に無ければ工種名と完全一致（前後の空白は除く）', () => {
    expect(resolveTradeId({ siteTradeId: null, trade: ' 塗装　' }, aliases, tradesByName)).toBe(T2);
    expect(resolveTradeId({ siteTradeId: null, trade: '塗装工事' }, aliases, tradesByName)).toBeNull();
  });
  it('どれも無ければ null、空の工種も null', () => {
    expect(resolveTradeId({ siteTradeId: null, trade: '足場' }, aliases, tradesByName)).toBeNull();
    expect(resolveTradeId({ siteTradeId: null, trade: '' }, aliases, tradesByName)).toBeNull();
    expect(resolveTradeId({ siteTradeId: null, trade: '   ' }, aliases, tradesByName)).toBeNull();
  });
});

describe('unmappedTradeTexts', () => {
  it('決まらない工種の文字を前後の空白を除いてまとめ、人工の多い順に並べる', () => {
    const lines = [
      { siteTradeId: null, trade: '足場', manDays: 1 },
      { siteTradeId: null, trade: ' 足場 ', manDays: 0.5 },
      { siteTradeId: null, trade: '養生', manDays: 3 },
      { siteTradeId: null, trade: '片付け', manDays: null },
      { siteTradeId: null, trade: 'ブラスト工', manDays: 5 }, // 読み替え表で決まる
      { siteTradeId: null, trade: '塗装', manDays: 5 }, // 名前で決まる
      { siteTradeId: T1, trade: '足場', manDays: 9 }, // 参照で決まる
      { siteTradeId: null, trade: '', manDays: 4 }, // 空は数えない
    ];
    expect(unmappedTradeTexts(lines, aliases, tradesByName)).toEqual([
      { text: '養生', lineCount: 1, manDays: 3 },
      { text: '足場', lineCount: 2, manDays: 1.5 },
      { text: '片付け', lineCount: 1, manDays: 0 },
    ]);
  });
  it('人工が同じなら行の多い順、それも同じなら文字の順', () => {
    const lines = [
      { siteTradeId: null, trade: 'B', manDays: 1 },
      { siteTradeId: null, trade: 'A', manDays: 1 },
      { siteTradeId: null, trade: 'C', manDays: 0.5 },
      { siteTradeId: null, trade: 'C', manDays: 0.5 },
    ];
    expect(unmappedTradeTexts(lines, new Map(), new Map()).map((u) => u.text)).toEqual(['C', 'A', 'B']);
  });
  it('人工の合計は浮動小数の誤差を丸める', () => {
    const lines = [0.1, 0.2].map((m) => ({ siteTradeId: null, trade: '足場', manDays: m }));
    expect(unmappedTradeTexts(lines, new Map(), new Map())[0].manDays).toBe(0.3);
  });
});

describe('aliasMap・tradesByNameMap', () => {
  it('前後の空白を除いた文字・名前で引ける', () => {
    expect(aliasMap([{ tradeText: ' ブラスト工 ', tradeId: T1 }]).get('ブラスト工')).toBe(T1);
    expect(tradesByNameMap([{ id: T2, name: ' 塗装 ', sortOrder: 0 }]).get('塗装')).toBe(T2);
  });
});
