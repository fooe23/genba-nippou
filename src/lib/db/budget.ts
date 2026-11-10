import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BudgetModelInput } from '@/lib/budget/budget-model';
import type { ProgressHistoryEntry } from '@/lib/budget/budget-view';
import { aliasMap, tradesByNameMap, unmappedTradeTexts, type UnmappedTradeText } from '@/lib/budget/resolve-trade';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { loadProfileNames } from '@/lib/db/export';
import { listSuppliers } from '@/lib/db/masters';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { listReportHeads } from '@/lib/db/reports';
import { withLines } from '@/lib/db/reports-data';
import { getSettings } from '@/lib/db/settings';
import { listCarryovers, listSitePartners } from '@/lib/db/sites';
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

/** 履歴から工種ごとの最新の行を選ぶ（rows は set_at の新しい順、同じ日時は id の順）。最新が「上書きを消した」（null）なら含めない。 */
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
      .select('id, trade_id, percent, set_by, set_at')
      .eq('site_id', siteId)
      .order('set_at', { ascending: false })
      // 同じ日時の行は id で並びを固定する（履歴 loadProgressHistory と同じ並び。その先頭を最新とみなす）
      .order('id', { ascending: true }),
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

/**
 * その現場の実行予算で請負の行に入っている会社の id（gn_site_ukeoi_suppliers。金額は読まない。協力会社のアカウントも読める）。
 * 日報で新しく足す協力会社の作業員の行の「常用／請負」の既定に使う（決めたこと A）。関数が無い（SQL の前）・読めないときは空。
 */
export async function loadUkeoiSupplierIds(siteId: string): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('gn_site_ukeoi_suppliers', { p_site: siteId });
  if (error) return [];
  return ((data ?? []) as { supplier_id: string | null }[]).flatMap((r) => (r.supplier_id ? [r.supplier_id] : []));
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

const REPORT_CHUNK = 200;

/** 日報の作業内容の行の工種の参照・工種の文字・投入人工だけを読む（日報 200 件ずつ、1000 行ずつ）。 */
async function readWorkTradeLines(
  reportIds: string[],
): Promise<{ siteTradeId: string | null; trade: string; manDays: number | null }[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(reportIds, REPORT_CHUNK).map((part) =>
      fetchAllPages<Record<string, unknown>>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_report_lines')
          .select('trade, man_days, site_trade_id')
          .in('report_id', part)
          .eq('kind', 'work')
          .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as Record<string, unknown>[];
      }),
    ),
  );
  return pages.flat().map((r) => {
    const md = r.man_days === null || r.man_days === undefined || r.man_days === '' ? null : Number(r.man_days);
    return { siteTradeId: idOrNull(r.site_trade_id), trade: str(r.trade), manDays: md !== null && Number.isFinite(md) ? md : null };
  });
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
  const work = await readWorkTradeLines(heads.map((h) => h.id));
  return unmappedTradeTexts(work, aliasMap(aliases), tradesByNameMap(trades));
}

/**
 * 予算と実績の集計（buildBudgetModel）の入力：予算一式、現場の全日報（保存済みの全状態）の保存値つき明細（労務の行の
 * 所属・会社の写しと金額・人工を含む）、予算の標準日当、現場の協力会社（請負金額）、取引先の名前。
 * asOf（YYYY-MM-DD）までの日報を数えるのは buildBudgetModel。社員・管理者以外（協力会社・未ログイン）には null。
 */
export async function loadBudgetModelInput(siteId: string, asOf: string): Promise<BudgetModelInput | null> {
  const profile = await getCurrentProfile();
  if (!profile || !isEmployeeOrAdmin(profile)) return null;
  const [data, heads, settings, sitePartners, suppliers, carryovers] = await Promise.all([
    loadBudgetData(siteId),
    listReportHeads(siteId),
    getSettings(),
    listSitePartners(siteId),
    listSuppliers(),
    listCarryovers(siteId),
  ]);
  // asOf より後の日報は数えないので、明細も読まない
  const reports = await withLines(heads.filter((h) => h.reportDate <= asOf));
  return {
    data,
    reports: reports.map((r) => ({ date: r.reportDate, lines: r.lines })),
    dailyRate: settings.budgetDailyRate,
    asOf,
    sitePartners: sitePartners.map((p) => ({ supplierId: p.supplierId, name: p.supplierName, amount: p.amount })),
    supplierNames: Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
    carryovers,
    laborRule: settings.rule,
  };
}

/**
 * 工種ごとの進み具合の上書きの履歴（新しい順に perTrade 件まで）。入れた人の氏名は gn_profile_names で読む。
 * 社員・管理者以外には空。
 */
export async function loadProgressHistory(siteId: string, perTrade = 5): Promise<Record<string, ProgressHistoryEntry[]>> {
  const profile = await getCurrentProfile();
  if (!profile || !isEmployeeOrAdmin(profile)) return {};
  const supabase = await createServerSupabase();
  const rows = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
    const { data, error } = await supabase
      .from('gn_trade_progress')
      .select('id, trade_id, percent, set_by, set_at')
      .eq('site_id', siteId)
      .order('set_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  });
  const byTrade: Record<string, Omit<ProgressHistoryEntry, 'setByName'>[]> = {};
  for (const r of rows) {
    const list = (byTrade[str(r.trade_id)] ??= []);
    if (list.length >= perTrade) continue;
    list.push({
      percent: r.percent === null || r.percent === undefined ? null : num(r.percent),
      setBy: idOrNull(r.set_by),
      setAt: str(r.set_at),
    });
  }
  const ids = Object.values(byTrade).flatMap((list) => list.map((e) => e.setBy).filter((v): v is string => v !== null));
  const names = await loadProfileNames(ids);
  return Object.fromEntries(
    Object.entries(byTrade).map(([tradeId, list]) => [
      tradeId,
      list.map((e) => ({ ...e, setByName: e.setBy ? (names[e.setBy] ?? '') : '' })),
    ]),
  );
}
