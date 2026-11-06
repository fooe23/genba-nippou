import 'server-only';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { requireProfile, type Profile } from '@/lib/db/profile';
import { createServerSupabase } from '@/lib/supabase/server';
import { isInstructionMethod, isIssueKind, isIssueStatus, isSettlementMethod, UNFINISHED_ISSUE_STATUSES } from '@/lib/report/change-labels';
import { fromLineRow, type LineRowRead } from '@/lib/report/rows';
import type { InstructionMethod, IssueKind, IssueStatus, ReportLine, ReportStatus, SettlementMethod, SiteRole, TimeSpec } from '@/lib/types';

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

export interface Issue {
  id: string;
  siteId: string;
  reportId: string;
  reportDate: string;
  body: string;
  /** 見積中・対応中・完了。見積中と対応中は完了まで日報の上の枠に出続ける。 */
  status: IssueStatus;
  doneAt: string | null;
  /** 種別（追加指示・増（数量増）・仕様変更・減・客先都合・やり直し・その他）。表示名は ISSUE_KIND_LABELS。 */
  kind: IssueKind;
  /** 指示者（未入力は null）。 */
  instructedBy: string | null;
  instructionMethod: InstructionMethod | null;
  /** 金額見込み（円。未入力は null）。 */
  amountEstimate: number | null;
  /** 精算の方法（未定・一式・見積・常用）。表示名は SETTLEMENT_METHOD_LABELS。 */
  settlementMethod: SettlementMethod;
  /** 確定額（円。一式・見積のとき。見積は見積額。それ以外は null）。 */
  fixedAmount: number | null;
  /** 常用単価（客先請求・円／人工。常用のとき。それ以外は null）。 */
  dailyRate: number | null;
  /** 確定日（YYYY-MM-DD。未入力は null）。 */
  fixedOn: string | null;
}

interface IssueRow {
  id: string;
  site_id: string;
  report_id: string;
  body: string;
  status: string;
  done_at: string | null;
  kind: string | null;
  instructed_by: string | null;
  instruction_method: string | null;
  amount_estimate: number | string | null;
  settlement_method: string | null;
  fixed_amount: number | string | null;
  daily_rate: number | string | null;
  fixed_on: string | null;
  gn_daily_reports: { report_date: string } | { report_date: string }[] | null;
}

const ISSUE_COLUMNS =
  'id, site_id, report_id, body, status, done_at, kind, instructed_by, instruction_method, amount_estimate, settlement_method, fixed_amount, daily_rate, fixed_on, gn_daily_reports(report_date)';

function amountOrNull(v: number | string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIssue(r: IssueRow): Issue {
  return {
    id: r.id,
    siteId: r.site_id,
    reportId: r.report_id,
    reportDate: one(r.gn_daily_reports)?.report_date ?? '',
    body: r.body,
    // 知らない値は対応中として扱う（完了扱いにして枠から消さない）
    status: isIssueStatus(r.status) ? r.status : 'open',
    doneAt: r.done_at ?? null,
    kind: isIssueKind(r.kind) ? r.kind : 'other',
    instructedBy: r.instructed_by || null,
    instructionMethod: isInstructionMethod(r.instruction_method) ? r.instruction_method : null,
    amountEstimate: amountOrNull(r.amount_estimate),
    settlementMethod: isSettlementMethod(r.settlement_method) ? r.settlement_method : 'undecided',
    fixedAmount: amountOrNull(r.fixed_amount),
    dailyRate: amountOrNull(r.daily_rate),
    fixedOn: r.fixed_on || null,
  };
}

/** 現場の完了していない件（見積中・対応中）。日報の日付の昇順（同日は登録順）。 */
export async function listOpenIssues(siteId: string): Promise<Issue[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(ISSUE_COLUMNS)
    .eq('site_id', siteId)
    .in('status', [...UNFINISHED_ISSUE_STATUSES])
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const list = ((data ?? []) as unknown as IssueRow[]).map(toIssue);
  // 埋め込み先の列では並べ替えない（件数は少ないのでここで日付順にする。安定ソートで同日は登録順）。
  return list.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/** その日報の件（対応中・完了とも）。登録順。 */
export async function listIssuesForReport(reportId: string): Promise<Issue[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_report_issues')
    .select(ISSUE_COLUMNS)
    .eq('report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as IssueRow[]).map(toIssue);
}

/** 1 回の問い合わせに入れる日報 id の数（URL の長さの上限に収める）。 */
const REPORT_ID_CHUNK = 200;

/**
 * 複数の日報の件（対応中・完了とも。帳票の月まとめ・変更増減の一覧用）。同じ日報の件は登録順（同時刻は id 順）。
 * 現場の全日報（数百件）でも読めるよう、日報 id を分けて問い合わせ、1,000 行ごとにページングする。
 */
export async function listIssuesForReports(reportIds: string[]): Promise<Issue[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(reportIds, REPORT_ID_CHUNK).map((part) =>
      fetchAllPages<IssueRow>(async (from, to) => {
        const { data, error } = await supabase
          .from('gn_report_issues')
          .select(ISSUE_COLUMNS)
          .in('report_id', part)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as IssueRow[];
      }),
    ),
  );
  return pages.flat().map(toIssue);
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
