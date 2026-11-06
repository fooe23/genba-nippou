'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  clientConfirmationSchema,
  unchangedConfirmationResult,
  type ClientConfirmationColumns,
  type ClientConfirmationInput,
} from '@/lib/db/client-confirmation-schemas';
import {
  fixRequestReasonSchema,
  issueExtraSchema,
  issueSettlementSchema,
  issueStatusPatch,
  newIssueStatusSchema,
  type IssueExtraInput,
  type IssueSettlementInput,
  type NewIssueStatus,
} from '@/lib/db/issue-schemas';
import { dateSchema } from '@/lib/db/masters-schemas';
import { todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listLeaseItems, listVehicles, listWorkers } from '@/lib/db/masters';
import { getPreviousReport } from '@/lib/db/reports';
import { getSettings } from '@/lib/db/settings';
import {
  copyableLines,
  FIX_REQUEST_DUPLICATE_MESSAGE,
  fixRequestErrorMessage,
  reopenErrorMessage,
  saveErrorMessage,
  SITE_CLOSED_MESSAGE,
  STALE_CONFIRMATION_MESSAGE,
  STALE_REPORT_MESSAGE,
  toLineRows,
  toReportRow,
} from '@/lib/report/rows';
import { usesFixedAmount } from '@/lib/report/change-labels';
import { applyMasterSnapshots, EMPTY_SNAPSHOT_MASTERS, needsMasterSnapshots, type StoredAffiliations } from '@/lib/report/snapshots';
import { validateReport, type SaveInput } from '@/lib/report/schema';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSupplierRoles } from '@/lib/db/supplier-roles';
import { creditSupplierError } from '@/lib/calc/supplier-roles';
import type { IssueStatus, ReportLine } from '@/lib/types';

// 日報の保存（Server Actions）。本番では throw した文言がクライアントに届かないため、
// 例外は投げずに { ok, error } を返す。

/** updatedAt は保存後の日報の updated_at（次の保存の expectedUpdatedAt に使う）。stale は他の端末で更新・削除されていたとき。 */
export type SaveReportResult =
  | { ok: true; id: string; updatedAt: string | null }
  | { ok: false; error: string; stale?: boolean };
export type CopyPreviousResult =
  | { ok: true; date: string; lines: ReportLine[] }
  | { ok: false; error: string };

// PostgREST が返す timestamptz の文字列（例 2026-10-30T12:34:56.123456+00:00）。
const timestampSchema = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/);
const STALE_VERSION_ERROR = '日報の版の指定が正しくありません。画面を再読み込みしてください。';

/**
 * 日報を保存する。expectedUpdatedAt は画面を開いたとき（または前回保存したとき）の updated_at。
 * 渡すと DB がいまの updated_at と比べ、違えば stale_report（他の端末で更新された）で止める。
 */
export async function saveReport(input: SaveInput, expectedUpdatedAt?: string | null): Promise<SaveReportResult> {
  await requireProfile();
  const checked = validateReport(input);
  if (!checked.ok) return { ok: false, error: checked.errors[0] };
  // 検証後の lines は正規化済み（金額のみ → qty=1・unitPrice=金額、amountOnly なし）。
  const v = checked.value;
  const expected = expectedUpdatedAt ?? null;
  if (expected !== null && !timestampSchema.safeParse(expected).success) {
    return { ok: false, error: STALE_VERSION_ERROR };
  }

  try {
    // 買掛の行の会社：新しく協力会社だけの会社を選んでいれば止める。この日報に保存済みの会社は印を外した後も保存し直せる。
    const creditIds = v.lines.flatMap((l) => (l.kind === 'credit' && l.supplierId ? [l.supplierId] : []));
    if (creditIds.length > 0) {
      const supabase = await createServerSupabase();
      const [roles, stored] = await Promise.all([
        loadSupplierRoles(supabase, creditIds),
        loadStoredCreditSuppliers(v.siteId, v.date),
      ]);
      const creditError = creditSupplierError(creditIds, roles, stored);
      if (creditError) return { ok: false, error: creditError };
    }

    // マスターを参照している行の単価（日当・残業単価・リース単価・燃費）はサーバーで決め直す。保存した値が
    // その日の単価の複写（スナップショット）になり、集計はこの値を使う。画面のプレビューは従来どおり。
    const [lines, settings] = await Promise.all([
      // 参照の無い行だけでも、手入力の作業員の行の所属・常用請負をそろえる（マスターは読まない）。
      // この日報に保存済みの作業員の所属の写しは保存し直しでも変えない（prev）。
      needsMasterSnapshots(v.lines)
        ? Promise.all([loadSnapshotMasters(), loadStoredAffiliations(v.siteId, v.date)]).then(([m, prev]) =>
            applyMasterSnapshots(v.lines, v.date, m, prev),
          )
        : applyMasterSnapshots(v.lines, v.date, EMPTY_SNAPSHOT_MASTERS),
      getSettings(),
    ]);

    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('gn_save_report', {
      p_report: { ...toReportRow(v), expected_updated_at: expected },
      // 人工・残業・労務費は DB のトリガーが gn_settings で計算し直す（ここで送る値は同じ式の参考値）。
      p_lines: toLineRows(lines, v.common, settings.rule),
    });
    if (error) {
      console.error('[gn_save_report]', error.message);
      const message = saveErrorMessage(error.message);
      return { ok: false, error: message, ...(message === STALE_REPORT_MESSAGE ? { stale: true } : {}) };
    }
    const id = String(data);
    // 次の保存の楽観ロックに使う版。読めなくても保存は済んでいるので null で返す（次回は比べない）。
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('updated_at')
      .eq('id', id)
      .maybeSingle();
    if (headError) console.error('[saveReport:updated_at]', headError.message);
    revalidatePath('/');
    revalidatePath(`/sites/${v.siteId}`);
    revalidatePath('/sites/[siteId]/reports/[date]', 'page');
    return { ok: true, id, updatedAt: (head as { updated_at: string | null } | null)?.updated_at ?? null };
  } catch (e) {
    console.error('[saveReport]', e);
    return { ok: false, error: saveErrorMessage(null) };
  }
}

/** その日報に保存済みの買掛の行の会社（gn_report_lines.ref_id）。日報が無ければ空。 */
async function loadStoredCreditSuppliers(siteId: string, date: string): Promise<string[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select('gn_report_lines(ref_id)')
    .eq('site_id', siteId)
    .eq('report_date', date)
    .eq('gn_report_lines.kind', 'credit')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { gn_report_lines: { ref_id: string | null }[] | null } | null)?.gn_report_lines ?? [])
    .map((r) => r.ref_id)
    .filter((id): id is string => !!id);
}

/** その日報に保存済みの作業員の行の所属の写し（作業員 ID ごと。同じ作業員が複数行あれば最初の行）。日報が無ければ空。 */
async function loadStoredAffiliations(siteId: string, date: string): Promise<StoredAffiliations> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_daily_reports')
    .select('gn_report_lines(ref_id, affiliation, supplier_id, labor_contract, sort_order)')
    .eq('site_id', siteId)
    .eq('report_date', date)
    .eq('gn_report_lines.kind', 'labor')
    .maybeSingle();
  if (error) throw new Error(error.message);
  type Row = { ref_id: string | null; affiliation: string | null; supplier_id: string | null; labor_contract: string | null; sort_order: number | null };
  const rows = ((data as { gn_report_lines: Row[] | null } | null)?.gn_report_lines ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const out: StoredAffiliations = new Map();
  for (const r of rows) {
    if (!r.ref_id || out.has(r.ref_id)) continue;
    out.set(r.ref_id, {
      affiliation: r.affiliation === 'own' || r.affiliation === 'partner' ? r.affiliation : null,
      supplierId: r.supplier_id,
      laborContract: r.labor_contract === 'jouyou' || r.labor_contract === 'ukeoi' ? r.labor_contract : null,
    });
  }
  return out;
}

async function loadSnapshotMasters() {
  const [workers, vehicles, leaseItems] = await Promise.all([listWorkers(), listVehicles(), listLeaseItems()]);
  return { workers, vehicles, leaseItems };
}

/** 前回の日報から作業員・車両・リースを複写する（個別時間・走行距離は空、リース数量はそのまま）。 */
export async function copyPreviousReport(siteId: string, date: string): Promise<CopyPreviousResult> {
  await requireProfile();
  if (!z.guid().safeParse(siteId).success || !dateSchema.safeParse(date).success) {
    return { ok: false, error: '現場または日付の指定が正しくありません' };
  }
  try {
    const prev = await getPreviousReport(siteId, date);
    if (!prev || !prev.head) return { ok: false, error: '前回の日報がありません' };
    return { ok: true, date: prev.head.reportDate, lines: copyableLines(prev.lines) };
  } catch (e) {
    console.error('[copyPreviousReport]', e);
    return { ok: false, error: '前回の日報を読み込めませんでした。通信状況を確認してもう一度お試しください。' };
  }
}

// ─── 提出・承認・差戻し・承認解除 ───
// いずれも { ok } を返す（throw しない）。権限は DB のガードトリガー（gn_report_guard）が最終判定する。

/** updatedAt は状態を変えたあとの日報の updated_at（日報画面の楽観ロック用。変更が無かったときは無し）。 */
export type ReportStateResult = { ok: true; updatedAt?: string | null } | { ok: false; error: string };

const GENERIC_ERROR = '処理に失敗しました。もう一度お試しください。';
const reportIdSchema = z.guid();
const reasonSchema = z.string().trim().min(1, '差戻しの理由を入力してください').max(500, '理由は500文字以内で入力してください');

function stateErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  if (m.includes('not_reviewer')) return 'この現場の確認者・承認者ではありません';
  if (m.includes('approved_report_locked')) return '承認済みのため編集できません';
  return GENERIC_ERROR;
}

interface StateHead {
  site_id: string;
  report_date: string;
  status: string;
}

/** 状態を変更する共通処理。from に含まれる状態の日報だけを更新する（条件付き update で競合を防ぐ）。 */
async function changeState(
  reportId: string,
  from: string[],
  badState: string,
  patch: (userId: string) => Record<string, string | null>,
  options?: { noopFrom?: string; errorMessage?: (dbMessage: string) => string | null },
): Promise<ReportStateResult> {
  const profile = await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };

  try {
    const supabase = await createServerSupabase();
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('site_id, report_date, status')
      .eq('id', reportId)
      .maybeSingle();
    if (headError) {
      console.error('[changeState:head]', headError.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!head) return { ok: false, error: '日報が見つかりません' };
    const h = head as StateHead;
    // すでに目的の状態（提出済みの再提出）なら何も変えずに成功とする。
    if (options?.noopFrom && h.status === options.noopFrom) return { ok: true };
    if (!from.includes(h.status)) return { ok: false, error: badState };

    const { data, error } = await supabase
      .from('gn_daily_reports')
      .update(patch(profile.id))
      .eq('id', reportId)
      .in('status', from)
      .select('id, updated_at');
    if (error) {
      console.error('[changeState]', error.message);
      return { ok: false, error: options?.errorMessage?.(error.message) ?? stateErrorMessage(error.message) };
    }
    if (!data || data.length === 0) return { ok: false, error: badState };

    revalidatePath('/');
    revalidatePath('/approvals');
    revalidatePath(`/approvals/${reportId}`);
    revalidatePath(`/sites/${h.site_id}`);
    revalidatePath(`/sites/${h.site_id}/reports/${h.report_date}`);
    return { ok: true, updatedAt: (data[0] as { updated_at?: string | null }).updated_at ?? null };
  } catch (e) {
    console.error('[changeState]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** draft / rejected → submitted。担当者は rejected_reason に触れない（ガードトリガーで拒否されるため）。 */
export async function submitReport(reportId: string): Promise<ReportStateResult> {
  return changeState(reportId, ['draft', 'rejected'], '提出できる状態ではありません', () => ({ status: 'submitted' }), {
    noopFrom: 'submitted',
  });
}

/** submitted → approved。差戻し理由はここで消す。 */
export async function approveReport(reportId: string): Promise<ReportStateResult> {
  return changeState(reportId, ['submitted'], '承認待ちの日報ではありません', (uid) => ({
    status: 'approved',
    approved_by: uid,
    approved_at: new Date().toISOString(),
    reviewed_by: uid,
    rejected_reason: null,
  }));
}

/** submitted → rejected（理由必須）。 */
export async function rejectReport(reportId: string, reason: string): Promise<ReportStateResult> {
  const r = reasonSchema.safeParse(reason);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  return changeState(reportId, ['submitted'], '承認待ちの日報ではありません', (uid) => ({
    status: 'rejected',
    reviewed_by: uid,
    rejected_reason: r.data,
  }));
}

/**
 * approved → draft（承認解除）。承認・確認の記録も消す（再提出・再承認でまた入る）。
 * できるのはその現場の確認者・承認者と管理者。アプリでは判定せず DB のガード（gn_report_guard）に任せ、
 * 権限が無いとき（not_reviewer / approved_report_locked）は「確認者・承認者か管理者だけ」の文言にする。
 * 下書きに戻ると、その日報の未解決の修正申請は DB のトリガーが解決にする。
 */
export async function reopenReport(reportId: string): Promise<ReportStateResult> {
  return changeState(
    reportId,
    ['approved'],
    '承認済みの日報ではありません',
    () => ({ status: 'draft', approved_by: null, approved_at: null, reviewed_by: null }),
    { errorMessage: reopenErrorMessage },
  );
}

/**
 * 日報の修正申請（提出済み・承認済みの日報に、添付の付け忘れなどで直したいときに理由を付けて出す）。
 * 現場メンバーが出せる。協力会社のアカウントは自分が作った日報だけ。現場・申請者・日時は DB のトリガーが入れる。
 * 確認者・承認者・管理者が差戻しか承認解除で下書きに戻すと解決になる（DB のトリガー）。
 */
export async function requestReportFix(reportId: string, reason: string): Promise<ReportStateResult> {
  await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  const r = fixRequestReasonSchema.safeParse(reason);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };

  try {
    const supabase = await createServerSupabase();
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('site_id, report_date, status')
      .eq('id', reportId)
      .maybeSingle();
    if (headError) {
      console.error('[requestReportFix:head]', headError.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!head) return { ok: false, error: '日報が見つかりません' };
    const h = head as StateHead;
    if (h.status !== 'submitted' && h.status !== 'approved') {
      return { ok: false, error: '修正の申請は、提出済みか承認済みの日報だけ出せます' };
    }

    // site_id は not null。DB のトリガーが日報の現場で上書きする。
    const { error } = await supabase.from('gn_report_fix_requests').insert({ report_id: reportId, site_id: h.site_id, reason: r.data });
    if (error) {
      console.error('[requestReportFix]', error.message);
      if (error.code === '23505') return { ok: false, error: FIX_REQUEST_DUPLICATE_MESSAGE };
      return { ok: false, error: fixRequestErrorMessage(error.message) ?? GENERIC_ERROR };
    }
    revalidatePath('/approvals');
    revalidatePath(`/approvals/${reportId}`);
    revalidatePath(`/sites/${h.site_id}/reports/${h.report_date}`);
    return { ok: true };
  } catch (e) {
    console.error('[requestReportFix]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * 日報を削除する（明細・重要事項の件も消える）。管理者はどの状態でも、作成者本人は下書き・差戻しだけ。
 * 最終判定は RLS（gn_daily_reports_delete）。ここでも同じ条件で絞り、消えた行が無ければ削除できない状態とする。
 */
export async function deleteReport(reportId: string): Promise<ReportStateResult> {
  const profile = await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  const CANNOT = '削除できる状態ではありません';

  try {
    const supabase = await createServerSupabase();
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('site_id, report_date, status, created_by')
      .eq('id', reportId)
      .maybeSingle();
    if (headError) {
      console.error('[deleteReport:head]', headError.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!head) return { ok: false, error: '日報が見つかりません' };
    const h = head as StateHead & { created_by: string | null };
    if (!profile.isAdmin && (h.created_by !== profile.id || !['draft', 'rejected'].includes(h.status))) {
      return { ok: false, error: CANNOT };
    }

    let q = supabase.from('gn_daily_reports').delete().eq('id', reportId);
    if (!profile.isAdmin) q = q.eq('created_by', profile.id).in('status', ['draft', 'rejected']);
    const { data, error } = await q.select('id');
    if (error) {
      console.error('[deleteReport]', error.message);
      return { ok: false, error: error.message.includes('site_closed') ? SITE_CLOSED_MESSAGE : GENERIC_ERROR };
    }
    if (!data || data.length === 0) return { ok: false, error: CANNOT };

    revalidatePath('/');
    revalidatePath('/approvals');
    revalidatePath(`/approvals/${reportId}`);
    revalidatePath(`/sites/${h.site_id}`);
    revalidatePath(`/sites/${h.site_id}/summary`);
    revalidatePath('/sites/[siteId]/reports/[date]', 'page');
    return { ok: true };
  } catch (e) {
    console.error('[deleteReport]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

// ─── 客先確認の記録 ───
// 日報の保存（gn_save_report）とは別に、客先確認の3列（client_confirmed_*）だけを書く。現場メンバー（RLS）なら
// 誰でも、どの状態（下書き・提出・承認・差戻し）でも、完了した現場でも記録できる（gn_report_guard が3列だけの変更を通す）。

export type ClientConfirmationResult = { ok: true; updatedAt: string | null } | { ok: false; error: string; stale?: boolean };

async function writeClientConfirmation(
  tag: string,
  reportId: string,
  patch: ClientConfirmationColumns,
  expectedUpdatedAt: string | null | undefined,
): Promise<ClientConfirmationResult> {
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  const expected = expectedUpdatedAt ?? null;
  if (expected !== null && !timestampSchema.safeParse(expected).success) return { ok: false, error: STALE_VERSION_ERROR };

  try {
    const supabase = await createServerSupabase();
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('site_id, report_date, updated_at, client_confirmed_by, client_confirmed_at, client_confirmed_note')
      .eq('id', reportId)
      .maybeSingle();
    if (headError) {
      console.error(`[${tag}:head]`, headError.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!head) return { ok: false, error: NOT_FOUND };
    const h = head as {
      site_id: string;
      report_date: string;
      updated_at: string | null;
      client_confirmed_by: string | null;
      client_confirmed_at: string | null;
      client_confirmed_note: string | null;
    };
    // 同じ内容の記録し直し・記録の無い日報の取り消しは書かずに済ませる（unchangedConfirmationResult）。
    const unchanged = unchangedConfirmationResult(h, patch, expected);
    if (unchanged) return unchanged;

    // 楽観ロック：画面を開いた（前回保存した）ときの版と同じときだけ書く（saveReport と同じ）。
    let q = supabase.from('gn_daily_reports').update(patch).eq('id', reportId);
    if (expected !== null) q = q.eq('updated_at', expected);
    const { data, error } = await q.select('id, updated_at');
    if (error) {
      console.error(`[${tag}]`, error.message);
      return { ok: false, error: stateErrorMessage(error.message) };
    }
    if (!data || data.length === 0) {
      return expected !== null ? { ok: false, error: STALE_CONFIRMATION_MESSAGE, stale: true } : { ok: false, error: NOT_FOUND };
    }

    revalidatePath(`/sites/${h.site_id}`);
    revalidatePath(`/sites/${h.site_id}/reports/${h.report_date}`);
    revalidatePath(`/approvals/${reportId}`);
    return { ok: true, updatedAt: (data[0] as { updated_at?: string | null }).updated_at ?? null };
  } catch (e) {
    console.error(`[${tag}]`, e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * 客先確認を記録する（確認者名・日時・メモ。記録し直すと上書き）。expectedUpdatedAt を渡すと、その版のときだけ書き、
 * 違えば stale（他の端末で更新された）。updatedAt は記録後の版（日報画面の楽観ロック用）。
 */
export async function recordClientConfirmation(
  reportId: string,
  input: ClientConfirmationInput,
  expectedUpdatedAt?: string | null,
): Promise<ClientConfirmationResult> {
  await requireProfile();
  const v = clientConfirmationSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? '入力内容が正しくありません' };
  return writeClientConfirmation(
    'recordClientConfirmation',
    reportId,
    { client_confirmed_by: v.data.confirmedBy, client_confirmed_at: v.data.confirmedAt, client_confirmed_note: v.data.note || null },
    expectedUpdatedAt,
  );
}

/** 客先確認の記録を取り消す（3列を空にする。記録の間違い用）。条件は recordClientConfirmation と同じ。 */
export async function clearClientConfirmation(reportId: string, expectedUpdatedAt?: string | null): Promise<ClientConfirmationResult> {
  await requireProfile();
  return writeClientConfirmation(
    'clearClientConfirmation',
    reportId,
    { client_confirmed_by: null, client_confirmed_at: null, client_confirmed_note: null },
    expectedUpdatedAt,
  );
}

// ─── 重要事項の件 ───
// 日報の保存とは別に、件単位で追加・完了にする。site_id は DB のトリガーが親の日報から設定する
// （列は not null のため、日報の site_id を読んで渡す）。

export type AddIssueResult = { ok: true; id: string } | { ok: false; error: string };

const issueBodySchema = z.string().trim().min(1, '件の内容を入力してください').max(500, '件の内容は500文字以内で入力してください');
const NOT_FOUND = '日報が見つからないか、権限がありません';

const PARTNER_SETTLEMENT_MESSAGE = '協力会社は精算の項目を変更できません';

function issueErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  // 協力会社が精算の項目（精算の方法・確定額・常用単価・確定日）を変えようとした（gn_report_issues_guard）
  if (m.includes('not_employee')) return PARTNER_SETTLEMENT_MESSAGE;
  return m.includes('report_not_found') ? NOT_FOUND : GENERIC_ERROR;
}

function revalidateIssuePages(siteId: string, reportDate: string) {
  revalidatePath(`/sites/${siteId}`);
  revalidatePath(`/sites/${siteId}/reports/${reportDate}`);
}

/**
 * 件を追加する。extra（種別・指示者・指示方法・金額見込み・状態）は省略でき、
 * 省略時は種別「その他」・指示なし・対応中。状態は見積中か対応中だけ選べる。
 */
export async function addIssue(
  reportId: string,
  body: string,
  extra?: IssueExtraInput & { status?: NewIssueStatus },
): Promise<AddIssueResult> {
  await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  const b = issueBodySchema.safeParse(body);
  if (!b.success) return { ok: false, error: b.error.issues[0].message };
  const x = issueExtraSchema.safeParse(extra ?? {});
  if (!x.success) return { ok: false, error: x.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const st = newIssueStatusSchema.safeParse(extra?.status);
  if (!st.success) return { ok: false, error: st.error.issues[0].message };

  try {
    const supabase = await createServerSupabase();
    const { data: head, error: headError } = await supabase
      .from('gn_daily_reports')
      .select('site_id, report_date')
      .eq('id', reportId)
      .maybeSingle();
    if (headError) {
      console.error('[addIssue:head]', headError.message);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (!head) return { ok: false, error: NOT_FOUND };
    const h = head as { site_id: string; report_date: string };

    const { data, error } = await supabase
      .from('gn_report_issues')
      .insert({
        report_id: reportId,
        site_id: h.site_id,
        body: b.data,
        kind: x.data.kind,
        instructed_by: x.data.instructedBy,
        instruction_method: x.data.instructionMethod,
        amount_estimate: x.data.amountEstimate,
        status: st.data,
      })
      .select('id')
      .single();
    if (error) {
      console.error('[addIssue]', error.message);
      return { ok: false, error: issueErrorMessage(error.message) };
    }
    revalidateIssuePages(h.site_id, h.report_date);
    return { ok: true, id: String((data as { id: string }).id) };
  } catch (e) {
    console.error('[addIssue]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * 件の状態を変える（見積中・対応中・完了のどれにも直接）。完了日は完了のときだけ入れ（指定がなければ今日・日本時間）、
 * 見積中・対応中に変えると消す。
 */
export async function setIssueStatus(issueId: string, status: IssueStatus, doneAt?: string): Promise<ReportStateResult> {
  await requireProfile();
  if (!z.guid().safeParse(issueId).success) return { ok: false, error: '件の指定が正しくありません' };
  const p = issueStatusPatch(status, doneAt, todayJst());
  if (!p.ok) return { ok: false, error: p.error };

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_report_issues')
      .update(p.patch)
      .eq('id', issueId)
      .select('site_id');
    if (error) {
      console.error('[setIssueStatus]', error.message);
      return { ok: false, error: issueErrorMessage(error.message) };
    }
    const row = (data ?? [])[0] as { site_id: string } | undefined;
    if (!row) return { ok: false, error: '件が見つからないか、権限がありません' };

    revalidatePath(`/sites/${row.site_id}`);
    // 他の日報のバナーにも出ているため、日報ページ全体を更新対象にする（動的セグメントのパターン指定）。
    revalidatePath('/sites/[siteId]/reports/[date]', 'page');
    return { ok: true };
  } catch (e) {
    console.error('[setIssueStatus]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export type IssueSettlementResult = { ok: true } | { ok: false; error: string };

/**
 * 件の精算の項目（精算の方法・確定額・常用単価・確定日）を変える。社員（管理者を含む）だけ。協力会社は拒否する。
 * 一式・見積でないときは確定額、常用でないときは常用単価を null にして保存する（方法を切り替えると他方は消える）。
 * 完了した現場の件は DB のガード（site_closed）が止める。協力会社の直接の更新も DB のガード（not_employee）が止める。
 */
export async function updateIssueSettlement(issueId: string, input: IssueSettlementInput): Promise<IssueSettlementResult> {
  const profile = await requireProfile();
  if (profile.accountType === 'partner') return { ok: false, error: PARTNER_SETTLEMENT_MESSAGE };
  if (!z.guid().safeParse(issueId).success) return { ok: false, error: '件の指定が正しくありません' };
  const parsed = issueSettlementSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_report_issues')
      .update({
        settlement_method: v.settlementMethod,
        fixed_amount: usesFixedAmount(v.settlementMethod) ? v.fixedAmount : null,
        daily_rate: v.settlementMethod === 'daily_rate' ? v.dailyRate : null,
        fixed_on: v.fixedOn,
      })
      .eq('id', issueId)
      .select('site_id');
    if (error) {
      console.error('[updateIssueSettlement]', error.message);
      return { ok: false, error: issueErrorMessage(error.message) };
    }
    const row = (data ?? [])[0] as { site_id: string } | undefined;
    if (!row) return { ok: false, error: '件が見つからないか、権限がありません' };

    // 現場詳細・集計（追加・変更の台帳）・帳票・日報のどこにも件が出るため、その現場の下を全部更新する。
    revalidatePath(`/sites/${row.site_id}`, 'layout');
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('[updateIssueSettlement]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}
