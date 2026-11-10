import { describe, expect, it } from 'vitest';
import { buildBudgetModel } from '@/lib/budget/budget-model';
import { budgetReportSections, budgetSummaryTable, progressText, statusText } from '@/lib/budget/report-sections';
import { budgetLinesTable, budgetSetupSections, contractByTradeTable, contractItemsTable } from '@/lib/budget/setup-sections';
import { emptyBudgetData } from '@/lib/budget/types';
import { renderBudgetReportPdf } from '@/lib/pdf/budget-report-pdf';
import { renderBudgetSetupPdf } from '@/lib/pdf/budget-setup-pdf';
import { formatCell, type Cell } from '@/lib/reports/cost-sections';
import { SP_PAINT, SP_TWO, nakanoData, nakanoInput } from './fixture-nakano';
import { murayamaInput, subcontract } from './fixture-murayama';
import { budgetPerformerTable } from '@/lib/budget/report-sections';

const meta = { siteName: '中野橋', projectNo: '0612', outputAt: '2026-10-10T03:00:00Z' };
const names = { [SP_PAINT]: '〇〇塗装', [SP_TWO]: '△△工業' };
const text = (c: Cell) => formatCell(c);

describe('予算と実績の帳票の表（budgetReportSections）', () => {
  const model = buildBudgetModel(nakanoInput());

  it('欄は ① 工種ごと ② 施工者の明細 ③ 現場全体', () => {
    expect(budgetReportSections(model).map((s) => s.title)).toEqual([
      '予算と実績（工種ごと）',
      '工種ごとの施工者の明細',
      '現場全体（材料・リース・燃料・その他）',
    ]);
  });

  it('① は画面と同じ列・判定、予算外・現場全体・合計', () => {
    const t = budgetSummaryTable(model);
    expect(t.columns.map((c) => c.label)).toEqual([
      '工種', '内訳の金額', '実行予算', '予算の人工', '実績', '実績の人工', '進み具合', '数量から %', 'このままの見込み', '見込みの粗利', '判定',
    ]);
    expect(t.rows.map((r) => r[0])).toEqual([...model.trades.map((x) => x.name), '予算外の作業', '現場全体（内訳は経費）']);
    const paint = model.trades[1];
    expect(t.rows[1][6]).toBe('40%（上書き）');
    expect(t.rows[1][10]).toBe(statusText(paint));
    expect(text(t.total![1])).toBe(model.total.contractAmount.toLocaleString('ja-JP'));
    expect(t.after?.map((r) => r[0])).toEqual(['うち減分', 'うち工種なしの内訳']);
  });

  it('② 村山様邸：請負 → 自社・労務 → 常用（請負外）→ 出面 → 小計、請負額を超えたら備考と判定に出す', () => {
    const t = budgetPerformerTable(buildBudgetModel(murayamaInput()));
    expect(t.rows.map((r) => r[1])).toEqual(['東北建興・請負', '自社・労務', '東北建興・常用（請負外）', '出面', '小計', '小計']);
    const input = murayamaInput();
    input.reports[1].lines.push(subcontract(200000));
    const over = buildBudgetModel(input);
    const row = budgetPerformerTable(over).rows[0];
    expect(row[9]).toBe('請負額を超えています・見込み＝支払い');
    expect(statusText(over.trades[0])).toBe('予算超え・請負額を超えています');
  });

  it('判定の文字：内訳の識別がまだなら注記つき', () => {
    expect(statusText({ status: 'none', forecast: 1000, contractItemCount: 0 })).toBe('—（内訳の識別がまだです）');
    expect(statusText({ status: 'loss', forecast: 1000, contractItemCount: 2 })).toBe('赤字の見込み');
    expect(progressText({ used: null, fromQty: null, override: null })).toBe('—');
    expect(progressText({ used: 62.5, fromQty: 62.5, override: null })).toBe('63%'); // 画面と同じ書式（10 以上は整数）
    expect(progressText({ used: 7.5, fromQty: 7.5, override: null })).toBe('7.5%');
  });

  it('② は工種ごとの小計が太字、小計の和＝合計', () => {
    const t = budgetReportSections(model)[1].tables[0];
    const subtotals = t.boldRows!.map((i) => t.rows[i]);
    expect(subtotals.every((r) => r[1] === '小計')).toBe(true);
    expect(subtotals).toHaveLength(model.trades.length + 1);
    const sum = subtotals.reduce((s, r) => s + ((r[5] as { value: number }).value ?? 0), 0);
    expect((t.total![5] as { value: number }).value).toBe(sum);
  });
});

describe('実行予算・内訳の帳票の表（budgetSetupSections）', () => {
  const data = nakanoData();

  it('実行予算：工種ごとの行と小計、予算外・現場全体、合計は全行の和', () => {
    const t = budgetLinesTable(data, names);
    const subtotalNames = t.boldRows!.map((i) => t.rows[i][0]);
    expect(subtotalNames).toEqual(['ブラスト', '塗装', '足場', 'シール', '工種なし（予算外）', '（現場全体）']);
    expect(t.rows.find((r) => r[0] === '塗装')?.[1]).toBe('〇〇塗装');
    expect(t.rows.find((r) => r[0] === 'シール')?.[3]).toBe('（行なし）');
    expect((t.total![7] as { value: number }).value).toBe(data.budgetLines.reduce((s, l) => s + l.amount, 0));
  });

  it('受注の内訳：区分・識別の文字、工種ごとの当初・変更', () => {
    const items = contractItemsTable(data);
    expect(items.rows.map((r) => r[7])).toEqual(['ブラスト', 'ブラスト', '塗装', '塗装', '足場', 'シール', '（未識別）', '経費', '減分']);
    const byTrade = contractByTradeTable(data);
    const blast = byTrade.rows.find((r) => r[0] === 'ブラスト')!;
    expect(blast.slice(1).map(text)).toEqual(['1,800,000', '450,000', '2,250,000']);
    expect(byTrade.rows.map((r) => r[0])).toContain('まだ識別していない行');
    expect(text(byTrade.total![3])).toBe(text(items.total![6]));
  });

  it('空の予算でも欄は 3 つ', () => {
    expect(budgetSetupSections(emptyBudgetData(), {})).toHaveLength(3);
    expect(budgetLinesTable(emptyBudgetData(), {}).rows).toEqual([]);
  });
});

describe('PDF の生成', () => {
  it('予算と実績・実行予算と内訳は %PDF の Buffer を返し、Noto Sans JP を埋め込む', async () => {
    const report = await renderBudgetReportPdf(buildBudgetModel(nakanoInput()), meta);
    expect(Buffer.isBuffer(report)).toBe(true);
    expect(report.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(report.toString('latin1')).toContain('NotoSansJP');
    const setup = await renderBudgetSetupPdf(nakanoData(), names, 20000, meta);
    expect(setup.subarray(0, 4).toString('latin1')).toBe('%PDF');
    const empty = await renderBudgetSetupPdf(emptyBudgetData(), {}, 20000, meta);
    expect(empty.subarray(0, 4).toString('latin1')).toBe('%PDF');
  }, 60_000);
});
