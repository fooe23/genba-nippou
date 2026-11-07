import 'server-only';
import { chunk } from '@/lib/calc/paging';
import {
  ATTACHMENT_COLUMNS,
  fromAttachmentRow,
  SIGNED_URL_SECONDS,
  type Attachment,
  type AttachmentRow,
} from '@/lib/db/attachments-schemas';
import { createServerSupabase } from '@/lib/supabase/server';

// 日報・件の添付の読み取り（RLS 前提）。協力会社のアカウントには kind = 'file'（見積書など）の行が返らない
// （gn_attachments の select ポリシー）。Storage の gn-estimates も社員・管理者しか読めないので、署名付き URL も作れない。

const ID_CHUNK = 200;

function toAttachments(rows: AttachmentRow[]): Attachment[] {
  return rows.flatMap((r) => {
    const a = fromAttachmentRow(r);
    return a ? [a] : [];
  });
}

/** 日報に付けた添付（件の添付は含まない）。並びは sort_order・付けた順。 */
export async function listAttachmentsForReport(reportId: string): Promise<Attachment[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('gn_attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('report_id', reportId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`[listAttachmentsForReport] ${error.message}`);
  return toAttachments((data ?? []) as AttachmentRow[]);
}

/** 件ごとの添付（件の id → 添付）。添付の無い件はキーが無い。 */
export async function listAttachmentsForIssues(issueIds: string[]): Promise<Map<string, Attachment[]>> {
  const out = new Map<string, Attachment[]>();
  const unique = [...new Set(issueIds)];
  if (unique.length === 0) return out;
  const supabase = await createServerSupabase();
  const parts = await Promise.all(
    chunk(unique, ID_CHUNK).map(async (part) => {
      const { data, error } = await supabase
        .from('gn_attachments')
        .select(ATTACHMENT_COLUMNS)
        .in('issue_id', part)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw new Error(`[listAttachmentsForIssues] ${error.message}`);
      return toAttachments((data ?? []) as AttachmentRow[]);
    }),
  );
  for (const a of parts.flat()) {
    if (!a.issueId) continue;
    const list = out.get(a.issueId);
    if (list) list.push(a);
    else out.set(a.issueId, [a]);
  }
  return out;
}

/**
 * 画面で表示・開くための URL。写真・ファイルは署名付き URL（有効期限 1 時間）、リンクはその URL。
 * 作れない（権限が無い・実体が無い）ときは空文字（ログに残す）。
 */
export async function signedUrl(attachment: Attachment): Promise<string> {
  if (attachment.kind === 'link') return attachment.url ?? '';
  if (!attachment.storageBucket || !attachment.storagePath) return '';
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage
    .from(attachment.storageBucket)
    .createSignedUrl(attachment.storagePath, SIGNED_URL_SECONDS);
  if (error || !data) {
    console.error('[signedUrl]', attachment.id, error?.message);
    return '';
  }
  return data.signedUrl;
}

/** 一覧用にまとめて署名する（バケットごとに 1 回）。添付の id → URL。作れなかったものはキーが無い。 */
export async function signedUrls(attachments: Attachment[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byBucket = new Map<string, Attachment[]>();
  for (const a of attachments) {
    if (a.kind === 'link') {
      if (a.url) out.set(a.id, a.url);
      continue;
    }
    if (!a.storageBucket || !a.storagePath) continue;
    const list = byBucket.get(a.storageBucket);
    if (list) list.push(a);
    else byBucket.set(a.storageBucket, [a]);
  }
  if (byBucket.size === 0) return out;
  const supabase = await createServerSupabase();
  await Promise.all(
    [...byBucket].map(async ([bucket, list]) => {
      const byPath = new Map(list.map((a) => [a.storagePath as string, a.id]));
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls([...byPath.keys()], SIGNED_URL_SECONDS);
      if (error || !data) {
        console.error('[signedUrls]', bucket, error?.message);
        return;
      }
      for (const d of data) {
        const id = d.path ? byPath.get(d.path) : undefined;
        if (id && d.signedUrl && !d.error) out.set(id, d.signedUrl);
      }
    }),
  );
  return out;
}
