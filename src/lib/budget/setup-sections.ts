import type { BudgetReportMeta } from '@/lib/budget/report-sections';
import {
  BUDGET_ITEM_LABEL,
  CONTRACT_CATEGORY_LABEL,
  CONTRACT_SECTION_LABEL,
  SITE_WIDE_ITEMS,
  type BudgetData,
  type BudgetLine,
} from '@/lib/budget/types';
import { jpDateTime } from '@/lib/calc/format';
import { cell, col, type Cell, type CostSection, type SectionTable } from '@/lib/reports/cost-sections';

// 実行予算・受注の内訳の帳票（PDF。⑥ の内訳の表は集計 Excel でも使う）の表を、PDF・Excel 共通の形にする（純関数）。

export const BUDGET_SETUP_TITLE = '実行予算・受注の内訳';

const { yen, qty } = cell;

/** 見出しの項目（ラベル, 値）。 */
export function budgetSetupHeader(meta: BudgetReportMeta, dailyRate: number): [string, string | null][] {
  return [
    ['現場名', meta.siteName],
    ['工事番号', meta.projectNo],
    ['予算の標準日当', `${dailyRate.toLocaleString('ja-JP')} 円／人工`],
    ['作成日時', jpDateTime(meta.outputAt)],
  ];
}

const BUDGET_COLUMNS = [
  col.text('工種', 2.2),
  col.text('施工者', 2.4),
  col.text('項目', 1),
  col.text('内容・メモ', 3.2),
  col.num('数量', 1.3),
  col.text('単位', 0.9),
  col.num('単価', 1.6),
  col.num('金額', 2),
];

/**
 * 実行予算：工種の並びに、その工種の行（施工者・項目・内容・数量・単位・単価・金額）と小計（太字）。続いて工種の無い労務などの行
 * （予算外）、現場全体（材料・リース・その他）、合計。行の無い工種は「（行なし）」の 1 行と小計 0。
 */
export function budgetLinesTable(data: Pick<BudgetData, 'trades' | 'budgetLines'>, supplierNames: Readonly<Record<string, string>>): SectionTable {
  const rows: Cell[][] = [];
  const boldRows: number[] = [];
  const lines = [...data.budgetLines].sort((a, b) => a.sortOrder - b.sortOrder);
  const tradeIds = new Set(data.trades.map((t) => t.id));
  const performer = (l: BudgetLine) =>
    l.performer === 'partner' ? (l.supplierId ? supplierNames[l.supplierId] || '協力会社' : '協力会社') : SITE_WIDE_ITEMS.includes(l.item) ? '—' : '自社';
  const group = (name: string, list: BudgetLine[], showEmpty: boolean) => {
    if (list.length === 0 && !showEmpty) return;
    if (list.length === 0) rows.push([name, '', '', '（行なし）', '', '', '', yen(0)]);
    list.forEach((l, i) =>
      rows.push([i === 0 ? name : '', performer(l), BUDGET_ITEM_LABEL[l.item], l.note, qty(l.qty), l.unit, qty(l.unitPrice), yen(l.amount)]),
    );
    boldRows.push(rows.length);
    rows.push([name, '小計', '', '', '', '', '', yen(list.reduce((s, l) => s + l.amount, 0))]);
  };
  for (const t of [...data.trades].sort((a, b) => a.sortOrder - b.sortOrder)) {
    group(t.name, lines.filter((l) => l.tradeId === t.id), true);
  }
  group(
    '工種なし（予算外）',
    lines.filter((l) => !SITE_WIDE_ITEMS.includes(l.item) && (l.tradeId === null || !tradeIds.has(l.tradeId))),
    false,
  );
  group('（現場全体）', lines.filter((l) => SITE_WIDE_ITEMS.includes(l.item)), false);
  return {
    columns: BUDGET_COLUMNS,
    rows,
    boldRows,
    total: ['合計', '', '', '', '', '', '', yen(lines.reduce((s, l) => s + l.amount, 0))],
  };
}

/** 受注の内訳の行（区分・名称・規格・数量・単位・単価・金額・工種（識別））と合計。 */
export function contractItemsTable(data: Pick<BudgetData, 'trades' | 'contractItems'>): SectionTable {
  const names = new Map(data.trades.map((t) => [t.id, t.name]));
  const items = [...data.contractItems].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    columns: [
      col.text('区分', 0.9),
      col.text('名称', 3.6),
      col.text('規格・仕様', 2),
      col.num('数量', 1.3),
      col.text('単位', 0.9),
      col.num('単価', 1.6),
      col.num('金額', 2),
      col.text('工種（識別）', 2),
    ],
    rows: items.map((c) => [
      CONTRACT_SECTION_LABEL[c.section],
      c.name,
      c.spec,
      qty(c.qty),
      c.unit,
      qty(c.unitPrice),
      yen(c.amount),
      c.category === 'trade' ? (c.tradeId ? (names.get(c.tradeId) ?? '（工種なし）') : '（未識別）') : CONTRACT_CATEGORY_LABEL[c.category],
    ]),
    total: ['合計', '', '', '', '', '', yen(items.reduce((s, c) => s + c.amount, 0)), ''],
  };
}

/** 工種ごとの内訳の金額（当初・変更・計）と、経費・減分・まだ識別していない行、合計。 */
export function contractByTradeTable(data: Pick<BudgetData, 'trades' | 'contractItems'>): SectionTable {
  const tradeIds = new Set(data.trades.map((t) => t.id));
  const sum = (pred: (c: BudgetData['contractItems'][number]) => boolean) => {
    const list = data.contractItems.filter(pred);
    const initial = list.filter((c) => c.section === 'initial').reduce((s, c) => s + c.amount, 0);
    const change = list.filter((c) => c.section === 'change').reduce((s, c) => s + c.amount, 0);
    return [yen(initial), yen(change), yen(initial + change)];
  };
  const rows: Cell[][] = [...data.trades]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => [t.name, ...sum((c) => c.category === 'trade' && c.tradeId === t.id)]);
  rows.push(['経費（工種に入れない）', ...sum((c) => c.category === 'expense')]);
  rows.push(['減分（工種に入れない）', ...sum((c) => c.category === 'reduction')]);
  const unassigned = data.contractItems.filter((c) => c.category === 'trade' && (!c.tradeId || !tradeIds.has(c.tradeId)));
  if (unassigned.length > 0) rows.push(['まだ識別していない行', ...sum((c) => unassigned.includes(c))]);
  return {
    columns: [col.text('工種', 3), col.num('当初', 2), col.num('変更', 2), col.num('計', 2)],
    rows,
    total: ['合計', ...sum(() => true)],
  };
}

/** 実行予算・受注の内訳の帳票の欄。 */
export function budgetSetupSections(data: BudgetData, supplierNames: Readonly<Record<string, string>>): CostSection[] {
  return [
    {
      title: '実行予算',
      note: '工種ごとの施工者の行。材料・リース・その他は現場全体',
      tables: [budgetLinesTable(data, supplierNames)],
    },
    {
      title: '受注の内訳',
      note: '経費・減分は工種に入れず、内訳の金額の合計にだけ数える',
      tables: [contractItemsTable(data)],
    },
    { title: '工種ごとの内訳の金額', tables: [contractByTradeTable(data)] },
  ];
}
