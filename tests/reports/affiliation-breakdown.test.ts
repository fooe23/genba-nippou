import { describe, it, expect } from 'vitest';
import {
  affiliationGroup,
  affiliationManDaysText,
  apportionManDays,
  dayAffiliationWeights,
  sumAffiliationManDays,
  type AffiliationManDays,
} from '@/lib/reports/affiliation-breakdown';

const names = { sA: '〇〇工業', sB: 'あさひ建設' };
const own = (manDays: number): AffiliationManDays => ({ key: 'own', kind: 'own', supplierId: null, label: '自社', manDays });
const partner = (id: 'sA' | 'sB', manDays: number): AffiliationManDays => ({ key: `partner:${id}`, kind: 'partner', supplierId: id, label: names[id], manDays });
const sum = (parts: AffiliationManDays[]) => Math.round(parts.reduce((s, p) => s + p.manDays, 0) * 1e9) / 1e9;

describe('affiliationGroup（行の写しから所属）', () => {
  it('自社／取引先名／所属なし。名前の引けない協力会社は「協力会社」', () => {
    expect(affiliationGroup({ affiliation: 'own' }, names).label).toBe('自社');
    expect(affiliationGroup({ affiliation: 'partner', supplierId: 'sA' }, names)).toMatchObject({ key: 'partner:sA', label: '〇〇工業' });
    expect(affiliationGroup({ affiliation: 'partner', supplierId: 'zz' }, names).label).toBe('協力会社');
    expect(affiliationGroup({ affiliation: null }, names)).toMatchObject({ key: 'none', label: '所属なし' });
    expect(affiliationGroup({}, names).kind).toBe('none');
  });
});

describe('apportionManDays（作業内容の人工を、その日の労務の行の所属別の人工比で按分）', () => {
  it('比で分け、和は元の人工と一致する', () => {
    const parts = apportionManDays(3.5, [own(2), partner('sA', 1.5)]);
    expect(parts.map((p) => [p.label, p.manDays])).toEqual([
      ['自社', 2],
      ['〇〇工業', 1.5],
    ]);
    expect(sum(parts)).toBe(3.5);
  });

  it('割り切れない分（0.01 未満）は最も大きい所属に足す。和は元の人工と一致', () => {
    // 1 を 3 社で 1:1:1 → 0.33・0.33 と、端数を受けた先頭（並びの先＝自社）0.34
    const parts = apportionManDays(1, [own(1), partner('sA', 1), partner('sB', 1)]);
    expect(parts.map((p) => [p.label, p.manDays])).toEqual([
      ['自社', 0.34],
      ['〇〇工業', 0.33], // 協力会社は名前順（localeCompare 'ja'。〇 はひらがなより先）
      ['あさひ建設', 0.33],
    ]);
    expect(sum(parts)).toBe(1);
    // 重みの大きい所属が端数を受ける
    const big = apportionManDays(0.5, [own(1), partner('sA', 2)]);
    expect(big.map((p) => [p.label, p.manDays])).toEqual([
      ['自社', 0.16],
      ['〇〇工業', 0.34],
    ]);
    expect(sum(big)).toBe(0.5);
  });

  it('いろいろな人工・比で、和はいつも元の人工と一致する', () => {
    for (const manDays of [0.1, 0.25, 0.7, 1.3, 2.75, 7.15, 12.5]) {
      for (const w of [[own(1), partner('sA', 2), partner('sB', 4)], [own(0.3), partner('sA', 0.7)], [own(1.25), partner('sB', 0.5)]]) {
        expect(sum(apportionManDays(manDays, w))).toBe(manDays);
      }
    }
  });

  it('その日に労務の行が無い（重みの合計 0）なら全部を所属なし', () => {
    expect(apportionManDays(1.5, []).map((p) => [p.label, p.manDays])).toEqual([['所属なし', 1.5]]);
    expect(apportionManDays(1.5, [own(0)]).map((p) => [p.label, p.manDays])).toEqual([['所属なし', 1.5]]);
  });

  it('人工 0 なら空', () => {
    expect(apportionManDays(0, [own(1)])).toEqual([]);
  });
});

describe('dayAffiliationWeights・sumAffiliationManDays・affiliationManDaysText', () => {
  it('労務の行だけを所属ごとに足す（会社ごと）', () => {
    const weights = dayAffiliationWeights(
      [
        { kind: 'labor', affiliation: 'own', stored: { manDays: 1 } },
        { kind: 'labor', affiliation: 'partner', supplierId: 'sA', stored: { manDays: 1 } },
        { kind: 'labor', affiliation: 'partner', supplierId: 'sA', stored: { manDays: 0.5 } },
        { kind: 'labor', affiliation: null, stored: { manDays: 1 } },
        { kind: 'work', stored: { manDays: 9 } },
      ],
      names,
    );
    expect(weights.map((w) => [w.label, w.manDays])).toEqual([
      ['自社', 1],
      ['〇〇工業', 1.5],
      ['所属なし', 1],
    ]);
  });

  it('足し合わせて「自社 2.0／〇〇工業 1.5」', () => {
    const total = sumAffiliationManDays([[own(1.2), partner('sA', 0.5)], [own(0.8), partner('sA', 1)]]);
    expect(affiliationManDaysText(total)).toBe('自社 2.0／〇〇工業 1.5');
    expect(affiliationManDaysText([own(0.25)])).toBe('自社 0.25');
    expect(affiliationManDaysText([])).toBe('');
  });
});
