import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ReportStatus } from '@/lib/types';

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

// ─── 書き込み系（取得・保存・提出・承認など）は Task 9 以降でこのファイルに追加する ───
