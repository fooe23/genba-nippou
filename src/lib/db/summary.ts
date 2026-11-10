import 'server-only';
import type { DayTotals, LaborEntry } from '@/lib/calc/aggregate';
import { laborCountedCost, type LaborCostContext } from '@/lib/calc/labor-cost';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { loadLaborCostContext } from '@/lib/db/labor-cost';
import { listReportHeads } from '@/lib/db/reports';
import { loadSubcontractOutputs } from '@/lib/db/subcontract-output';
import { isUnnamedLabor, laborHeadcount } from '@/lib/report/unnamed-workers';
import { createServerSupabase } from '@/lib/supabase/server';

// 集計用の読み取り（RLS 前提）。日報の見出し + 明細（gn_report_lines）から区分別の合計を作る。
// 原価は明細の和（見出しの cost_total は外注の買掛を含まないので使わない。2026-11-17）。協力会社のアカウントでは外注の行が読めない。
// 労務費は労務費の決まり（src/lib/calc/labor-cost.ts）の「原価に数える分」（請負の行はうち常用の時間の分だけ）。人工は出面のまま。
// 出来高は output_total ＋ 外注の支払いのうち出来高に数える分（2026-11-11。DayTotals.subcontractOutput。協力会社には 0）。

interface LineRow {
  report_id: string;
  kind: string;
  amount: number | string | null;
  ref_id: string | null;
  name: string | null;
  man_days: number | string | null;
  overtime_hours: number | string | null;
  hours: number | string | null;
  unit_price: number | string | null;
  overtime_rate: number | string | null;
  affiliation: string | null;
  supplier_id: string | null;
  labor_contract: string | null;
  /** 買掛の区分・うち常用の時間（2026-11-17）。列の無い DB（SQL の前）では読まない（undefined）。 */
  purchase_kind?: string | null;
  jouyou_hours?: number | string | null;
  /** 人数（名前なしの作業員の行。2026-11-19）。列の無い DB（SQL の前）では読まない（undefined＝1 人）。 */
  headcount?: number | string | null;
}

const LINE_COLUMNS =
  'report_id, kind, amount, ref_id, name, man_days, overtime_hours, hours, unit_price, overtime_rate, affiliation, supplier_id, labor_contract';

// .in() の URL が長くなりすぎないよう id を分けて問い合わせる。さらに PostgREST の max_rows（既定 1000）で
// 黙って切り詰められないよう、各グループを .range() で 1000 件ずつ最後まで取る。
const ID_CHUNK = 200;
const PAGE_SIZE = 1000;

async function fetchLines(reportIds: string[]): Promise<LineRow[]> {
  if (reportIds.length === 0) return [];
  // 新しい列が無い DB（SQL の前。42703）では、無い列を外して読み直す：人数（update_2026-11-19_unnamed_workers.sql の前は 1 人）→
  // 買掛の区分・うち常用の時間（update_2026-11-17_subcontract.sql の前は区分なし＝全部が仕入・うち常用の時間なし）。
  const tries = [`${LINE_COLUMNS}, purchase_kind, jouyou_hours, headcount`, `${LINE_COLUMNS}, purchase_kind, jouyou_hours`, LINE_COLUMNS];
  for (const [i, columns] of tries.entries()) {
    try {
      return await fetchLinesWith(reportIds, columns);
    } catch (e) {
      if (!(e instanceof MissingColumnError) || i === tries.length - 1) throw e;
    }
  }
  return [];
}

class MissingColumnError extends Error {}

async function fetchLinesWith(reportIds: string[], columns: string): Promise<LineRow[]> {
  const supabase = await createServerSupabase();
  const results = await Promise.all(
    chunk(reportIds, ID_CHUNK).map((ids) =>
      fetchAllPages<LineRow>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_report_lines')
          .select(columns)
          .in('report_id', ids)
          .in('kind', ['labor', 'fuel', 'lease', 'cash', 'credit'])
          .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
          .range(from, to);
        if (error) throw error.code === '42703' ? new MissingColumnError(error.message) : new Error(error.message);
        return (data ?? []) as unknown as LineRow[];
      }, PAGE_SIZE),
    ),
  );
  return results.flat();
}

function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 労務の行の原価に数える労務費（労務費の決まり）。 */
function countedLaborCost(l: LineRow, ctx: LaborCostContext): number {
  return laborCountedCost(
    {
      affiliation: l.affiliation === 'own' || l.affiliation === 'partner' ? l.affiliation : null,
      supplierId: l.supplier_id,
      laborContract: l.labor_contract === 'jouyou' || l.labor_contract === 'ukeoi' ? l.labor_contract : null,
      jouyouHours: numOrNull(l.jouyou_hours),
      dailyRate: numOrNull(l.unit_price),
      overtimeRate: numOrNull(l.overtime_rate),
      headcount: numOrNull(l.headcount),
      stored: { amount: Number(l.amount ?? 0), manDays: Number(l.man_days ?? 0), overtimeHours: Number(l.overtime_hours ?? 0), hours: Number(l.hours ?? 0) },
    },
    ctx,
  );
}

/**
 * 現場の全期間について、日ごとの区分別合計と作業員別の出面明細を 1 回の取得で作る。
 * labor：'counted'（既定）は労務費の決まりの原価に数える分、'stored' は行の金額（出面の金額）のまま
 * （台帳 Excel の出力。雛形の式で労務費を出すので、請負の人工も入ったままにそろえる）。
 */
export async function loadSummaryData(
  siteId: string,
  opts: { labor?: 'counted' | 'stored' } = {},
): Promise<{ days: DayTotals[]; entries: LaborEntry[] }> {
  const [heads, ctx] = await Promise.all([
    listReportHeads(siteId),
    opts.labor === 'stored' ? Promise.resolve(null) : loadLaborCostContext(siteId),
  ]);
  const [lines, sub] = await Promise.all([fetchLines(heads.map((h) => h.id)), loadSubcontractOutputs(heads.map((h) => h.id))]);

  const dateById = new Map(heads.map((h) => [h.id, h.reportDate]));
  const totals = new Map<string, Pick<DayTotals, 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'subcontract' | 'workerCount'>>();
  for (const h of heads) totals.set(h.id, { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, workerCount: 0 });
  const entries: LaborEntry[] = [];

  for (const l of lines) {
    const t = totals.get(l.report_id);
    const reportDate = dateById.get(l.report_id);
    if (!t || !reportDate) continue;
    const amount = Number(l.amount ?? 0);
    switch (l.kind) {
      case 'labor': {
        const cost = ctx ? countedLaborCost(l, ctx) : amount;
        t.labor += cost;
        // 名前なし（会社と人数）の行は人数分を人数に数える。
        const headcount = laborHeadcount({ headcount: numOrNull(l.headcount) });
        t.workerCount += headcount;
        entries.push({
          reportDate,
          workerId: l.ref_id,
          workerName: l.name ?? '（名前なし）',
          headcount: isUnnamedLabor({ headcount: numOrNull(l.headcount) }) ? headcount : null,
          manDays: Number(l.man_days ?? 0),
          cost,
          overtimeHours: Number(l.overtime_hours ?? 0),
        });
        break;
      }
      case 'fuel': t.fuel += amount; break;
      case 'lease': t.lease += amount; break;
      case 'cash': t.cash += amount; break;
      case 'credit':
        // 買掛は外注（2026-11-17）も含めて credit に 1 回だけ入れ、外注の分を subcontract にも数える（うち外注）。
        t.credit += amount;
        if (l.purchase_kind === 'subcontract') t.subcontract += amount;
        break;
    }
  }

  const zero = { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, workerCount: 0 };
  const days: DayTotals[] = heads.map((h) => ({ ...h, ...(totals.get(h.id) ?? zero), subcontractOutput: sub.byReport.get(h.id)?.total ?? 0 }));
  entries.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  return { days, entries };
}

export async function loadDayTotals(siteId: string): Promise<DayTotals[]> {
  return (await loadSummaryData(siteId)).days;
}

export async function loadLaborEntries(siteId: string): Promise<LaborEntry[]> {
  return (await loadSummaryData(siteId)).entries;
}
