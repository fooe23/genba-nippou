import 'server-only';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { listLeaseItems, listSuppliers, listVehicles, listWorkers } from '@/lib/db/masters';
import { toStatus } from '@/lib/db/reports';
import { getSettings } from '@/lib/db/settings';
import { getSite, getSiteMasters, listCarryovers } from '@/lib/db/sites';
import { loadSummaryData } from '@/lib/db/summary';
import type { ExportInput, ExportReport } from '@/lib/export/types';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ReportLine } from '@/lib/types';

// Excel 出力用の読み取り（RLS 前提）。payload の組み立ては src/lib/export/payload.ts（純関数）。

// .in() の URL が長くなりすぎないよう id を分けて問い合わせる（summary.ts と同じ考え方）。
const ID_CHUNK = 200;

interface MonthReportRow {
  id: string;
  report_date: string;
  status: string;
  weather: string | null;
  supervisor: string | null;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | string | null;
  common_gap_min: number | string | null;
  output_total: number | string | null;
  cost_total: number | string | null;
  issues_text: string | null;
  notes_text: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

const MONTH_REPORT_COLUMNS =
  'id, report_date, status, weather, supervisor, common_start, common_end, common_break_min, common_gap_min, output_total, cost_total, issues_text, notes_text, created_by, reviewed_by, approved_by, approved_at';

function numOrNull(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 'YYYY-MM' → [その月の 1 日, 翌月の 1 日)。 */
function monthRange(month: string): { from: string; toExclusive: string } {
  const [y, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { from: `${month}-01`, toExclusive: next };
}

/**
 * 指定した id の氏名（無ければメール）。profiles は本人と管理者しか読めない（RLS）ので、DB 関数 gn_profile_names
 * （security definer。supabase/update_2026-11-03d_profile_names.sql）を使う。関数が無い・失敗したときは全員分を空にして続ける。
 */
export async function loadProfileNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  const out: Record<string, string> = {};
  if (unique.length === 0) return out;
  try {
    const supabase = await createServerSupabase();
    for (const part of chunk(unique, ID_CHUNK)) {
      const { data, error } = await supabase.rpc('gn_profile_names', { p_ids: part });
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { id: string; display_name: string | null }[]) if (r.display_name) out[r.id] = r.display_name;
    }
  } catch (e) {
    console.error('[loadProfileNames]', e);
    return {};
  }
  return out;
}

/** 指定した日報の明細行（gn_report_lines の全列。日報・並び順）。原価集計表の読み取り（reports-data.ts）でも使う。 */
export async function fetchReportLineRows(reportIds: string[]): Promise<(LineRowRead & { report_id: string })[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(reportIds, ID_CHUNK).map((part) =>
      fetchAllPages<LineRowRead & { report_id: string }>(async (rFrom, rTo) => {
        const { data, error } = await supabase
          .from('gn_report_lines')
          .select('*')
          .in('report_id', part)
          .order('report_id', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
          .range(rFrom, rTo);
        if (error) throw new Error(error.message);
        return (data ?? []) as (LineRowRead & { report_id: string })[];
      }),
    ),
  );
  return pages.flat();
}

/** その月の日報（日付順）を明細・重要事項の件・作成者などの氏名つきで読む。 */
export async function loadMonthReports(siteId: string, month: string): Promise<ExportReport[]> {
  const supabase = await createServerSupabase();
  const { from, toExclusive } = monthRange(month);
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select(MONTH_REPORT_COLUMNS)
    .eq('site_id', siteId)
    .gte('report_date', from)
    .lt('report_date', toExclusive)
    .order('report_date', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MonthReportRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [lineRows, issueRows, names] = await Promise.all([
    fetchReportLineRows(ids),
    Promise.all(
      chunk(ids, ID_CHUNK).map((part) =>
        fetchAllPages<{ report_id: string; body: string }>(async (rFrom, rTo) => {
          const { data: d, error: e } = await supabase
            .from('gn_report_issues')
            .select('report_id, body')
            .in('report_id', part)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(rFrom, rTo);
          if (e) throw new Error(e.message);
          return (d ?? []) as { report_id: string; body: string }[];
        }),
      ),
    ).then((pages) => pages.flat()),
    loadProfileNames(
      rows.flatMap((r) => [r.created_by, r.reviewed_by, r.approved_by]).filter((id): id is string => id !== null),
    ),
  ]);

  const linesById = new Map<string, ReportLine[]>(ids.map((id) => [id, []]));
  for (const r of lineRows) {
    const line = fromLineRow(r);
    if (line) linesById.get(r.report_id)?.push(line);
  }
  const issuesById = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const r of issueRows) issuesById.get(r.report_id)?.push(r.body);

  const nameOf = (id: string | null) => (id === null ? null : (names[id] ?? null));
  return rows.map((r) => ({
    id: r.id,
    date: r.report_date,
    status: toStatus(r.status),
    weather: r.weather,
    supervisor: r.supervisor,
    common: {
      start: r.common_start || null,
      end: r.common_end || null,
      breakMin: numOrNull(r.common_break_min),
      gapMin: numOrNull(r.common_gap_min),
    },
    outputTotal: Number(r.output_total ?? 0),
    costTotal: Number(r.cost_total ?? 0),
    issuesText: r.issues_text,
    notesText: r.notes_text,
    lines: linesById.get(r.id) ?? [],
    issues: issuesById.get(r.id) ?? [],
    // 作成者の氏名が引けないときは作業責任者で代える（承認画面と同じ）。
    createdByName: nameOf(r.created_by) ?? r.supervisor,
    reviewedByName: nameOf(r.reviewed_by),
    approvedByName: nameOf(r.approved_by),
    approvedAt: r.approved_at,
  }));
}

/**
 * Excel 出力に必要なものをまとめて読む：現場、設定、マスター（全件と現場の選択）、その月の日報（明細・件・氏名）、
 * 現場の全日報の日付・原価と労務行（通算回目・累計原価・前月繰越用）、繰越初期値。
 * 現場が見つからない（RLS で見えない）ときは例外。権限・削除済みの判定は呼び出し側（Route Handler）で行う。
 */
export async function loadExportInput(siteId: string, month: string): Promise<ExportInput> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('年月の形式が正しくありません');
  const site = await getSite(siteId);
  if (!site) throw new Error('現場が見つかりません');
  const [settings, selected, workers, suppliers, vehicles, leaseItems, carryovers, summary, reports] = await Promise.all([
    getSettings(),
    getSiteMasters(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listCarryovers(siteId),
    loadSummaryData(siteId),
    loadMonthReports(siteId, month),
  ]);
  return {
    month,
    site,
    rule: settings.rule,
    selected,
    workers,
    suppliers,
    vehicles,
    leaseItems,
    reports,
    siteReports: summary.days.map((d) => ({ reportDate: d.reportDate, costTotal: d.costTotal })),
    laborEntries: summary.entries,
    carryovers,
  };
}
