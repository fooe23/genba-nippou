import type { BudgetModel, PerformerRow, TradeRow } from '@/lib/budget/budget-model';
import { outsideTag, percentText, statusNote, statusTag } from '@/lib/budget/budget-view';
import { jpDateTime } from '@/lib/calc/format';
import { cell, col, slashDate, type Cell, type CostSection, type SectionTable } from '@/lib/reports/cost-sections';

// 予算と実績の帳票（集計 Excel の ①②・PDF）の表を、PDF・Excel 共通の形（cost-sections.ts の SectionTable）にする（純関数）。
// 値は数値のまま持ち、書式（NumFmt）だけ決める。列は画面の表（BudgetTable）と同じ順。

export const BUDGET_REPORT_TITLE = '予算と実績';

/** 帳票の見出しに出す現場と作成の情報。 */
export interface BudgetReportMeta {
  siteName: string;
  /** 工事番号（無ければ null）。 */
  projectNo: string | null;
  /** 作成日時（ISO 8601）。 */
  outputAt: string;
}

const { yen, qty, pct } = cell;

/** 見出しの項目（ラベル, 値）。 */
export function budgetReportHeader(model: BudgetModel, meta: BudgetReportMeta): [string, string | null][] {
  return [
    ['現場名', meta.siteName],
    ['工事番号', meta.projectNo],
    ['集計の範囲', `工期全体・${slashDate(model.asOf)} までの日報`],
    ['予算の標準日当', `${model.dailyRate.toLocaleString('ja-JP')} 円／人工`],
    ['作成日時', jpDateTime(meta.outputAt)],
  ];
}

/** 判定の文字（札と注記。例「赤字の見込み」「—（内訳の識別がまだです）」）。 */
export function statusText(t: Pick<TradeRow, 'status' | 'forecast' | 'contractItemCount'>): string {
  const label = statusTag(t.status).label;
  const note = statusNote(t);
  return note ? `${label}（${note}）` : label;
}

/** 進み具合の文字（使っている %。上書きなら「上書き」を添える）。 */
export function progressText(p: TradeRow['progress']): string {
  if (p.used === null) return '—';
  return p.override !== null ? `${percentText(p.used)}（上書き）` : percentText(p.used);
}

const SUMMARY_COLUMNS = [
  col.text('工種', 3.2),
  col.num('内訳の金額', 2.3),
  col.num('実行予算', 2.3),
  col.num('予算の人工', 1.6),
  col.num('実績', 2.3),
  col.num('実績の人工', 1.6),
  col.num('進み具合', 1.9),
  col.num('数量から %', 1.6),
  col.num('このままの見込み', 2.3),
  col.num('見込みの粗利', 2.3),
  col.text('判定', 2.4),
];

/** ① 予算と実績：工種ごと・予算外の作業・繰越・現場全体・合計（画面の表と同じ列。人工は別の列）。 */
export function budgetSummaryTable(model: BudgetModel): SectionTable {
  const { outside, siteWide, total } = model;
  const rows: Cell[][] = model.trades.map((t) => [
    t.name,
    yen(t.contractAmount),
    yen(t.budget.amount),
    qty(t.budget.manDays),
    yen(t.actual.amount),
    qty(t.actual.manDays),
    progressText(t.progress),
    pct(t.progress.fromQty === null ? null : t.progress.fromQty / 100),
    yen(t.forecast),
    yen(t.forecastProfit),
    statusText(t),
  ]);
  const outTag = outsideTag(outside.amount);
  rows.push([
    '予算外の作業',
    null,
    outside.budget.amount !== 0 ? yen(outside.budget.amount) : null,
    outside.budget.manDays !== 0 ? qty(outside.budget.manDays) : null,
    yen(outside.amount),
    qty(outside.manDays),
    '',
    '',
    '',
    outside.amount !== 0 ? yen(-outside.amount) : '',
    outTag ? outTag.label : '',
  ]);
  if (outside.carryover) {
    rows.push(['繰越（工種なし）', '', '', '', yen(outside.carryover.amount), qty(outside.carryover.manDays), '', '', '', '', '']);
  }
  rows.push([
    '現場全体（内訳は経費）',
    yen(siteWide.contractExpense),
    yen(siteWide.budget.amount),
    '',
    yen(siteWide.actual.amount),
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  const after: Cell[][] = [];
  if (total.contractReduction !== 0) after.push(['うち減分', yen(total.contractReduction), '', '', '', '', '', '', '', '', '']);
  if (total.contractUnassigned !== 0) {
    after.push(['うち工種なしの内訳', yen(total.contractUnassigned), '', '', '', '', '', '', '', '', '']);
  }
  return {
    columns: SUMMARY_COLUMNS,
    rows,
    total: ['合計', yen(total.contractAmount), yen(total.budgetAmount), '', yen(total.actualAmount), qty(total.actualManDays), '', '', '', '', ''],
    ...(after.length > 0 ? { after } : {}),
  };
}

const PERFORMER_COLUMNS = [
  col.text('工種', 2.6),
  col.text('施工者', 2.8),
  col.num('予算の人工', 1.6),
  col.num('実行予算', 2.2),
  col.num('実績の人工', 1.6),
  col.num('実績（労務費）', 2.2),
  col.num('予算 − 実績', 2.2),
  col.num('請負金額（現場全体）', 2.4),
];

function performerName(p: PerformerRow): string {
  return p.performer === 'partner' ? `${p.name}（協力会社）` : p.name;
}

function performerRow(trade: string, p: PerformerRow): Cell[] {
  return [
    trade,
    performerName(p),
    qty(p.budgetManDays),
    yen(p.budgetAmount),
    qty(p.actualManDays),
    yen(p.actualAmount),
    yen(p.budgetAmount - p.actualAmount),
    p.performer === 'partner' ? yen(p.partnerContract) : '',
  ];
}

/**
 * ② 工種ごとの施工者の明細：工種の下に自社・協力会社の行（予算の人工・金額、実績の人工・労務費）、工種ごとの小計（太字）、
 * 予算外の作業、合計。請負金額は現場の協力会社の欄の額（現場全体。工種に分けない）。
 */
export function budgetPerformerTable(model: BudgetModel): SectionTable {
  const rows: Cell[][] = [];
  const boldRows: number[] = [];
  const subtotal = (label: string, budgetManDays: number | null, budgetAmount: number, actualManDays: number, actualAmount: number) => {
    boldRows.push(rows.length);
    rows.push([label, '小計', qty(budgetManDays), yen(budgetAmount), qty(actualManDays), yen(actualAmount), yen(budgetAmount - actualAmount), '']);
  };
  for (const t of model.trades) {
    t.budget.byPerformer.forEach((p, i) => rows.push(performerRow(i === 0 ? t.name : '', p)));
    subtotal(t.name, t.budget.manDays, t.budget.amount, t.actual.manDays, t.actual.amount);
  }
  const { outside } = model;
  outside.byPerformer.forEach((p, i) => rows.push(performerRow(i === 0 ? '予算外の作業' : '', p)));
  subtotal('予算外の作業', outside.budget.manDays, outside.budget.amount, outside.manDays, outside.amount);

  const budgetManDays = model.trades.reduce((s, t) => s + t.budget.manDays, 0) + outside.budget.manDays;
  const budgetAmount = model.trades.reduce((s, t) => s + t.budget.amount, 0) + outside.budget.amount;
  const actualManDays = model.trades.reduce((s, t) => s + t.actual.manDays, 0) + outside.manDays;
  const actualAmount = model.trades.reduce((s, t) => s + t.actual.amount, 0) + outside.amount;
  return {
    columns: PERFORMER_COLUMNS,
    rows,
    boldRows,
    total: [
      '合計（繰越・現場全体を除く）',
      '',
      qty(Math.round(budgetManDays * 100) / 100),
      yen(budgetAmount),
      qty(Math.round(actualManDays * 100) / 100),
      yen(actualAmount),
      yen(budgetAmount - actualAmount),
      '',
    ],
  };
}

/** 現場全体の内わけ：実行予算（材料・リース・その他）と実績（燃料・リース・現金・掛け）。 */
export function budgetSiteWideTable(model: BudgetModel): SectionTable {
  const { budget, actual } = model.siteWide;
  return {
    columns: [col.text('項目', 3), col.num('実行予算', 2), col.num('実績', 2)],
    rows: [
      ['材料', yen(budget.material), null],
      ['リース', yen(budget.lease), yen(actual.lease)],
      ['その他', yen(budget.other), null],
      ['燃料', null, yen(actual.fuel)],
      ['現金（材料など）', null, yen(actual.cash)],
      ['掛け（材料など）', null, yen(actual.credit)],
    ],
    total: ['合計', yen(budget.amount), yen(actual.amount)],
  };
}

/** 予算と実績の帳票の欄（PDF の本文。集計 Excel の ① ② も同じ表）。 */
export function budgetReportSections(model: BudgetModel): CostSection[] {
  return [
    {
      title: '予算と実績（工種ごと）',
      note: '見込み＝実績 ÷ 進み具合、見込みの粗利＝内訳の金額 − 見込み',
      tables: [budgetSummaryTable(model)],
    },
    {
      title: '工種ごとの施工者の明細',
      note: '実績は日報の労務費を工種に振り分けた分。請負金額は現場全体の額',
      tables: [budgetPerformerTable(model)],
    },
    { title: '現場全体（材料・リース・燃料・その他）', tables: [budgetSiteWideTable(model)] },
  ];
}
