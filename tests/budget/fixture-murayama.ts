import type { BudgetModelInput } from '@/lib/budget/budget-model';
import type { BudgetData, BudgetLine } from '@/lib/budget/types';
import type { SavedReportLine } from '@/lib/reports/types';
import { credit, own, partner, work } from './fixture-nakano';

// 予算と実績の集計のテスト用：村山様邸（設計書 docs/superpowers/specs/2026-11-10-subcontract-issue-costs-design.md の例、
// 見本 .superpowers/brainstorm/24602-1794232833/content/subcontract-1.html の ③）。
// 工種 タイル（内訳 ¥783,000）。実行予算：東北建興・請負 1 式 ¥270,000、自社・労務 2.0 人工 × ¥20,000。進み具合の上書き 40%。

export const T_TILE = '00000000-0000-4000-8000-0000000000e1';
export const SP_TOHOKU = '00000000-0000-4000-8000-0000000000f1'; // 東北建興
export const SP_ZAI = '00000000-0000-4000-8000-0000000000f2'; // 〇〇建材

/** 協力会社の作業員の行で、保存した区分が請負（うち常用の時間つき）。実働 8 H・1.0 人工・日当 ¥22,000。 */
export function ukeoi(supplierId: string, name: string, jouyouHours: number | null): SavedReportLine {
  const l = partner(supplierId, name, 22000, 1);
  return { ...l, laborContract: 'ukeoi', jouyouHours } as SavedReportLine;
}

/** 外注の買掛（工種・件つき）。 */
export function subcontract(amount: number, opts: { tradeId?: string | null; supplierId?: string | null; vendor?: string; issueId?: string | null } = {}): SavedReportLine {
  return {
    ...credit(amount),
    itemName: 'タイル工事',
    supplierId: opts.supplierId === undefined ? SP_TOHOKU : opts.supplierId,
    vendor: opts.vendor ?? '',
    purchaseKind: 'subcontract',
    siteTradeId: opts.tradeId === undefined ? T_TILE : opts.tradeId,
    issueId: opts.issueId ?? null,
  } as SavedReportLine;
}

/** 仕入の買掛（タイル 200 角 2 箱 × ¥9,000）。 */
export function material(amount = 18000): SavedReportLine {
  return { ...credit(amount), itemName: 'タイル 200角', supplierId: SP_ZAI, unit: '箱', qty: 2, unitPrice: amount / 2 } as SavedReportLine;
}

const bl = (p: Partial<BudgetLine> & Pick<BudgetLine, 'id' | 'item' | 'qty' | 'unitPrice'>): BudgetLine => ({
  tradeId: T_TILE,
  performer: 'own',
  supplierId: null,
  note: '',
  unit: '',
  amount: Math.round(p.qty * p.unitPrice),
  sortOrder: 0,
  ...p,
});

export function murayamaData(): BudgetData {
  return {
    trades: [{ id: T_TILE, name: 'タイル', sortOrder: 1 }],
    contractItems: [
      { id: 'mc1', section: 'initial', name: 'タイル張り', spec: '', qty: 1, unit: '式', unitPrice: 783000, amount: 783000, tradeId: T_TILE, category: 'trade', sortOrder: 1 },
    ],
    budgetLines: [
      bl({ id: 'mb1', performer: 'partner', supplierId: SP_TOHOKU, item: 'subcontract', qty: 1, unit: '式', unitPrice: 270000, sortOrder: 1 }),
      bl({ id: 'mb2', item: 'labor', qty: 2, unit: '人工', unitPrice: 20000, sortOrder: 2 }),
    ],
    aliases: [],
    progress: [{ tradeId: T_TILE, percent: 40, setBy: null, setAt: '2026-11-10T00:00:00Z' }],
    progressTradeIds: [T_TILE],
  };
}

/**
 * 日報：
 * - 11/09 作業内容 タイル 投入 2.0。大江（自社）1.0 人工 ¥20,000、A さん（東北建興・請負、うち常用 4.0 H）、
 *   B さん（東北建興・請負、うち常用 空欄）。外注 タイル工事 東北建興 ¥100,000、仕入 タイル 200角 ¥18,000。
 * - 11/10 作業内容 タイル 投入 0.5。大江 0.5 人工 ¥10,000。
 */
export function murayamaInput(overrides: Partial<BudgetModelInput> = {}): BudgetModelInput {
  return {
    data: murayamaData(),
    reports: [
      {
        date: '2026-11-09',
        lines: [
          own('大江', 20000, 1),
          ukeoi(SP_TOHOKU, 'A', 4),
          ukeoi(SP_TOHOKU, 'B', null),
          work({ tradeId: T_TILE, trade: 'タイル', manDays: 2 }),
          subcontract(100000),
          material(),
        ],
      },
      { date: '2026-11-10', lines: [own('大江', 10000, 0.5), work({ tradeId: T_TILE, trade: 'タイル', manDays: 0.5 })] },
    ],
    dailyRate: 20000,
    asOf: '2026-11-11',
    sitePartners: [{ supplierId: SP_TOHOKU, name: '東北建興', amount: null }],
    supplierNames: { [SP_TOHOKU]: '東北建興', [SP_ZAI]: '〇〇建材' },
    ...overrides,
  };
}
