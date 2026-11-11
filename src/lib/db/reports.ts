import 'server-only';
import { cache } from 'react';
import { EMPTY_LABOR_COST_CONTEXT, laborCountedCost, type LaborCostContext } from '@/lib/calc/labor-cost';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { getCurrentProfile, isEmployeeOrAdmin, requireProfile, type Profile } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';
import { UNFINISHED_ISSUE_STATUSES } from '@/lib/report/change-labels';
import { countBySite, hideEstimateDates, issueColumns, issueFromRow, type Issue, type IssueRow } from '@/lib/report/issue-row';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import {
  ISSUE_CONFIRMATION_COLUMNS,
  latestConfirmations,
  type IssueConfirmation,
  type IssueConfirmationRow,
} from '@/lib/report/issue-confirmations';
import type { ReportLine, ReportStatus, SiteRole, TimeSpec } from '@/lib/types';

// 日報まわりの読み取り（RLS 前提）。

export interface ReportHead {
  id: string;
  siteId: string;
  reportDate: string;
  weather: string | null;
  supervisor: string | null;
  status: ReportStatus;
  rejectedReason: string | null;
  outputTotal: number;
  costTotal: number;
  manDaysTotal: number;
  /** 楽観ロック用（保存時に gn_save_report へ渡す）。PostgREST の文字列のまま持つ（マイクロ秒を落とさない）。 */
  updatedAt: string | null;
  createdBy: string | null;
  /** 客先確認（確認者名・日時（ISO 8601）・メモ）。日報の保存（gn_save_report）では変わらない。 */
  clientConfirmedBy: string | null;
  clientConfirmedAt: string | null;
  clientConfirmedNote: string | null;
}

interface ReportHeadRow {
  id: string;
  site_id: string;
  report_date: string;
  weather: string | null;
  supervisor: string | null;
  status: string;
  rejected_reason: string | null;
  output_total: number | string | null;
  cost_total: number | string | null;
  man_days_total: number | string | null;
  updated_at: string | null;
  created_by: string | null;
  client_confirmed_by: string | null;
  client_confirmed_at: string | null;
  client_confirmed_note: string | null;
}

const HEAD_COLUMNS =
  'id, site_id, report_date, weather, supervisor, status, rejected_reason, output_total, cost_total, man_days_total, updated_at, created_by, client_confirmed_by, client_confirmed_at, client_confirmed_note';

export function toStatus(s: string): ReportStatus {
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
    rejectedReason: r.rejected_reason ?? null,
    outputTotal: Number(r.output_total ?? 0),
    costTotal: Number(r.cost_total ?? 0),
    manDaysTotal: Number(r.man_days_total ?? 0),
    updatedAt: r.updated_at ?? null,
    createdBy: r.created_by ?? null,
    clientConfirmedBy: r.client_confirmed_by || null,
    clientConfirmedAt: r.client_confirmed_at ?? null,
    clientConfirmedNote: r.client_confirmed_note || null,
  };
}

/** 現場の日報の見出し（全期間、日付の昇順）。PostgREST の max_rows（既定 1000）で切り詰められないようページングする。 */
export async function listReportHeads(siteId: string): Promise<ReportHead[]> {
  const supabase = await createServerSupabase();
  const rows = await fetchAllPages<ReportHeadRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('gn_daily_reports')
      .select(HEAD_COLUMNS)
      .eq('site_id', siteId)
      .order('report_date', { ascending: true }) // 現場内で日付は一意なのでページ境界で重複・欠落しない
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as ReportHeadRow[];
  });
  return rows.map(toHead);
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

// .in() の URL が長くなりすぎないよう現場 id を分けて問い合わせる（summary.ts と同じ考え方）。
const SITE_ID_CHUNK = 100;

/** 現場ごとの日報の件数（完了現場一覧の「日報 N 件」用）。日報がない現場は 0。 */
export async function countReportsBySite(siteIds: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const id of siteIds) result[id] = 0;
  if (siteIds.length === 0) return result;

  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(siteIds, SITE_ID_CHUNK).map((ids) =>
      fetchAllPages<{ site_id: string }>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_daily_reports')
          .select('site_id')
          .in('site_id', ids)
          .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as { site_id: string }[];
      }),
    ),
  );
  for (const r of pages.flat()) result[r.site_id] = (result[r.site_id] ?? 0) + 1;
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

/** 日報IDから日報を取得する（承認画面用）。RLS により現場メンバー以外は null。 */
export async function getReportById(reportId: string): Promise<{ siteId: string; date: string; detail: ReportDetail } | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_daily_reports').select(DETAIL_COLUMNS).eq('id', reportId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as ReportDetailRow;
  return { siteId: row.site_id, date: row.report_date, detail: await loadDetail(row) };
}

/** 現場内の自分の役割（管理者は 'approver'、メンバーでなければ null）。RPC gn_site_role。 */
export async function getMySiteRole(siteId: string): Promise<SiteRole | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('gn_site_role', { p_site: siteId });
  if (error) throw new Error(error.message);
  return data === 'staff' || data === 'reviewer' || data === 'approver' ? data : null;
}

// ─── 承認待ち一覧（承認画面・タブのバッジ）。状態変更は reports-actions.ts ───

/** createdByName は作成者の名前。管理者以外は他人の profiles を読めず null になるため、日報の作業責任者で代える。 */
export type SubmittedReport = ReportHead & { siteName: string; createdByName: string };

interface SubmittedRow extends ReportHeadRow {
  gn_sites: { name: string | null } | { name: string | null }[] | null;
  profiles: { name: string | null } | { name: string | null }[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** 自分が確認・承認できる現場（管理者は全現場 = null）。空配列なら該当なし。 */
async function reviewableSiteIds(profile: Profile): Promise<string[] | null> {
  if (profile.isAdmin) return null;
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_site_members')
    .select('site_id')
    .eq('user_id', profile.id)
    .in('role', ['reviewer', 'approver']);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { site_id: string }[]).map((r) => r.site_id);
}

/**
 * 自分が reviewer/approver の現場（管理者は全現場）の提出済み日報。日付の古い順。
 * 削除済みの現場の日報は除く（管理者には RLS で見えてしまうため、gn_sites との内部結合で絞る）。
 */
export async function listSubmittedReports(): Promise<SubmittedReport[]> {
  const ids = await reviewableSiteIds(await requireProfile());
  if (ids !== null && ids.length === 0) return [];
  const supabase = await createServerSupabase();
  let q = supabase
    .from('gn_daily_reports')
    .select(`${HEAD_COLUMNS}, gn_sites!inner(name, deleted_at), profiles!gn_daily_reports_created_by_fkey(name)`)
    .eq('status', 'submitted')
    .is('gn_sites.deleted_at', null);
  if (ids !== null) q = q.in('site_id', ids);
  const { data, error } = await q.order('report_date', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SubmittedRow[]).map((r) => ({
    ...toHead(r),
    siteName: one(r.gn_sites)?.name ?? '',
    createdByName: one(r.profiles)?.name || r.supervisor || '',
  }));
}

/** 承認待ちの件数（タブのバッジ用）。削除済みの現場の日報は数えない（listSubmittedReports と同じ絞り方）。取得に失敗したら 0。 */
export async function getSubmittedCount(): Promise<number> {
  const profile = await requireProfile();
  try {
    const ids = await reviewableSiteIds(profile);
    if (ids !== null && ids.length === 0) return 0;
    const supabase = await createServerSupabase();
    let q = supabase
      .from('gn_daily_reports')
      .select('id, gn_sites!inner(deleted_at)', { count: 'exact', head: true })
      .eq('status', 'submitted')
      .is('gn_sites.deleted_at', null);
    if (ids !== null) q = q.in('site_id', ids);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  } catch (e) {
    console.error('[getSubmittedCount]', e);
    return 0;
  }
}

// ─── 重要事項の件（追加・変更・増減の指示や依頼）。書き込みは reports-actions.ts ───

export type { Issue } from '@/lib/report/issue-row';

/**
 * 件の見積書の列（gn_report_issues.estimate_requirement。update_2026-11-20_issue_estimate.sql）が DB にあるか。
 * 無い（SQL の前。42703・PGRST204）なら false：見積書の欄・現場の設定・赤い印・止める判定を出さず、件は今までの列だけで読む。
 * 1 リクエストにつき 1 回だけ問い合わせる（React の cache）。それ以外のエラーは投げる。
 */
export const issueEstimateColumnsReady = cache(async function issueEstimateColumnsReady(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('gn_report_issues').select('estimate_requirement').limit(1);
  if (!error) return true;
  if (error.code === '42703' || error.code === 'PGRST204') return false;
  throw new Error(error.message);
});

/** 件を読む列（見積書の列は DB にあるときだけ）。 */
async function issueSelect(): Promise<string> {
  return issueColumns(await issueEstimateColumnsReady());
}

const toIssue = issueFromRow;

/**
 * 協力会社のアカウント（と、プロフィールが読めないとき）には見積提出の日を渡さない（null にする）。列は RLS で
 * 現場メンバーが読めるが、出るのは日付だけ。画面・お客様用の画面・PDF に出さないため、件を読むところで必ず通す。
 * 赤い印に使う estimatePending（未提出かどうか）は、日付を消す前に issueFromRow で決めてあるので残る。
 */
async function hideEstimateFromPartner(list: Issue[]): Promise<Issue[]> {
  const profile = await getCurrentProfile();
  if (profile && isEmployeeOrAdmin(profile)) return list;
  return hideEstimateDates(list);
}

/** 現場の完了していない件（見積中・対応中）。日報の日付の昇順（同日は登録順）。 */
export async function listOpenIssues(siteId: string): Promise<Issue[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(await issueSelect())
    .eq('site_id', siteId)
    .in('status', [...UNFINISHED_ISSUE_STATUSES])
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const list = await hideEstimateFromPartner(((data ?? []) as unknown as IssueRow[]).map(toIssue));
  // 埋め込み先の列では並べ替えない（件数は少ないのでここで日付順にする。安定ソートで同日は登録順）。
  return list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/**
 * 現場の、その日（done_at）に完了にした件（お客様用の確認画面の候補。前の日に書いた後出しの件を今日完了にして、
 * そのままサインをもらうため。2026-11-20）。日報の日付の昇順（同日は登録順）。
 */
export async function listIssuesDoneOn(siteId: string, date: string): Promise<Issue[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(await issueSelect())
    .eq('site_id', siteId)
    .eq('status', 'done')
    .eq('done_at', date)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const list = await hideEstimateFromPartner(((data ?? []) as unknown as IssueRow[]).map(toIssue));
  return list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/** その日報の件（対応中・完了とも）。登録順。 */
export async function listIssuesForReport(reportId: string): Promise<Issue[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(await issueSelect())
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return hideEstimateFromPartner(((data ?? []) as unknown as IssueRow[]).map(toIssue));
}

/** 1 回の問い合わせに入れる日報 id の数（URL の長さの上限に収める）。 */
const REPORT_ID_CHUNK = 200;

/** 件の id から件を読む（お客様用日報の写真の件番号用）。並びは問い合わせ順ではないので、呼び出し側で並べる。 */
export async function listIssuesByIds(ids: string[]): Promise<Issue[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const supabase = await createServerSupabase();
  const columns = await issueSelect();
  const parts = await Promise.all(
    chunk(unique, REPORT_ID_CHUNK).map(async (part) => {
      const { data, error } = await supabase.from('gn_report_issues').select(columns).in('id', part);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as IssueRow[]).map(toIssue);
    }),
  );
  return hideEstimateFromPartner(parts.flat());
}

/** 日報の id から現場と日付だけを読む。RLS で見えなければ null。 */
export async function getReportKey(reportId: string): Promise<{ siteId: string; date: string } | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_daily_reports').select('site_id, report_date').eq('id', reportId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { site_id: string; report_date: string };
  return { siteId: row.site_id, date: row.report_date };
}

/**
 * 複数の日報の件（対応中・完了とも。帳票の月まとめ・変更増減の一覧用）。同じ日報の件は登録順（同時刻は id 順）。
 * 現場の全日報（数百件）でも読めるよう、日報 id を分けて問い合わせ、1,000 行ごとにページングする。
 */
export async function listIssuesForReports(reportIds: string[]): Promise<Issue[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const columns = await issueSelect();
  const pages = await Promise.all(
    chunk(reportIds, REPORT_ID_CHUNK).map((part) =>
      fetchAllPages<IssueRow>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_report_issues')
          .select(columns)
          .in('report_id', part)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as IssueRow[];
      }),
    ),
  );
  return hideEstimateFromPartner(pages.flat().map(toIssue));
}

/**
 * 現場の、完了した件のうち見積書が要で見積提出の記録が無いもの（日報の上の枠・現場の画面の「見積書が未提出の完了した件」。
 * 2026-11-20）。日報の日付の昇順。DB に見積書の列が無ければ空。
 */
export async function listEstimatePendingDoneIssues(siteId: string): Promise<Issue[]> {
  if (!(await issueEstimateColumnsReady())) return [];
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(issueColumns(true))
    .eq('site_id', siteId)
    .eq('status', 'done')
    .in('estimate_requirement', ['before', 'after'])
    .is('estimate_submitted_on', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const list = await hideEstimateFromPartner(((data ?? []) as unknown as IssueRow[]).map(toIssue));
  return list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/**
 * 現場ごとの、見積書が要で見積提出の記録が無い件の数（完了した件も数える。ホーム・管理者の現場の一覧。2026-11-20）。
 * 画面は社員・管理者にだけ出す。DB に見積書の列が無ければ空。
 */
export async function countEstimatePendingBySite(siteIds: string[]): Promise<Record<string, number>> {
  if (siteIds.length === 0 || !(await issueEstimateColumnsReady())) return {};
  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(siteIds, REPORT_ID_CHUNK).map((part) =>
      fetchAllPages<{ site_id: string }>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_report_issues')
          .select('site_id')
          .in('site_id', part)
          .in('estimate_requirement', ['before', 'after'])
          .is('estimate_submitted_on', null)
          .order('id', { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as { site_id: string }[];
      }),
    ),
  );
  return countBySite(pages.flat());
}

// ─── 日報の修正申請（承認待ち一覧用）。出すのは reports-actions.ts の requestReportFix ───

export interface FixRequest {
  id: string;
  reportId: string;
  siteId: string;
  siteName: string;
  reportDate: string;
  reason: string;
  /** 申請した人の名前（申請した時点の名前を DB が写したもの。空なら ''）。 */
  requestedByName: string;
  /** 申請日時（ISO 8601）。 */
  requestedAt: string;
}

interface FixRequestRow {
  id: string;
  report_id: string;
  site_id: string;
  reason: string;
  requested_by_name: string | null;
  requested_at: string;
  gn_sites: { name: string | null } | { name: string | null }[] | null;
  gn_daily_reports: { report_date: string } | { report_date: string }[] | null;
}

/**
 * 未解決の修正申請。自分が確認者・承認者の現場（管理者は全現場）だけ。申請の古い順。
 * 進行中の現場だけ（完了・削除済みの現場は除く。listSubmittedReports と同じ内部結合で絞る）。
 */
export async function listFixRequests(): Promise<FixRequest[]> {
  const ids = await reviewableSiteIds(await requireProfile());
  if (ids !== null && ids.length === 0) return [];
  const supabase = await createServerSupabase();
  let q = supabase
    .from('gn_report_fix_requests')
    .select('id, report_id, site_id, reason, requested_by_name, requested_at, gn_sites!inner(name, status, deleted_at), gn_daily_reports(report_date)')
    .is('resolved_at', null)
    // 完了した現場では下書きに戻せず申請が残り続けるので出さない（進行中に戻せばまた出る）
    .eq('gn_sites.status', 'active')
    .is('gn_sites.deleted_at', null);
  if (ids !== null) q = q.in('site_id', ids);
  const { data, error } = await q.order('requested_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as FixRequestRow[]).map((r) => ({
    id: r.id,
    reportId: r.report_id,
    siteId: r.site_id,
    siteName: one(r.gn_sites)?.name ?? '',
    reportDate: one(r.gn_daily_reports)?.report_date ?? '',
    reason: r.reason,
    requestedByName: r.requested_by_name ?? '',
    requestedAt: r.requested_at,
  }));
}

/** 日報画面に出す修正申請（申請した人・日時・理由）。 */
export type ReportFixRequest = Pick<FixRequest, 'id' | 'reason' | 'requestedByName' | 'requestedAt'>;

/** その日報の未解決の修正申請（現場メンバーが読める）。申請の古い順。 */
export async function listOpenFixRequestsForReport(reportId: string): Promise<ReportFixRequest[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_fix_requests')
    .select('id, reason, requested_by_name, requested_at')
    .eq('report_id', reportId)
    .is('resolved_at', null)
    .order('requested_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; reason: string; requested_by_name: string | null; requested_at: string }[]).map((r) => ({
    id: r.id,
    reason: r.reason,
    requestedByName: r.requested_by_name ?? '',
    requestedAt: r.requested_at,
  }));
}

// ─── 件ごとのお客様確認（2026-11-13。書くのは DB の gn_save_client_signature / gn_revoke_client_signature だけ） ───

/** 件ごとの最新のお客様確認（取り消されていないもの）。確認の無い件はキーが無い。 */
export async function listIssueConfirmations(issueIds: string[]): Promise<Map<string, IssueConfirmation>> {
  const unique = [...new Set(issueIds)];
  if (unique.length === 0) return new Map();
  const supabase = await createServerSupabase();
  const parts = await Promise.all(
    chunk(unique, REPORT_ID_CHUNK).map(async (part) => {
      const { data, error } = await supabase
        .from('gn_issue_client_confirmations')
        .select(ISSUE_CONFIRMATION_COLUMNS)
        .in('issue_id', part)
        .is('revoked_at', null);
      if (error) throw new Error(`[listIssueConfirmations] ${error.message}`);
      return (data ?? []) as IssueConfirmationRow[];
    }),
  );
  return latestConfirmations(parts.flat());
}

/**
 * いまのサインで確認していただいた件の一覧（gn_report_signature_issue_sets。空の一覧もある）。
 * 行が無ければ null（サインが無い、または件ごとの確認を記録する前＝第 4 段階より前にもらったサイン）。
 */
export async function getSignatureIssueSet(reportId: string): Promise<string[] | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_signature_issue_sets')
    .select('issue_ids')
    .eq('report_id', reportId)
    .maybeSingle();
  if (error) throw new Error(`[getSignatureIssueSet] ${error.message}`);
  return data ? ((data as { issue_ids: string[] | null }).issue_ids ?? []) : null;
}

/**
 * 外注の買掛の列（gn_report_lines.purchase_kind。update_2026-11-17_subcontract.sql）が DB にあるか。
 * 無い（SQL の前。42703・PGRST204）なら false。日報で区分「外注」を出すか・保存してよいかに使う
 * （列が無いと gn_save_report が区分を捨て、外注の行が仕入として保存されるため）。それ以外のエラーは投げる。
 */
export async function subcontractColumnsReady(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('gn_report_lines').select('purchase_kind').limit(1);
  if (!error) return true;
  if (error.code === '42703' || error.code === 'PGRST204') return false;
  throw new Error(error.message);
}

/**
 * 名前なし（会社と人数）の作業員の行の人数の列（gn_report_lines.headcount。update_2026-11-19_unnamed_workers.sql）が DB にあるか。
 * 無い（SQL の前。42703・PGRST204）なら false。日報で「名前なし」を出すか・保存してよいかに使う
 * （列が無いと gn_save_report が人数を捨て、1 人として保存されるため）。それ以外のエラーは投げる。
 */
export async function headcountColumnReady(): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('gn_report_lines').select('headcount').limit(1);
  if (!error) return true;
  if (error.code === '42703' || error.code === 'PGRST204') return false;
  throw new Error(error.message);
}

interface AdjustmentRow {
  report_id: string;
  kind: string;
  amount: number | string | null;
  affiliation?: string | null;
  supplier_id?: string | null;
  labor_contract?: string | null;
  jouyou_hours?: number | string | null;
  headcount?: number | string | null;
  hours?: number | string | null;
  man_days?: number | string | null;
  overtime_hours?: number | string | null;
  unit_price?: number | string | null;
  overtime_rate?: number | string | null;
}

const ADJUST_LABOR_COLUMNS = 'affiliation, supplier_id, labor_contract, hours, man_days, overtime_hours, unit_price, overtime_rate';

function adjNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 日報ごとの、見出しの cost_total に足す調整（2026-11-17）。cost_total ＋ 調整 ＝ 明細から出した原価（集計・帳票と同じ）。
 * - 外注の買掛（cost_total に入っていない）。協力会社のアカウントには RLS で外注の行が来ない（0）。
 * - 請負の作業員の行（保存した常用・請負が請負）：原価に数える分 − 行の金額（労務費の決まり。src/lib/calc/labor-cost.ts）。
 * 現場承認待ちの本日原価・現場の累計原価に使う。laborCost は日報の現場ごとの材料（無い現場は既定）。
 * 日報の id 200 件ずつ、1000 行ずつ読む。DB に区分・うち常用の時間の列が無い（SQL の前。42703）ときは、請負の作業員の行だけ
 * （うち常用の時間なし）で読む。
 */
export async function loadCostAdjustments(
  reports: { id: string; siteId: string }[],
  laborCost: ReadonlyMap<string, LaborCostContext>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (reports.length === 0) return out;
  const siteOf = new Map(reports.map((r) => [r.id, r.siteId]));
  const supabase = await createServerSupabase();
  const read = (columns: string, filter: string) =>
    Promise.all(
      chunk(
        reports.map((r) => r.id),
        200,
      ).map((part) =>
        fetchAllPages<AdjustmentRow>(async (from, to) => {
          const { data, error } = await supabase
            .from('gn_report_lines')
            .select(columns)
            .in('report_id', part)
            .or(filter)
            .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
            .range(from, to);
          if (error) throw Object.assign(new Error(error.message), { code: error.code });
          return (data ?? []) as unknown as AdjustmentRow[];
        }),
      ),
    ).then((pages) => pages.flat());
  // 新しい列が無い DB（SQL の前。42703）では、無い列を外して読み直す：人数（2026-11-19 の前は 1 人）→ 区分・うち常用の時間。
  const tries: [string, string][] = [
    [
      `report_id, kind, amount, purchase_kind, jouyou_hours, headcount, ${ADJUST_LABOR_COLUMNS}`,
      'and(kind.eq.credit,purchase_kind.eq.subcontract),and(kind.eq.labor,labor_contract.eq.ukeoi)',
    ],
    [
      `report_id, kind, amount, purchase_kind, jouyou_hours, ${ADJUST_LABOR_COLUMNS}`,
      'and(kind.eq.credit,purchase_kind.eq.subcontract),and(kind.eq.labor,labor_contract.eq.ukeoi)',
    ],
    [`report_id, kind, amount, ${ADJUST_LABOR_COLUMNS}`, 'and(kind.eq.labor,labor_contract.eq.ukeoi)'],
  ];
  let rows: AdjustmentRow[] = [];
  for (const [i, [columns, filter]] of tries.entries()) {
    try {
      rows = await read(columns, filter);
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== '42703' || i === tries.length - 1) throw e;
    }
  }
  for (const r of rows) {
    const amount = Number(r.amount ?? 0);
    let add = amount;
    if (r.kind === 'labor') {
      const ctx = laborCost.get(siteOf.get(r.report_id) ?? '') ?? EMPTY_LABOR_COST_CONTEXT;
      const counted = laborCountedCost(
        {
          affiliation: r.affiliation === 'partner' ? 'partner' : r.affiliation === 'own' ? 'own' : null,
          supplierId: r.supplier_id ?? null,
          laborContract: r.labor_contract === 'ukeoi' ? 'ukeoi' : r.labor_contract === 'jouyou' ? 'jouyou' : null,
          jouyouHours: adjNum(r.jouyou_hours),
          dailyRate: adjNum(r.unit_price),
          overtimeRate: adjNum(r.overtime_rate),
          headcount: adjNum(r.headcount),
          stored: { amount, manDays: adjNum(r.man_days) ?? 0, overtimeHours: adjNum(r.overtime_hours) ?? 0, hours: adjNum(r.hours) ?? 0 },
        },
        ctx,
      );
      add = counted - amount;
    }
    out.set(r.report_id, (out.get(r.report_id) ?? 0) + add);
  }
  return out;
}
