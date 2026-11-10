import 'server-only';
import type { BudgetLine } from '@/lib/budget/types';
import { EMPTY_LABOR_COST_CONTEXT, laborCostContextFrom, type LaborCostContext } from '@/lib/calc/labor-cost';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { getSettings } from '@/lib/db/settings';
import { createServerSupabase } from '@/lib/supabase/server';

// 労務費の決まり（src/lib/calc/labor-cost.ts）の材料の読み取り（RLS 前提。2026-11-17）。

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

/**
 * 労務費の決まり（src/lib/calc/labor-cost.ts）に使う現場ごとの材料（2026-11-17）：労務の計算設定と、会社ごとの実行予算の
 * 常用の単価。単価は社員・管理者だけ（協力会社のアカウントには空。行の日当で数える）。
 */
export async function loadLaborCostContext(siteId: string): Promise<LaborCostContext> {
  return (await loadLaborCostContexts([siteId])).get(siteId) ?? EMPTY_LABOR_COST_CONTEXT;
}

/** loadLaborCostContext を複数の現場についてまとめて読む（承認待ちの一覧）。 */
export async function loadLaborCostContexts(siteIds: string[]): Promise<Map<string, LaborCostContext>> {
  const ids = [...new Set(siteIds)];
  const [profile, settings] = await Promise.all([getCurrentProfile(), getSettings()]);
  const out = new Map<string, LaborCostContext>(ids.map((id) => [id, { jouyouRates: {}, rule: settings.rule }]));
  if (ids.length === 0 || !profile || !isEmployeeOrAdmin(profile)) return out;
  const supabase = await createServerSupabase();
  const rows = (
    await Promise.all(
      chunk(ids, 100).map((part) =>
        fetchAllPages<Record<string, unknown>>(async (from, to) => {
          const { data, error } = await supabase
            .from('gn_budget_lines')
            .select('id, site_id, supplier_id, unit_price, sort_order')
            .in('site_id', part)
            .eq('item', 'jouyou')
            .order('id', { ascending: true })
            .range(from, to);
          if (error) throw new Error(error.message);
          return (data ?? []) as Record<string, unknown>[];
        }),
      ),
    )
  ).flat();
  const bySite = new Map<string, BudgetLine[]>();
  for (const r of rows) {
    const list = bySite.get(str(r.site_id)) ?? [];
    list.push({
      id: str(r.id),
      tradeId: null,
      performer: 'partner',
      supplierId: idOrNull(r.supplier_id),
      item: 'jouyou',
      note: '',
      qty: 0,
      unit: '',
      unitPrice: num(r.unit_price),
      amount: 0,
      sortOrder: num(r.sort_order),
    });
    bySite.set(str(r.site_id), list);
  }
  for (const [siteId, lines] of bySite) out.set(siteId, laborCostContextFrom(lines, settings.rule));
  return out;
}
