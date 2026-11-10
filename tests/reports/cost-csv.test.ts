import { describe, it, expect } from 'vitest';
import { buildCostCsv } from '@/lib/reports/cost-csv';
import { buildCostReport } from '@/lib/reports/cost-model';
import { costSections } from '@/lib/reports/cost-sections';
import { costInput, emptyModel, NOW, RATES, sampleModel } from './cost-fixture';

/** BOM と CRLF を外して行に分ける（最後の空要素は除く）。 */
function lines(csv: string): string[] {
  expect(csv.startsWith('﻿')).toBe(true);
  const body = csv.slice(1);
  expect(body.endsWith('\r\n')).toBe(true);
  return body.slice(0, -2).split('\r\n');
}

/** 空行で区切ったセクションの 1 行目。 */
function sectionNames(rows: string[]): string[] {
  const names = [rows[0]];
  rows.forEach((r, i) => {
    if (r === '' && rows[i + 1] !== undefined) names.push(rows[i + 1]);
  });
  return names.map((n) => n.split(',')[0]);
}

describe('buildCostCsv', () => {
  it('見出し → ①〜⑦ → 署名欄の順に、空行で区切ったセクション', () => {
    const rows = lines(buildCostCsv(sampleModel()));
    expect(sectionNames(rows)).toEqual([
      '工事原価集計表',
      '① 原価合計',
      '② 採算',
      '③ 月別推移',
      '④ 作業員別累計',
      '④-2 所属別の人工・労務費',
      '⑤ 取引先別累計',
      '⑥ 車両・リース',
      '⑦ 工種別出来高',
      '署名欄',
    ]);
  });

  it('見出しの値は必要なときだけ " で囲む', () => {
    const rows = lines(buildCostCsv(sampleModel()));
    expect(rows).toContain('現場名,〇〇邸新築工事');
    expect(rows).toContain('工事概要,"木造 2 階建て ""在来"""');
    expect(rows).toContain('集計期間,工期全体（2026/10/20〜2026/11/02）');
  });

  it('① はセクション名・列見出し・費目・合計の行。金額は桁区切りなし、構成比は % の数値（小数 1 桁）', () => {
    const rows = lines(buildCostCsv(sampleModel()));
    const i = rows.indexOf('① 原価合計');
    expect(rows.slice(i, i + 8)).toEqual([
      '① 原価合計',
      '費目,金額(円),構成比(%)',
      '労務費,66000,62.4',
      '車両費（燃料）,1428,1.3',
      'リース費,6000,5.7',
      '現金購入費,2400,2.3',
      '買掛費,30000,28.3',
      '原価合計,105828,100',
    ]);
  });

  it('手入力・取引先なし・工種なし・「—」（空欄）', () => {
    const csv = buildCostCsv(sampleModel());
    expect(csv).toContain('飛び込み 鈴木（手入力）,,所属なし,2,2,0,30000\r\n');
    expect(csv).toContain('（取引先なし）,2400,0,2400\r\n');
    expect(csv).toContain('（工種なし）,片付け,,,0,,0,0\r\n');
  });

  it('月指定の推移は週ごと（MM/DD〜MM/DD）', () => {
    const rows = lines(buildCostCsv(sampleModel({ kind: 'month', month: '2026-11' })));
    expect(sectionNames(rows)).toContain('③ 週別推移');
    expect(rows.some((r) => r.startsWith('11/02〜11/08,1,'))).toBe(true);
  });

  it('日報 0 件：見出しと「日報がありません」の 1 行だけ（セクションは出さない）', () => {
    const rows = lines(buildCostCsv(emptyModel()));
    expect(rows[0]).toBe('工事原価集計表');
    expect(rows.at(-1)).toBe('日報がありません');
    expect(rows.filter((r) => r === '日報がありません')).toHaveLength(1);
    expect(rows.some((r) => /^[①②③④⑤⑥⑦]/.test(r))).toBe(false);
  });
});

describe('② 採算の追加・増・変更・減の提案額と「概算に対する見込み」', () => {
  const profit = (model: ReturnType<typeof sampleModel>) => costSections(model).find((x) => x.title === '② 採算')!;

  it('提案額の行（行が無ければ「—」= null。CSV は空欄）。契約確定なら注記なし', () => {
    const m = sampleModel();
    expect(m.profit.changeProposal).toBeNull();
    const s = profit(m);
    expect(s.note).toBeUndefined();
    expect(s.tables[0].rows.map((r) => r[0])).toContain('進捗率（出来高÷請負）(%)');
    expect(s.tables[0].rows).toContainEqual(['追加・増・変更・減の精算額（円）', { value: null, fmt: 'yen' }]);
    expect(lines(buildCostCsv(m))).toContain('追加・増・変更・減の精算額（円）,');
  });

  it('契約未確定（basis estimate）：見出しに「概算に対する見込み」、概算金額の行、進捗率は累計原価÷概算', () => {
    const base = sampleModel({ kind: 'month', month: '2026-11' });
    const m = { ...base, profit: { ...base.profit, basis: 'estimate' as const, estimatedAmount: 800_000, changeProposal: 12_650 } };
    const s = profit(m);
    expect(s.note).toBe('概算に対する見込み・2026年11月末までの累計');
    const labels = s.tables[0].rows.map((r) => r[0]);
    expect(labels).toContain('概算金額(円)');
    expect(labels).toContain('進捗率（累計原価÷概算）(%)');
    expect(labels).not.toContain('進捗率（出来高÷請負）(%)');
    expect(s.tables[0].rows).toContainEqual(['追加・増・変更・減の精算額（円）', { value: 12_650, fmt: 'yen' }]);
  });
});

describe('buildCostCsv ④-2 所属別', () => {
  it('所属別の表を出し、取引先名の数式の注入は先頭に \' を付ける。請負金額の無い行は空欄', () => {
    const input = { ...costInput(), sitePartners: [{ supplierId: 'pX', supplierName: '=HYPERLINK("x")', amount: null }, { supplierId: 'pY', supplierName: '山本工業', amount: 80_000 }] };
    const csv = buildCostCsv(buildCostReport(input, { kind: 'all' }, NOW, RATES));
    expect(csv).toContain('所属,常用人工,常用労務費(円),請負人工(出面),合計人工,外注支払い(円),請負金額(円),差額(円)\r\n');
    expect(csv).toContain('自社,2,36000,0,2,0,,\r\n');
    expect(csv).toContain('"\'=HYPERLINK(""x"")",0,0,0,0,0,,\r\n');
    // 差額 ＝ 請負金額 − 外注の支払い（外注の買掛なし）
    expect(csv).toContain('山本工業,0,0,0,0,0,80000,80000\r\n');
    expect(csv).toContain('所属なし,2,30000,0,2,0,,\r\n');
  });
});
