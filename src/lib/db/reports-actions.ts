'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { getPreviousReport } from '@/lib/db/reports';
import { copyableLines, saveErrorMessage, toLineRows, toReportRow } from '@/lib/report/rows';
import { validateReport, type SaveInput } from '@/lib/report/schema';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ReportLine } from '@/lib/types';

// 日報の保存（Server Actions）。本番では throw した文言がクライアントに届かないため、
// 例外は投げずに { ok, error } を返す。

export type SaveReportResult = { ok: true; id: string } | { ok: false; error: string };
export type CopyPreviousResult =
  | { ok: true; date: string; lines: ReportLine[] }
  | { ok: false; error: string };

export async function saveReport(input: SaveInput): Promise<SaveReportResult> {
  await requireProfile();
  const checked = validateReport(input);
  if (!checked.ok) return { ok: false, error: checked.errors[0] };
  // 検証後の lines は正規化済み（金額のみ → qty=1・unitPrice=金額、amountOnly なし）。
  const v = checked.value;

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.rpc('gn_save_report', {
      p_report: toReportRow(v),
      p_lines: toLineRows(v.lines, v.common),
    });
    if (error) {
      console.error('[gn_save_report]', error.message);
      return { ok: false, error: saveErrorMessage(error.message) };
    }
    revalidatePath('/');
    revalidatePath(`/sites/${v.siteId}`);
    revalidatePath(`/sites/${v.siteId}/reports/${v.date}`);
    return { ok: true, id: String(data) };
  } catch (e) {
    console.error('[saveReport]', e);
    return { ok: false, error: saveErrorMessage(null) };
  }
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

export type ReportStateResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = '処理に失敗しました。もう一度お試しください。';
const reportIdSchema = z.guid();
const reasonSchema = z.string().trim().min(1, '差戻しの理由を入力してください').max(500, '理由は500文字以内で入力してください');

function stateErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
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
  options?: { adminOnly?: boolean; noopFrom?: string },
): Promise<ReportStateResult> {
  const profile = await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  if (options?.adminOnly && !profile.isAdmin) return { ok: false, error: '管理者のみ承認を解除できます' };

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
      .select('id');
    if (error) {
      console.error('[changeState]', error.message);
      return { ok: false, error: stateErrorMessage(error.message) };
    }
    if (!data || data.length === 0) return { ok: false, error: badState };

    revalidatePath('/');
    revalidatePath('/approvals');
    revalidatePath(`/approvals/${reportId}`);
    revalidatePath(`/sites/${h.site_id}`);
    revalidatePath(`/sites/${h.site_id}/reports/${h.report_date}`);
    return { ok: true };
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

/** 管理者のみ approved → draft。 */
export async function reopenReport(reportId: string): Promise<ReportStateResult> {
  return changeState(reportId, ['approved'], '承認済みの日報ではありません', () => ({ status: 'draft' }), { adminOnly: true });
}

// ─── 重要事項の件 ───
// 日報の保存とは別に、件単位で追加・完了にする。site_id は DB のトリガーが親の日報から設定する
// （列は not null のため、日報の site_id を読んで渡す）。

export type AddIssueResult = { ok: true; id: string } | { ok: false; error: string };

const issueBodySchema = z.string().trim().min(1, '件の内容を入力してください').max(500, '件の内容は500文字以内で入力してください');
const NOT_FOUND = '日報が見つからないか、権限がありません';

function issueErrorMessage(dbMessage: string | null | undefined): string {
  return (dbMessage ?? '').includes('report_not_found') ? NOT_FOUND : GENERIC_ERROR;
}

function revalidateIssuePages(siteId: string, reportDate: string) {
  revalidatePath(`/sites/${siteId}`);
  revalidatePath(`/sites/${siteId}/reports/${reportDate}`);
}

export async function addIssue(reportId: string, body: string): Promise<AddIssueResult> {
  await requireProfile();
  if (!reportIdSchema.safeParse(reportId).success) return { ok: false, error: '日報の指定が正しくありません' };
  const b = issueBodySchema.safeParse(body);
  if (!b.success) return { ok: false, error: b.error.issues[0].message };

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
      .insert({ report_id: reportId, site_id: h.site_id, body: b.data })
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

/** 件を完了にする／対応中に戻す。完了日は指定がなければ今日（日本時間）、戻すときは消す。 */
export async function setIssueDone(issueId: string, done: boolean, doneAt?: string): Promise<ReportStateResult> {
  await requireProfile();
  if (!z.guid().safeParse(issueId).success) return { ok: false, error: '件の指定が正しくありません' };
  if (doneAt !== undefined && !dateSchema.safeParse(doneAt).success) return { ok: false, error: '完了日の指定が正しくありません' };

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_report_issues')
      .update({ status: done ? 'done' : 'open', done_at: done ? (doneAt ?? todayJst()) : null })
      .eq('id', issueId)
      .select('site_id, report_id');
    if (error) {
      console.error('[setIssueDone]', error.message);
      return { ok: false, error: issueErrorMessage(error.message) };
    }
    const row = (data ?? [])[0] as { site_id: string; report_id: string } | undefined;
    if (!row) return { ok: false, error: '件が見つからないか、権限がありません' };

    const { data: head } = await supabase.from('gn_daily_reports').select('report_date').eq('id', row.report_id).maybeSingle();
    revalidatePath(`/sites/${row.site_id}`);
    // 他の日報のバナーにも出ているため、現場の日報ページ全体を更新対象にする。
    revalidatePath(`/sites/${row.site_id}/reports/[date]`, 'page');
    if (head) revalidatePath(`/sites/${row.site_id}/reports/${(head as { report_date: string }).report_date}`);
    return { ok: true };
  } catch (e) {
    console.error('[setIssueDone]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}
