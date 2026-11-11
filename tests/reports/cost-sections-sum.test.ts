import { describe, it, expect } from 'vitest';
import { cellNumber, costSections, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { CostReportModel } from '@/lib/reports/types';
import { sampleModel } from './cost-fixture';
import { ledgerModel } from './ledger-fixture';

// 合計の行のうち「行の値の足し算」になっている列の印（sumColumns。現場管理台帳の Excel で SUM の式にする）。

/** Excel に書く数値（文字・空欄・「—」は 0）。 */
function n(c: Cell): number {
  if (c === null || typeof c === 'string' || c.value === null) return 0;
  return cellNumber(c.value, c.fmt, false);
}

const cents = (v: number) => Math.round(v * 100);

const models: [string, CostReportModel][] = [
  ['sample 工期全体', sampleModel()],
  ['sample 月', sampleModel({ kind: 'month', month: '2026-11' })],
  ['〇〇様邸 工期全体', ledgerModel()],
  ['〇〇様邸 月', ledgerModel({ kind: 'month', month: '2026-11' })],
];

function tables(model: CostReportModel): [string, SectionTable][] {
  return costSections(model).flatMap((s) => s.tables.map((t, i) => [`${s.title}#${i}`, t] as [string, SectionTable]));
}

describe('sumColumns', () => {
  for (const [name, model] of models) {
    it(`${name}：印の列は 合計 ＝ 行の値の和`, () => {
      let checked = 0;
      for (const [title, t] of tables(model)) {
        for (const c of t.sumColumns ?? []) {
          const total = t.total![c];
          if (total === null || typeof total === 'string') continue;
          const sum = t.rows.reduce((s, r) => s + n(r[c]), 0);
          expect(cents(sum), `${title} 列 ${t.columns[c].label}`).toBe(cents(n(total)));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  }

  it('構成比・進捗率・累計原価の列には印が無い。合計の行のある表には印がある', () => {
    for (const [title, t] of tables(sampleModel())) {
      const labels = (t.sumColumns ?? []).map((c) => t.columns[c].label);
      expect(labels.filter((l) => /構成比|進捗率|累計原価|歩掛/.test(l)), title).toEqual([]);
      if (t.total) expect(t.sumColumns?.length ?? 0, title).toBeGreaterThan(0);
      expect((t.sumColumns ?? []).every((c) => t.columns[c].num), title).toBe(true);
    }
  });

  it('列の目安（① 金額、③ 原価合計・出来高、⑦ 投入人工・出来高）', () => {
    const s = costSections(sampleModel());
    const labels = (title: string, i = 0) => {
      const t = s.find((x) => x.title.startsWith(title))!.tables[i];
      return (t.sumColumns ?? []).map((c) => t.columns[c].label);
    };
    expect(labels('①')).toEqual(['金額(円)']);
    expect(labels('③')).toEqual(['日報件数', '労務費', '車両費', 'リース費', '現金購入', '買掛', '原価合計', '出来高']);
    expect(labels('④ ')).toEqual(['出勤日数', '人工', '残業H', '労務費(円)']);
    expect(labels('⑥', 1)).toEqual(['リース費(円)']);
    expect(labels('⑦')).toEqual(['投入人工', '出来高(円)']);
  });
});
