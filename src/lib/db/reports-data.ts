import 'server-only';
import { monthKey } from '@/lib/calc/format';
import { fetchReportLineRows, loadProfileNames } from '@/lib/db/export';
import { listLeaseItems, listSuppliers, listVehicles, listWorkers } from '@/lib/db/masters';
import { listIssuesForReports, listReportHeads, type Issue, type ReportHead } from '@/lib/db/reports';
import { getSite, listCarryovers, listSitePartners, type Site } from '@/lib/db/sites';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import { createServerSupabase } from '@/lib/supabase/server';
import type {
  CostReportInput,
  DailyReportInput,
  ReportWithLines,
  SavedReportLine,
  StoredLineValues,
} from '@/lib/reports/types';

// 帳票用の読み取り（RLS 前提）。モデルの組み立ては src/lib/reports/cost-model.ts・daily-model.ts（純関数）。

function storedNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** DB の保存値（トリガーが計算した amount・man_days・overtime_hours）。帳票はこれだけで集計する。 */
function storedValues(r: LineRowRead): StoredLineValues {
  return { amount: storedNum(r.amount), manDays: storedNum(r.man_days), overtimeHours: storedNum(r.overtime_hours) };
}

/** 見出しに保存値つき明細を付ける（明細は 1 回の問い合わせでまとめて読む）。 */
export async function withLines(heads: ReportHead[]): Promise<ReportWithLines[]> {
  const lineRows = await fetchReportLineRows(heads.map((h) => h.id));
  const linesById = new Map<string, SavedReportLine[]>(heads.map((h) => [h.id, []]));
  for (const r of lineRows) {
    const line = fromLineRow(r);
    if (line) linesById.get(r.report_id)?.push({ ...line, stored: storedValues(r) });
  }
  return heads.map((h) => ({ ...h, lines: linesById.get(h.id) ?? [] }));
}

/**
 * 工事原価集計表・変更増減の一覧の入力：現場、全日報の見出し（集計画面と同じく保存済みの全状態）と保存値つき明細、
 * 全日報の件、繰越初期値、マスター、現場の協力会社（請負金額）。明細は gn_report_lines の全列を読むので、労務の行の
 * 所属の写し（affiliation・supplier_id）と常用・請負（labor_contract）も入る（fromLineRow）。
 * 現場が見つからない（RLS で見えない）ときは例外。権限・削除済みの判定は呼び出し側（Route Handler）で行う。
 */
export async function loadCostReportInput(siteId: string): Promise<CostReportInput> {
  const site = await getSite(siteId);
  if (!site) throw new Error('現場が見つかりません');
  const [heads, carryovers, workers, suppliers, vehicles, leaseItems, sitePartners] = await Promise.all([
    listReportHeads(siteId),
    listCarryovers(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listSitePartners(siteId),
  ]);

  const [reports, issues] = await Promise.all([withLines(heads), listIssuesForReports(heads.map((h) => h.id))]);

  return { site, reports, carryovers, workers, suppliers, vehicles, leaseItems, issues, sitePartners };
}

// ─── 日報（1 日分・月まとめ） ───

/** 見出し（ReportHead）に無い日報の列。 */
interface DailyExtraRow {
  id: string;
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | string | null;
  common_gap_min: number | string | null;
  issues_text: string | null;
  notes_text: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

const DAILY_EXTRA_COLUMNS =
  'id, common_start, common_end, common_break_min, common_gap_min, issues_text, notes_text, reviewed_by, approved_by, approved_at';

function numOrNull(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 選んだ日報（targets。日付の昇順）の帳票入力。allHeads は現場の全日報の見出し（回目の採番と前日までの出来高に使う）。
 * 共通時間・本文・確認者などの列、明細、件、氏名はそれぞれ 1 回の問い合わせでまとめて読む。
 */
async function loadDailyInputs(site: Site, allHeads: ReportHead[], targets: ReportHead[]): Promise<DailyReportInput[]> {
  if (targets.length === 0) return [];
  const ids = targets.map((h) => h.id);
  const supabase = await createServerSupabase();
  const [extraRes, reports, issues] = await Promise.all([
    supabase.from('gn_daily_reports').select(DAILY_EXTRA_COLUMNS).in('id', ids),
    withLines(targets),
    listIssuesForReports(ids),
  ]);
  if (extraRes.error) throw new Error(extraRes.error.message);
  const extras = new Map(((extraRes.data ?? []) as DailyExtraRow[]).map((r) => [r.id, r]));
  const names = await loadProfileNames(
    [...targets.map((h) => h.createdBy), ...[...extras.values()].flatMap((r) => [r.reviewed_by, r.approved_by])].filter(
      (id): id is string => id !== null,
    ),
  );
  const issuesById = new Map<string, Issue[]>(ids.map((id) => [id, []]));
  for (const i of issues) issuesById.get(i.reportId)?.push(i);
  const reportDates = allHeads.map((h) => h.reportDate);

  return reports.map((report) => {
    const x = extras.get(report.id);
    if (!x) throw new Error('日報を読み込めませんでした');
    return {
      site,
      report: {
        ...report,
        common: {
          start: x.common_start || null,
          end: x.common_end || null,
          breakMin: numOrNull(x.common_break_min),
          gapMin: numOrNull(x.common_gap_min),
        },
        issuesText: x.issues_text ?? '',
        notesText: x.notes_text ?? '',
        reviewedBy: x.reviewed_by,
        approvedBy: x.approved_by,
        approvedAt: x.approved_at,
      },
      reportDates,
      issues: issuesById.get(report.id) ?? [],
      names,
      cumulativeOutputBefore: allHeads.filter((h) => h.reportDate < report.reportDate).reduce((sum, h) => sum + h.outputTotal, 0),
    };
  });
}

/**
 * 1 日分の日報の帳票入力。その日の日報が無ければ null（呼び出し側は buildEmptyDailyReport）。
 * 権限・削除済みの判定は呼び出し側（Route Handler）で行う。
 */
export async function loadDailyReportInput(site: Site, date: string): Promise<DailyReportInput | null> {
  const heads = await listReportHeads(site.id);
  const target = heads.filter((h) => h.reportDate === date);
  const [input] = await loadDailyInputs(site, heads, target);
  return input ?? null;
}

/** その月（'YYYY-MM'）の日報の帳票入力（日付の昇順）。日報が無ければ空。 */
export async function loadDailyMonthInputs(site: Site, month: string): Promise<DailyReportInput[]> {
  const heads = await listReportHeads(site.id); // 日付の昇順
  return loadDailyInputs(site, heads, heads.filter((h) => monthKey(h.reportDate) === month));
}
