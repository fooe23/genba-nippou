import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { aliasMap, tradesByNameMap, unmappedTradeTexts, type UnmappedTradeText } from '@/lib/budget/resolve-trade';
import { fetchReportLineRows } from '@/lib/db/export';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { listReportHeads } from '@/lib/db/reports';
import { fromLineRow } from '@/lib/report/rows';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  BUDGET_ITEMS,
  BUDGET_PERFORMERS,
  CONTRACT_CATEGORIES,
  CONTRACT_SECTIONS,
  emptyBudgetData,
  type BudgetData,
  type BudgetItem,
  type BudgetLine,
  type BudgetPerformer,
  type ContractCategory,
  type ContractItem,
  type ContractSection,
  type SiteTrade,
  type TradeAlias,
  type TradeProgress,
} from '@/lib/budget/types';

// 積算連携の読み取り（RLS 前提）。書き込みは budget-actions.ts（Server Actions）。
// 金額の表（内訳・予算・進み具合）は RLS で社員・管理者だけが読める。ここでも社員・管理者以外には読みに行かず空を返す。

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function idOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}
function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return (list as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

async function readTrades(supabase: SupabaseClient, siteId: string): Promise<SiteTrade[]> {
  const { data, error } = await supabase
    .from('gn_site_trades')
    .select('id, name, sort_order')
    .eq('site_id', siteId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: str(r.id), name: str(r.name), sortOrder: num(r.sort_order) }));
}

async function readAliases(supabase: SupabaseClient, siteId: string): Promise<TradeAlias[]> {
  const { data, error } = await supabase
    .from('gn_trade_aliases')
    .select('trade_text, trade_id')
    .eq('site_id', siteId)
    .order('trade_text', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ tradeText: str(r.trade_text), tradeId: str(r.trade_id) }));
}

/** 現場の工種（日報で選ぶため、協力会社を含む現場メンバーが読める）。 */
export async function loadSiteTrades(siteId: string): Promise<SiteTrade[]> {
  const supabase = await createServerSupabase();
  return readTrades(supabase, siteId);
}

/** 現場の読み替え表（日報の工種の文字 → 工種。現場メンバーが読める）。 */
export async function loadTradeAliases(siteId: string): Promise<TradeAlias[]> {
  const supabase = await createServerSupabase();
  return readAliases(supabase, siteId);
}

/** 履歴から工種ごとの最新の行を選ぶ（rows は set_at の新しい順）。最新が「上書きを消した」（null）なら含めない。 */
function latestProgress(rows: Record<string, unknown>[]): TradeProgress[] {
  const seen = new Set<string>();
  const out: TradeProgress[] = [];
  for (const r of rows) {
    const tradeId = str(r.trade_id);
    if (seen.has(tradeId)) continue;
    seen.add(tradeId);
    if (r.percent === null || r.percent === undefined) continue;
    out.push({ tradeId, percent: num(r.percent), setBy: idOrNull(r.set_by), setAt: str(r.set_at) });
  }
  return out;
}

/**
 * 予算の画面・集計が読むもの一式（工種・元請けの内訳・実行予算・読み替え表・進み具合の上書き）。
 * 社員・管理者以外（協力会社・未ログイン）が呼べば空を返す。
 */
export async function loadBudgetData(siteId: string): Promise<BudgetData> {
  const profile = await getCurrentProfile();
  if (!profile || !isEmployeeOrAdmin(profile)) return emptyBudgetData();
  const supabase = await createServerSupabase();
  const [trades, aliases, items, lines, progress] = await Promise.all([
    readTrades(supabase, siteId),
    readAliases(supabase, siteId),
    supabase
      .from('gn_contract_items')
      .select('id, section, name, spec, qty, unit, unit_price, amount, trade_id, category, sort_order')
      .eq('site_id', siteId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('gn_budget_lines')
      .select('id, trade_id, performer, supplier_id, item, note, qty, unit, unit_price, amount, sort_order')
      .eq('site_id', siteId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('gn_trade_progress')
      .select('trade_id, percent, set_by, set_at')
      .eq('site_id', siteId)
      .order('set_at', { ascending: false }),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (lines.error) throw new Error(lines.error.message);
  if (progress.error) throw new Error(progress.error.message);

  const contractItems: ContractItem[] = ((items.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: str(r.id),
    section: oneOf<ContractSection>(CONTRACT_SECTIONS, r.section, 'initial'),
    name: str(r.name),
    spec: str(r.spec),
    qty: num(r.qty),
    unit: str(r.unit),
    unitPrice: num(r.unit_price),
    amount: num(r.amount),
    tradeId: idOrNull(r.trade_id),
    category: oneOf<ContractCategory>(CONTRACT_CATEGORIES, r.category, 'trade'),
    sortOrder: num(r.sort_order),
  }));
  const budgetLines: BudgetLine[] = ((lines.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: str(r.id),
    tradeId: idOrNull(r.trade_id),
    performer: oneOf<BudgetPerformer>(BUDGET_PERFORMERS, r.performer, 'own'),
    supplierId: idOrNull(r.supplier_id),
    item: oneOf<BudgetItem>(BUDGET_ITEMS, r.item, 'other'),
    note: str(r.note),
    qty: num(r.qty),
    unit: str(r.unit),
    unitPrice: num(r.unit_price),
    amount: num(r.amount),
    sortOrder: num(r.sort_order),
  }));
  return {
    trades,
    contractItems,
    budgetLines,
    aliases,
    progress: latestProgress((progress.data ?? []) as Record<string, unknown>[]),
    progressTradeIds: [...new Set(((progress.data ?? []) as Record<string, unknown>[]).map((r) => str(r.trade_id)))],
  };
}

const USED_CHUNK = 100;
const USED_PAGE = 1000;

/**
 * 日報の作業内容の行から使われている工種の id（取り込みで消さない工種を決めるため）。社員・管理者だけが呼ぶ。
 * 工種 100 件ずつ .in で読み、見つかった工種を外して読み直す（1 回の上限 1000 行に 1 つの工種の行が並んでも、
 * 次の回でほかの工種を探せる）。工種は現場のものなので、現場で絞らなくてよい。
 */
export async function loadUsedTradeIds(tradeIds: string[]): Promise<string[]> {
  const found = new Set<string>();
  if (tradeIds.length === 0) return [];
  const supabase = await createServerSupabase();
  for (let i = 0; i < tradeIds.length; i += USED_CHUNK) {
    let remaining = tradeIds.slice(i, i + USED_CHUNK);
    while (remaining.length > 0) {
      const { data, error } = await supabase
        .from('gn_report_lines')
        .select('site_trade_id')
        .in('site_trade_id', remaining)
        .limit(USED_PAGE);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { site_trade_id: string | null }[];
      for (const r of rows) if (r.site_trade_id) found.add(r.site_trade_id);
      if (rows.length < USED_PAGE) break;
      remaining = remaining.filter((id) => !found.has(id));
    }
  }
  return tradeIds.filter((id) => found.has(id));
}

/**
 * まだ工種に決まらない日報の工種の文字（読み替え表の候補）：現場の全日報（保存済みの全状態）の作業内容の行のうち、
 * 参照・読み替え表・工種名のどれでも決まらないもの。人工の多い順。社員・管理者以外には空。
 * trades・aliases を渡せば読み直さない（呼び出し側で loadBudgetData 済みのとき）。
 */
export async function loadUnmappedTradeTexts(
  siteId: string,
  known?: { trades: SiteTrade[]; aliases: TradeAlias[] },
): Promise<UnmappedTradeText[]> {
  const profile = await getCurrentProfile();
  if (!profile || !isEmployeeOrAdmin(profile)) return [];
  const [heads, trades, aliases] = await Promise.all([
    listReportHeads(siteId),
    known ? Promise.resolve(known.trades) : loadSiteTrades(siteId),
    known ? Promise.resolve(known.aliases) : loadTradeAliases(siteId),
  ]);
  const rows = await fetchReportLineRows(heads.map((h) => h.id));
  const work = rows.flatMap((r) => {
    const line = fromLineRow(r);
    return line && line.kind === 'work' ? [line] : [];
  });
  return unmappedTradeTexts(work, aliasMap(aliases), tradesByNameMap(trades));
}
