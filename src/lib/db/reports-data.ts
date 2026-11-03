import 'server-only';
import { fetchReportLineRows } from '@/lib/db/export';
import { listLeaseItems, listSuppliers, listVehicles, listWorkers } from '@/lib/db/masters';
import { listReportHeads } from '@/lib/db/reports';
import { getSite, listCarryovers } from '@/lib/db/sites';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import type { CostReportInput, ReportWithLines, SavedReportLine, StoredLineValues } from '@/lib/reports/types';

// 帳票用の読み取り（RLS 前提）。モデルの組み立ては src/lib/reports/cost-model.ts（純関数）。

function storedNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** DB の保存値（トリガーが計算した amount・man_days・overtime_hours）。帳票はこれだけで集計する。 */
function storedValues(r: LineRowRead): StoredLineValues {
  return { amount: storedNum(r.amount), manDays: storedNum(r.man_days), overtimeHours: storedNum(r.overtime_hours) };
}

/**
 * 工事原価集計表の入力：現場、全日報の見出し（集計画面と同じく保存済みの全状態）と保存値つき明細、繰越初期値、マスター。
 * 現場が見つからない（RLS で見えない）ときは例外。権限・削除済みの判定は呼び出し側（Route Handler）で行う。
 */
export async function loadCostReportInput(siteId: string): Promise<CostReportInput> {
  const site = await getSite(siteId);
  if (!site) throw new Error('現場が見つかりません');
  const [heads, carryovers, workers, suppliers, vehicles, leaseItems] = await Promise.all([
    listReportHeads(siteId),
    listCarryovers(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
  ]);

  const lineRows = await fetchReportLineRows(heads.map((h) => h.id));
  const linesById = new Map<string, SavedReportLine[]>(heads.map((h) => [h.id, []]));
  for (const r of lineRows) {
    const line = fromLineRow(r);
    if (line) linesById.get(r.report_id)?.push({ ...line, stored: storedValues(r) });
  }
  const reports: ReportWithLines[] = heads.map((h) => ({ ...h, lines: linesById.get(h.id) ?? [] }));

  return { site, reports, carryovers, workers, suppliers, vehicles, leaseItems };
}
