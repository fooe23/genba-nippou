import 'server-only';
import type { DayTotals, LaborEntry } from '@/lib/calc/aggregate';
import { listReportHeads } from '@/lib/db/reports';
import { createServerSupabase } from '@/lib/supabase/server';

// 集計用の読み取り（RLS 前提）。日報の見出し + 明細（gn_report_lines）から区分別の合計を作る。

interface LineRow {
  report_id: string;
  kind: string;
  amount: number | string | null;
  ref_id: string | null;
  name: string | null;
  man_days: number | string | null;
}

// .in() の URL が長くなりすぎないよう、id を分けて問い合わせる。
const CHUNK = 200;

async function fetchLines(reportIds: string[]): Promise<LineRow[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const chunks: string[][] = [];
  for (let i = 0; i < reportIds.length; i += CHUNK) chunks.push(reportIds.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map(async (ids) => {
      const { data, error } = await supabase
        .from('gn_report_lines')
        .select('report_id, kind, amount, ref_id, name, man_days')
        .in('report_id', ids)
        .in('kind', ['labor', 'fuel', 'lease', 'cash', 'credit']);
      if (error) throw new Error(error.message);
      return (data ?? []) as LineRow[];
    }),
  );
  return results.flat();
}

/** 現場の全期間について、日ごとの区分別合計と作業員別の出面明細を 1 回の取得で作る。 */
export async function loadSummaryData(siteId: string): Promise<{ days: DayTotals[]; entries: LaborEntry[] }> {
  const heads = await listReportHeads(siteId);
  const lines = await fetchLines(heads.map((h) => h.id));

  const dateById = new Map(heads.map((h) => [h.id, h.reportDate]));
  const totals = new Map<string, Pick<DayTotals, 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'workerCount'>>();
  for (const h of heads) totals.set(h.id, { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0 });
  const entries: LaborEntry[] = [];

  for (const l of lines) {
    const t = totals.get(l.report_id);
    const reportDate = dateById.get(l.report_id);
    if (!t || !reportDate) continue;
    const amount = Number(l.amount ?? 0);
    switch (l.kind) {
      case 'labor':
        t.labor += amount;
        t.workerCount += 1;
        entries.push({
          reportDate,
          workerId: l.ref_id,
          workerName: l.name ?? '（名前なし）',
          manDays: Number(l.man_days ?? 0),
          cost: amount,
        });
        break;
      case 'fuel': t.fuel += amount; break;
      case 'lease': t.lease += amount; break;
      case 'cash': t.cash += amount; break;
      case 'credit': t.credit += amount; break;
    }
  }

  const zero = { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0 };
  const days: DayTotals[] = heads.map((h) => ({ ...h, ...(totals.get(h.id) ?? zero) }));
  entries.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return { days, entries };
}

export async function loadDayTotals(siteId: string): Promise<DayTotals[]> {
  return (await loadSummaryData(siteId)).days;
}

export async function loadLaborEntries(siteId: string): Promise<LaborEntry[]> {
  return (await loadSummaryData(siteId)).entries;
}
