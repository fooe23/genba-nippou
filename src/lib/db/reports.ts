import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import type { ReportLine, ReportStatus, TimeSpec } from '@/lib/types';

// 日報まわりの読み取り（RLS 前提）。

export interface ReportHead {
  id: string;
  siteId: string;
  reportDate: string;
  weather: string | null;
  supervisor: string | null;
  status: ReportStatus;
  outputTotal: number;
  costTotal: number;
  manDaysTotal: number;
}

interface ReportHeadRow {
  id: string;
  site_id: string;
  report_date: string;
  weather: string | null;
  supervisor: string | null;
  status: string;
  output_total: number | string | null;
  cost_total: number | string | null;
  man_days_total: number | string | null;
}

const HEAD_COLUMNS = 'id, site_id, report_date, weather, supervisor, status, output_total, cost_total, man_days_total';

function toStatus(s: string): ReportStatus {
  return s === 'submitted' || s === 'approved' || s === 'rejected' ? s : 'draft';
}

function toHead(r: ReportHeadRow): ReportHead {
  return {
    id: r.id,
    siteId: r.site_id,
    reportDate: r.report_date,
    weather: r.weather,
    supervisor: r.supervisor,
    status: toStatus(r.status),
    outputTotal: Number(r.output_total ?? 0),
    costTotal: Number(r.cost_total ?? 0),
    manDaysTotal: Number(r.man_days_total ?? 0),
  };
}

/** 現場の日報の見出し（全期間、日付の昇順）。 */
export async function listReportHeads(siteId: string): Promise<ReportHead[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select(HEAD_COLUMNS)
    .eq('site_id', siteId)
    .order('report_date', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReportHeadRow[]).map(toHead);
}

/** 各現場の「今日の日報」の状態。日報がなければ 'none'。 */
export async function listTodayStatus(
  siteIds: string[],
  today: string,
): Promise<Record<string, ReportStatus | 'none'>> {
  const result: Record<string, ReportStatus | 'none'> = {};
  for (const id of siteIds) result[id] = 'none';
  if (siteIds.length === 0) return result;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select('site_id, status')
    .in('site_id', siteIds)
    .eq('report_date', today);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { site_id: string; status: string }[]) {
    result[r.site_id] = toStatus(r.status);
  }
  return result;
}

// ─── 日報1件の取得（入力画面・前回コピー）。保存は reports-actions.ts（Server Action） ───

export interface ReportDetail {
  head: ReportHead | null;
  common: TimeSpec;
  issuesText: string;
  notesText: string;
  lines: ReportLine[];
}

interface ReportDetailRow extends ReportHeadRow {
  common_start: string | null;
  common_end: string | null;
  common_break_min: number | null;
  common_gap_min: number | null;
  issues_text: string | null;
  notes_text: string | null;
}

const DETAIL_COLUMNS = `${HEAD_COLUMNS}, common_start, common_end, common_break_min, common_gap_min, issues_text, notes_text`;

const EMPTY_TIME: TimeSpec = { start: null, end: null, breakMin: null, gapMin: null };

function emptyDetail(): ReportDetail {
  return { head: null, common: { ...EMPTY_TIME }, issuesText: '', notesText: '', lines: [] };
}

async function loadDetail(row: ReportDetailRow): Promise<ReportDetail> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_lines')
    .select('*')
    .eq('report_id', row.id)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const lines: ReportLine[] = [];
  for (const r of (data ?? []) as LineRowRead[]) {
    const line = fromLineRow(r);
    if (line) lines.push(line);
  }
  return {
    head: toHead(row),
    common: {
      start: row.common_start || null,
      end: row.common_end || null,
      breakMin: row.common_break_min === null ? null : Number(row.common_break_min),
      gapMin: row.common_gap_min === null ? null : Number(row.common_gap_min),
    },
    issuesText: row.issues_text ?? '',
    notesText: row.notes_text ?? '',
    lines,
  };
}

/** その日の日報。無ければ head: null・空行。 */
export async function getReport(siteId: string, date: string): Promise<ReportDetail> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select(DETAIL_COLUMNS)
    .eq('site_id', siteId)
    .eq('report_date', date)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? loadDetail(data as ReportDetailRow) : emptyDetail();
}

/** beforeDate より前で最も新しい日報（前回コピー用）。無ければ null。 */
export async function getPreviousReport(siteId: string, beforeDate: string): Promise<ReportDetail | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select(DETAIL_COLUMNS)
    .eq('site_id', siteId)
    .lt('report_date', beforeDate)
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? loadDetail(data as ReportDetailRow) : null;
}

// ─── 状態変更（提出・承認など）は Task 10 でこのファイルに追加する ───
