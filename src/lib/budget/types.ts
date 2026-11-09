// 積算連携（元請けの内訳・実行予算・読み替え表・進み具合の上書き）の型。
// DB の表：gn_site_trades・gn_contract_items・gn_budget_lines・gn_trade_aliases・gn_trade_progress（update_2026-11-15_budget.sql）。
// 金額（内訳・予算・進み具合）を読めるのは社員・管理者だけ。協力会社のアカウントは工種の名前と読み替え表だけ読める。

/** 元請けの内訳の区分：当初・変更。 */
export const CONTRACT_SECTIONS = ['initial', 'change'] as const;
export type ContractSection = (typeof CONTRACT_SECTIONS)[number];
/** 元請けの内訳の識別：工種・経費・減分（経費・減分は工種に入れず、内訳の金額の合計にだけ数える）。 */
export const CONTRACT_CATEGORIES = ['trade', 'expense', 'reduction'] as const;
export type ContractCategory = (typeof CONTRACT_CATEGORIES)[number];
/** 実行予算の施工者：自社・協力会社。 */
export const BUDGET_PERFORMERS = ['own', 'partner'] as const;
export type BudgetPerformer = (typeof BUDGET_PERFORMERS)[number];
/** 実行予算の項目：労務・請負・常用・材料・リース・その他。 */
export const BUDGET_ITEMS = ['labor', 'subcontract', 'jouyou', 'material', 'lease', 'other'] as const;
export type BudgetItem = (typeof BUDGET_ITEMS)[number];
/** 現場全体でまとめる項目（工種に分けない）。 */
export const SITE_WIDE_ITEMS: readonly BudgetItem[] = ['material', 'lease', 'other'];
/** 協力会社（施工者＝partner・会社が必須）の項目。 */
export const PARTNER_ITEMS: readonly BudgetItem[] = ['subcontract', 'jouyou'];

export const CONTRACT_SECTION_LABEL: Record<ContractSection, string> = { initial: '当初', change: '変更' };
export const CONTRACT_CATEGORY_LABEL: Record<ContractCategory, string> = { trade: '工種', expense: '経費', reduction: '減分' };
export const BUDGET_PERFORMER_LABEL: Record<BudgetPerformer, string> = { own: '自社', partner: '協力会社' };
export const BUDGET_ITEM_LABEL: Record<BudgetItem, string> = {
  labor: '労務',
  subcontract: '請負',
  jouyou: '常用',
  material: '材料',
  lease: 'リース',
  other: 'その他',
};

/** 現場の工種（実行予算の工種）。 */
export interface SiteTrade {
  id: string;
  name: string;
  sortOrder: number;
}

/** 元請けの内訳の行。amount は DB が計算した round(数量 × 単価)。tradeId は識別が工種の行だけ（null＝まだ識別していない）。 */
export interface ContractItem {
  id: string;
  section: ContractSection;
  name: string;
  spec: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  tradeId: string | null;
  category: ContractCategory;
  sortOrder: number;
}

/** 実行予算の行。tradeId が null なら現場全体。supplierId は請負・常用（協力会社）の行だけ。amount は DB の計算値。 */
export interface BudgetLine {
  id: string;
  tradeId: string | null;
  performer: BudgetPerformer;
  supplierId: string | null;
  item: BudgetItem;
  note: string;
  qty: number;
  unit: string;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

/** 読み替え表の 1 行：日報の工種の文字 → 実行予算の工種。 */
export interface TradeAlias {
  tradeText: string;
  tradeId: string;
}

/** 工種ごとの進み具合の上書き（いま有効な＝最新の行。上書きを消した工種は含めない）。 */
export interface TradeProgress {
  tradeId: string;
  percent: number;
  /** 入れた人（profiles.id）。SQL Editor から入れた行は null。 */
  setBy: string | null;
  setAt: string;
}

/** 予算の画面・集計が読むもの一式（社員・管理者以外には空）。 */
export interface BudgetData {
  trades: SiteTrade[];
  contractItems: ContractItem[];
  budgetLines: BudgetLine[];
  aliases: TradeAlias[];
  progress: TradeProgress[];
  /** 進み具合の履歴が 1 行でもある工種の id（% が null の行も含む。DB のガードと同じく、この工種は消せない）。 */
  progressTradeIds: string[];
}

export function emptyBudgetData(): BudgetData {
  return { trades: [], contractItems: [], budgetLines: [], aliases: [], progress: [], progressTradeIds: [] };
}
