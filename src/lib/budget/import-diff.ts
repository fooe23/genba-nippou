import type { BudgetLineInput, ContractItemInput, ContractMode, TradeInput } from '@/lib/budget/schemas';
import type { ParsedBudgetWorkbook } from '@/lib/budget/parse-template';
import type { BudgetData } from '@/lib/budget/types';

// 取り込み前の差分と、取り込みの手順（純関数）。工種は名前で突き合わせる。
// * Excel に新しい名前 → 足す（addTrades）。
// * Excel に無い工種 → 使われていなければ消す（removeTrades）、使われていれば残して知らせる（keptMissingTrades）。
//   「使われている」＝日報の作業内容の行・読み替え表・進み具合の上書き、それに取り込みで入れ替えない予算・内訳の行。
// * 実行予算の行は全部入れ替える。受注の内訳は mode（全部入れ替える／変更の行として足す）。
// * 行の無いシート（または無いシート）は変えない（空の雛形を取り込んで予算や内訳を消してしまわないため）。

export interface ImportDiff {
  addTrades: string[];
  keptMissingTrades: string[];
  removeTrades: string[];
  /** 入れ替える実行予算の行の数（0＝実行予算は変えない）。 */
  budgetLinesCount: number;
  /** 入れる受注の内訳の行の数（0＝内訳は変えない）。 */
  contractItemsCount: number;
}

type Parsed = Pick<ParsedBudgetWorkbook, 'trades' | 'budgetLines' | 'contractItems'>;

/** 取り込みで残す（消さない）工種の id。 */
function usedIds(current: BudgetData, parsed: Parsed, mode: ContractMode, usedTradeIds: ReadonlySet<string>): Set<string> {
  const used = new Set(usedTradeIds);
  for (const a of current.aliases) used.add(a.tradeId);
  for (const id of current.progressTradeIds) used.add(id);
  if (parsed.budgetLines.length === 0) {
    for (const l of current.budgetLines) if (l.tradeId) used.add(l.tradeId);
  }
  if (parsed.contractItems.length === 0 || mode === 'appendChange') {
    for (const i of current.contractItems) if (i.tradeId) used.add(i.tradeId);
  }
  return used;
}

/**
 * 取り込み前の差分。usedTradeIds は日報の作業内容の行から使われている工種（loadUsedTradeIds）。
 * 読み替え表・進み具合の上書き・入れ替えない予算と内訳から使われている工種は current から数える。
 */
export function diffImport(
  current: BudgetData,
  parsed: Parsed,
  mode: ContractMode,
  usedTradeIds: ReadonlySet<string> = new Set(),
): ImportDiff {
  const excel = new Set(parsed.trades);
  const currentNames = new Set(current.trades.map((t) => t.name));
  const used = usedIds(current, parsed, mode, usedTradeIds);
  const missing = [...current.trades].sort((a, b) => a.sortOrder - b.sortOrder).filter((t) => !excel.has(t.name));
  return {
    addTrades: parsed.trades.filter((n) => !currentNames.has(n)),
    keptMissingTrades: missing.filter((t) => used.has(t.id)).map((t) => t.name),
    removeTrades: missing.filter((t) => !used.has(t.id)).map((t) => t.name),
    budgetLinesCount: parsed.budgetLines.length,
    contractItemsCount: parsed.contractItems.length,
  };
}

/**
 * 工種の保存の 2 回分。first＝消さずに足す・並べる（取り込みの前。予算・内訳が新しい工種の id を指せるように）、
 * final＝消す工種を除いたもの（予算・内訳を入れ替えた後）。消す工種が無ければ final は null。
 * 並び：Excel の順、続いて残す工種（今の順）。
 */
export function planTradeSaves(current: BudgetData, parsed: Parsed, diff: ImportDiff): { first: TradeInput[]; final: TradeInput[] | null } {
  const byName = new Map(current.trades.map((t) => [t.name, t.id]));
  const ordered = [...current.trades].sort((a, b) => a.sortOrder - b.sortOrder);
  const keep: TradeInput[] = [
    ...parsed.trades.map((name) => ({ id: byName.get(name) ?? null, name })),
    ...ordered.filter((t) => diff.keptMissingTrades.includes(t.name)).map((t) => ({ id: t.id, name: t.name })),
  ];
  const removed = ordered.filter((t) => diff.removeTrades.includes(t.name)).map((t) => ({ id: t.id, name: t.name }));
  return { first: [...keep, ...removed], final: removed.length > 0 ? keep : null };
}

/** 取り込んだ予算の行を Action の入力にする（tradeIds は工種の名前 → id。first の保存の結果から）。 */
export function toBudgetLineInputs(parsed: Parsed, tradeIds: ReadonlyMap<string, string>): BudgetLineInput[] {
  return parsed.budgetLines.map((l) => ({
    tradeId: l.tradeName === null ? null : (tradeIds.get(l.tradeName) ?? null),
    performer: l.performer,
    supplierId: l.supplierId,
    item: l.item,
    note: l.note,
    qty: l.qty,
    unit: l.unit,
    unitPrice: l.unitPrice,
  }));
}

/** 取り込んだ内訳の行を Action の入力にする。 */
export function toContractItemInputs(parsed: Parsed, tradeIds: ReadonlyMap<string, string>): ContractItemInput[] {
  return parsed.contractItems.map((i) => ({
    section: i.section,
    name: i.name,
    spec: i.spec,
    qty: i.qty,
    unit: i.unit,
    unitPrice: i.unitPrice,
    category: i.category,
    tradeId: i.category === 'trade' && i.tradeName !== null ? (tradeIds.get(i.tradeName) ?? null) : null,
  }));
}
