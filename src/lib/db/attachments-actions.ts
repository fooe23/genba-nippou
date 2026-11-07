'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ATTACHMENT_EXISTS_MESSAGE,
  attachmentErrorMessage,
  attachmentStorage,
  canonicalFileMime,
  commitInputSchema,
  defaultClientVisible,
  FILE_NOT_ALLOWED_MESSAGE,
  ISSUE_DONE_MESSAGE,
  linkInputSchema,
  MAX_ATTACHMENT_BYTES,
  OBJECT_MISSING_MESSAGE,
  REPORT_LOCKED_MESSAGE,
  TOO_LARGE_MESSAGE,
  uploadInputSchema,
  type LinkInput,
  type UploadInput,
  type UploadParsed,
} from '@/lib/db/attachments-schemas';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { todayJst } from '@/lib/calc/format';
import { SITE_CLOSED_MESSAGE } from '@/lib/report/rows';
import { createServerSupabase } from '@/lib/supabase/server';

// 日報・件の添付（写真・ファイル・リンク）の操作（Server Actions）。例外は投げずに { ok, error } を返す。
//
// 写真・ファイルの送り方（Server Action にファイルの中身を通さない。Vercel の本文の上限が小さいため）：
//   1. prepareUpload：サーバーが添付先（日報・件）の状態と権限を確かめ、添付の id と保存場所（バケット・パス）を決める。
//   2. 画面がブラウザの Supabase クライアント（createBrowserSupabase）で、そのパスに直接置く
//      （storage.from(bucket).upload(path, blob, { contentType, upsert: false })）。本人のログインで置くので
//      Storage のポリシー（現場メンバー、gn-estimates は社員・管理者だけ、バケットの上限 10MB）が効く。
//   3. commitAttachment：サーバーが実体があること・10MB 以下であることを確かめてから台帳の行を作る。
//      DB のガード（gn_attachments_guard）も、パスの規約・実体の有無・大きさ・日報と件の状態をもう一度確かめる。
//      行を作れなかったときは置いた実体を消す。ただし同じ id の行がもうある（二度押し・再送。DB は attachment_exists）
//      ときは、その行の実体なので決して消さず、行が見えれば成功として返す。
// 署名付きアップロード URL（createSignedUploadUrl）は使わない：ブラウザの通常のアップロードで本人の権限がそのまま効き、
// トークンの受け渡しが要らないため。

export type AttachmentResult = { ok: true } | { ok: false; error: string };
export type PrepareUploadResult =
  | { ok: true; attachmentId: string; bucket: string; path: string }
  | { ok: false; error: string };
export type CommitAttachmentResult = { ok: true; id: string } | { ok: false; error: string };

const GENERIC_ERROR = '処理に失敗しました。もう一度お試しください。';
const TARGET_NOT_FOUND = '日報または件が見つからないか、権限がありません';
const ATTACHMENT_NOT_FOUND = '添付が見つからないか、権限がありません';
const idSchema = z.guid();

interface Target {
  siteId: string;
  reportStatus: string | null;
  issueStatus: string | null;
  siteClosed: boolean;
}

/** 添付先（日報か件）と現場の状態を読む（RLS が効く）。見えなければ null。 */
async function loadTarget(
  supabase: SupabaseClient,
  t: { reportId?: string; issueId?: string },
): Promise<Target | null> {
  let siteId: string;
  let reportStatus: string | null = null;
  let issueStatus: string | null = null;
  if (t.reportId) {
    const { data, error } = await supabase.from('gn_daily_reports').select('site_id, status').eq('id', t.reportId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    siteId = String(data.site_id);
    reportStatus = String(data.status);
  } else if (t.issueId) {
    const { data, error } = await supabase.from('gn_report_issues').select('site_id, status').eq('id', t.issueId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    siteId = String(data.site_id);
    issueStatus = String(data.status);
  } else {
    return null;
  }
  const { data: site, error: siteError } = await supabase
    .from('gn_sites')
    .select('status, deleted_at')
    .eq('id', siteId)
    .maybeSingle();
  if (siteError) throw new Error(siteError.message);
  const siteClosed = !site || site.status !== 'active' || site.deleted_at !== null;
  return { siteId, reportStatus, issueStatus, siteClosed };
}

/** 足せるか（画面で先に止めるため。DB のガードが最終の判定）。足せなければ文言。 */
function addBlockedReason(t: Target): string | null {
  if (t.siteClosed) return SITE_CLOSED_MESSAGE;
  if (t.reportStatus !== null && t.reportStatus !== 'draft' && t.reportStatus !== 'rejected') return REPORT_LOCKED_MESSAGE;
  if (t.issueStatus === 'done') return ISSUE_DONE_MESSAGE;
  return null;
}

function revalidateAttachmentPages(siteId: string) {
  revalidatePath(`/sites/${siteId}`);
  revalidatePath('/sites/[siteId]/reports/[date]', 'page');
  revalidatePath('/approvals/[reportId]', 'page');
}

/** 付けた日：日報の添付は DB が日報の日付にする。件の添付は開いていた日報の画面の日付（無ければ日本時間の今日）。 */
function attachedOn(v: { reportDate?: string }): string {
  return v.reportDate ?? todayJst();
}

async function checkUpload(input: UploadInput): Promise<{ ok: true; v: UploadParsed } | { ok: false; error: string }> {
  const profile = await requireProfile();
  // ファイルは拡張子を信じ、ブラウザの申告した mime が許可の組に無ければ拡張子の標準の mime にする
  const normalized: UploadInput =
    input && input.kind === 'file' && typeof input.name === 'string' && typeof input.mime === 'string'
      ? { ...input, mime: canonicalFileMime(input.name, input.mime) }
      : input;
  const parsed = uploadInputSchema.safeParse(normalized);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  if (parsed.data.kind === 'file' && !isEmployeeOrAdmin(profile)) return { ok: false, error: FILE_NOT_ALLOWED_MESSAGE };
  return { ok: true, v: parsed.data };
}

/**
 * 写真・ファイルを付ける前に、添付の id と保存場所を決める（ファイルの中身は受け取らない）。
 * 添付先が足せない状態（提出済みの日報・完了した件・完了現場）なら、ここで止める。
 */
export async function prepareUpload(input: UploadInput): Promise<PrepareUploadResult> {
  const c = await checkUpload(input);
  if (!c.ok) return c;
  const v = c.v;
  try {
    const supabase = await createServerSupabase();
    const target = await loadTarget(supabase, v);
    if (!target || target.siteId !== v.siteId) return { ok: false, error: TARGET_NOT_FOUND };
    const blocked = addBlockedReason(target);
    if (blocked) return { ok: false, error: blocked };
    const attachmentId = crypto.randomUUID();
    const { bucket, path } = attachmentStorage({ siteId: v.siteId, attachmentId, kind: v.kind, name: v.name });
    return { ok: true, attachmentId, bucket, path };
  } catch (e) {
    console.error('[prepareUpload]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * ブラウザが Storage に置いた写真・ファイルを台帳に載せる。パスは attachmentId から決め直す（画面の値は使わない）。
 * お客様用に載せるかは、件の写真は載せる・日報の写真は載せない（ファイルは常に載せない）。
 */
export async function commitAttachment(
  input: UploadInput & { attachmentId: string; caption?: string },
): Promise<CommitAttachmentResult> {
  const c = await checkUpload(input);
  if (!c.ok) return c;
  const v = c.v;
  const ci = commitInputSchema.safeParse({ attachmentId: input.attachmentId, caption: input.caption });
  if (!ci.success) return { ok: false, error: ci.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const { attachmentId, caption } = ci.data;
  const { bucket, path } = attachmentStorage({ siteId: v.siteId, attachmentId, kind: v.kind, name: v.name });

  try {
    const supabase = await createServerSupabase();
    const storage = supabase.storage.from(bucket);
    const { data: info, error: infoError } = await storage.info(path);
    if (infoError || !info) {
      console.error('[commitAttachment:info]', infoError?.message);
      return { ok: false, error: OBJECT_MISSING_MESSAGE };
    }
    const size = Number(info.size ?? 0);
    if (!Number.isFinite(size) || size > MAX_ATTACHMENT_BYTES) {
      if (!(await attachmentRowExists(supabase, attachmentId))) await removeObject(supabase, bucket, path);
      return { ok: false, error: TOO_LARGE_MESSAGE };
    }

    const { error } = await supabase.from('gn_attachments').insert({
      id: attachmentId,
      // site_id・付けた人・付けた日（日報の添付）・大きさは DB のガードが入れ直す
      site_id: v.siteId,
      report_id: v.reportId ?? null,
      issue_id: v.issueId ?? null,
      kind: v.kind,
      storage_bucket: bucket,
      storage_path: path,
      name: v.name,
      caption: caption ?? '',
      mime: (info.contentType || v.mime || null)?.slice(0, 200) ?? null,
      size_bytes: size,
      client_visible: defaultClientVisible({ kind: v.kind, issueId: v.issueId }),
      attached_on: attachedOn(v),
    });
    if (error) {
      console.error('[commitAttachment]', error.message);
      // 同じ id の行がすでにある（二度押し・再送）ときは、その行の実体なので消さない。見えれば成功として返す
      if (await attachmentRowExists(supabase, attachmentId)) {
        revalidateAttachmentPages(v.siteId);
        return { ok: true, id: attachmentId };
      }
      if (error.code === '23505' || error.message.includes('attachment_exists')) return { ok: false, error: ATTACHMENT_EXISTS_MESSAGE };
      await removeObject(supabase, bucket, path);
      return { ok: false, error: attachmentErrorMessage(error.message) ?? GENERIC_ERROR };
    }
    revalidateAttachmentPages(v.siteId);
    return { ok: true, id: attachmentId };
  } catch (e) {
    console.error('[commitAttachment]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** リンク（G ドライブなど）を付ける。http/https だけ。お客様用には載せない。 */
export async function addLink(input: LinkInput): Promise<CommitAttachmentResult> {
  await requireProfile();
  const parsed = linkInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容が正しくありません' };
  const v = parsed.data;
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_attachments')
      .insert({
        site_id: v.siteId,
        report_id: v.reportId ?? null,
        issue_id: v.issueId ?? null,
        kind: 'link',
        url: v.url,
        name: v.name,
        client_visible: false,
        attached_on: attachedOn(v),
      })
      .select('id, site_id')
      .single();
    if (error) {
      console.error('[addLink]', error.message);
      return { ok: false, error: attachmentErrorMessage(error.message) ?? GENERIC_ERROR };
    }
    const row = data as { id: string; site_id: string };
    revalidateAttachmentPages(row.site_id);
    return { ok: true, id: row.id };
  } catch (e) {
    console.error('[addLink]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** 写真をお客様用 PDF に載せるかを切り替える（提出後も可。社員・管理者と付けた本人）。 */
export async function setAttachmentClientVisible(id: string, visible: boolean): Promise<AttachmentResult> {
  await requireProfile();
  if (!idSchema.safeParse(id).success) return { ok: false, error: ATTACHMENT_NOT_FOUND };
  if (typeof visible !== 'boolean') return { ok: false, error: '入力内容が正しくありません' };
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_attachments')
      .update({ client_visible: visible })
      .eq('id', id)
      .select('site_id');
    if (error) {
      console.error('[setAttachmentClientVisible]', error.message);
      if (error.code === '23514') return { ok: false, error: 'お客様用に載せられるのは写真だけです' };
      return { ok: false, error: attachmentErrorMessage(error.message, 'update') ?? GENERIC_ERROR };
    }
    const row = (data ?? [])[0] as { site_id: string } | undefined;
    if (!row) return { ok: false, error: ATTACHMENT_NOT_FOUND };
    revalidateAttachmentPages(row.site_id);
    return { ok: true };
  } catch (e) {
    console.error('[setAttachmentClientVisible]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/**
 * 添付を消す（付けた本人と管理者。日報の添付は提出前、件の添付は完了前）。Storage の実体も消す。
 * 行を消した後で実体を消せなかったときはログに残して続ける（行は消えているので画面には出ない）。
 */
export async function deleteAttachment(id: string): Promise<AttachmentResult> {
  await requireProfile();
  if (!idSchema.safeParse(id).success) return { ok: false, error: ATTACHMENT_NOT_FOUND };
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_attachments')
      .delete()
      .eq('id', id)
      .select('site_id, storage_bucket, storage_path');
    if (error) {
      console.error('[deleteAttachment]', error.message);
      return { ok: false, error: attachmentErrorMessage(error.message, 'delete') ?? GENERIC_ERROR };
    }
    const row = (data ?? [])[0] as { site_id: string; storage_bucket: string | null; storage_path: string | null } | undefined;
    if (!row) return { ok: false, error: '添付が見つからないか、付けた本人か管理者だけが消せます' };
    if (row.storage_bucket && row.storage_path) await removeObject(supabase, row.storage_bucket, row.storage_path);
    revalidateAttachmentPages(row.site_id);
    return { ok: true };
  } catch (e) {
    console.error('[deleteAttachment]', e);
    return { ok: false, error: GENERIC_ERROR };
  }
}

/** その id の添付の行があるか（RLS で見える範囲。読めなければ「ある」として扱い、実体を消さない）。 */
async function attachmentRowExists(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase.from('gn_attachments').select('id').eq('id', id).maybeSingle();
  if (error) {
    console.error('[attachments:exists]', error.message);
    return true;
  }
  return data !== null;
}

/** Storage の実体を消す。失敗（権限が無く 0 件を含む）はログに残すだけ。 */
async function removeObject(supabase: SupabaseClient, bucket: string, path: string): Promise<void> {
  try {
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) console.error('[attachments:remove]', bucket, path, error.message);
    else if (!data || data.length === 0) console.error('[attachments:remove] not removed', bucket, path);
  } catch (e) {
    console.error('[attachments:remove]', bucket, path, e);
  }
}
