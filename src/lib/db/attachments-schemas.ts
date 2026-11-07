import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { SITE_CLOSED_MESSAGE } from '@/lib/report/rows';

// 日報・件の添付（写真・ファイル・リンク）の入力検証と純関数。サーバー（Server Action）と画面の両方で使う。
// 台帳は gn_attachments（supabase/update_2026-11-09_attachments.sql）。Storage のパスは
//   写真：gn-photos/<site_id>/att/<添付の id>.jpg（写真は画面で JPEG に縮めてから送る）
//   ファイル：gn-estimates/<site_id>/att/<添付の id>.<拡張子>（縮めない。社員・管理者だけ読める）
// 1 つ 10MB まで（写真は縮めた後で）。協力会社のアカウントはファイルを見られない・付けられない（DB・Storage でも防ぐ）。

export const ATTACHMENT_KINDS = ['photo', 'file', 'link'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export const UPLOAD_KINDS = ['photo', 'file'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** 1 つの添付の上限（バイト）。DB の size_bytes の check・バケットの file_size_limit と同じ。 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** 画面で表示する署名付き URL の有効期限（秒）。 */
export const SIGNED_URL_SECONDS = 60 * 60;

export const PHOTO_BUCKET = 'gn-photos';
export const FILE_BUCKET = 'gn-estimates';

/** 付けられるファイルの拡張子と mime。最初の mime が標準（mime が空のときに使う）。 */
export const FILE_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
};

/** 画面のファイル選択（input の accept）に使う。 */
export const FILE_ACCEPT = Object.keys(FILE_TYPES)
  .map((e) => `.${e}`)
  .join(',');

/** 画面・一覧で使う添付（gn_attachments の 1 行）。協力会社には kind = 'file' の行が返らない（RLS）。 */
export interface Attachment {
  id: string;
  siteId: string;
  kind: AttachmentKind;
  name: string;
  caption: string;
  /** リンクの URL（リンクだけ）。 */
  url?: string;
  /** 写真・ファイルの保存場所（リンクには無い）。表示は signedUrl で署名付き URL にする。 */
  storageBucket?: string;
  storagePath?: string;
  mime?: string;
  sizeBytes?: number;
  /** お客様用 PDF に載せるか（写真だけ true になりうる）。 */
  clientVisible: boolean;
  /** 付けた日（日報の添付はその日報の日付、件の添付は付けたときに開いていた日報の日付）。 */
  attachedOn: string;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  issueId?: string;
  reportId?: string;
}

const MSG_TARGET = '添付先（日報か件）の指定が正しくありません';
const MSG_URL = 'リンクは http:// か https:// で始まる URL を入力してください';
const MSG_SIZE = '1 つ 10MB までです'; // TOO_LARGE_MESSAGE と同じ
const MSG_EMPTY_FILE = '空のファイルは付けられません';
const MSG_PHOTO_MIME = '写真は画像のファイルを選んでください';
export const MSG_FILE_TYPE = '付けられるファイルは PDF・Excel・Word・JPEG・PNG です';

export const attachmentNameSchema = z
  .string({ error: '名前を入力してください' })
  .trim()
  .min(1, '名前を入力してください')
  .max(100, '名前は100文字以内で入力してください');

export const attachmentCaptionSchema = z
  .string({ error: 'ひと言は文字で入力してください' })
  .trim()
  .max(200, 'ひと言は200文字以内で入力してください')
  .default('');

export const linkUrlSchema = z
  .string({ error: MSG_URL })
  .trim()
  .max(2000, 'リンクは2000文字以内で入力してください')
  .refine((s) => {
    if (!/^https?:\/\//i.test(s)) return false;
    try {
      const u = new URL(s);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
    } catch {
      return false;
    }
  }, MSG_URL);

const idSchema = z.guid({ error: MSG_TARGET });

// 日報か件のどちらか一方（DB の check と同じ）。reportDate は件に付けるときに開いていた日報の日付（付けた日として残す）。
const targetShape = {
  siteId: z.guid({ error: '現場の指定が正しくありません' }),
  reportId: idSchema.optional(),
  issueId: idSchema.optional(),
  reportDate: dateSchema.optional(),
};
function oneTarget(v: { reportId?: string; issueId?: string }, ctx: z.RefinementCtx) {
  if ((v.reportId === undefined) === (v.issueId === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['reportId'], message: MSG_TARGET });
  }
}

export const linkInputSchema = z
  .object({ ...targetShape, url: linkUrlSchema, name: attachmentNameSchema })
  .superRefine(oneTarget);
export type LinkInput = z.input<typeof linkInputSchema>;

/** 拡張子（小文字・ドットなし）。無い（「.pdf」のような名前も）なら null。 */
export function fileExtension(name: string): string | null {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return null;
  return name.slice(i + 1).toLowerCase();
}

export const uploadInputSchema = z
  .object({
    ...targetShape,
    kind: z.enum(UPLOAD_KINDS, { error: '添付の種類が正しくありません' }),
    name: attachmentNameSchema,
    mime: z.string({ error: MSG_FILE_TYPE }).trim().toLowerCase().max(200),
    sizeBytes: z
      .number({ error: MSG_SIZE })
      .int(MSG_SIZE)
      .min(1, MSG_EMPTY_FILE)
      .max(MAX_ATTACHMENT_BYTES, MSG_SIZE),
  })
  .superRefine(oneTarget)
  .superRefine((v, ctx) => {
    if (v.kind === 'photo') {
      if (!v.mime.startsWith('image/')) ctx.addIssue({ code: 'custom', path: ['mime'], message: MSG_PHOTO_MIME });
      return;
    }
    const ext = fileExtension(v.name);
    const allowed = ext ? FILE_TYPES[ext] : undefined;
    // mime が空（ブラウザ・OS によっては Excel・Word で空になる）なら拡張子だけで判定する。
    if (!allowed || (v.mime !== '' && !allowed.includes(v.mime))) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: MSG_FILE_TYPE });
    }
  })
  .transform((v) => {
    if (v.kind === 'file' && v.mime === '') {
      const ext = fileExtension(v.name);
      return { ...v, mime: (ext && FILE_TYPES[ext]?.[0]) || '' };
    }
    return v;
  });
export type UploadInput = z.input<typeof uploadInputSchema>;
export type UploadParsed = z.output<typeof uploadInputSchema>;

export const commitInputSchema = z.object({
  attachmentId: z.guid({ error: '添付の指定が正しくありません' }),
  caption: attachmentCaptionSchema.optional(),
});

/** 保存場所（バケットとパス）。写真は縮めた JPEG なので常に .jpg、ファイルは元の拡張子。 */
export function attachmentStorage(p: { siteId: string; attachmentId: string; kind: UploadKind; name: string }): {
  bucket: string;
  path: string;
} {
  if (p.kind === 'photo') return { bucket: PHOTO_BUCKET, path: `${p.siteId}/att/${p.attachmentId}.jpg` };
  return { bucket: FILE_BUCKET, path: `${p.siteId}/att/${p.attachmentId}.${fileExtension(p.name) ?? 'bin'}` };
}

/** お客様用 PDF に載せるかの既定：件に付けた写真は載せる、日報に付けた写真は載せない。ファイル・リンクは常に載せない。 */
export function defaultClientVisible(p: { kind: AttachmentKind; issueId?: string | null }): boolean {
  return p.kind === 'photo' && !!p.issueId;
}

export const REPORT_LOCKED_MESSAGE = '提出した日報には添付を足せません（忘れたときは修正を申請してください）';
export const ISSUE_DONE_MESSAGE = '完了した件には添付を足せません';
export const FILE_NOT_ALLOWED_MESSAGE = '協力会社のアカウントではファイルを付けられません';
export const OBJECT_MISSING_MESSAGE = '写真・ファイルが保存されていません。通信状況を確かめて、もう一度付けてください';
export const TOO_LARGE_MESSAGE = '1 つ 10MB までです';
export const ATTACHMENT_EXISTS_MESSAGE = 'この添付はすでに保存されています';

/**
 * gn_attachments のガード（gn_attachments_guard）の理由を利用者向けの文言にする。知らない理由は null（呼び出し側で汎用の文言）。
 * op = 'delete' のときは「消せません」の言い方にする。
 */
export function attachmentErrorMessage(dbMessage: string | null | undefined, op: 'add' | 'delete' | 'update' = 'add'): string | null {
  const m = dbMessage ?? '';
  if (m.includes('site_closed')) return SITE_CLOSED_MESSAGE;
  if (m.includes('report_locked')) {
    return op === 'delete' ? '提出した日報の添付は消せません（修正を申請してください）' : REPORT_LOCKED_MESSAGE;
  }
  if (m.includes('issue_done')) return op === 'delete' ? '完了した件の添付は消せません' : ISSUE_DONE_MESSAGE;
  if (m.includes('file_not_allowed')) return FILE_NOT_ALLOWED_MESSAGE;
  if (m.includes('not_attachment_owner')) return '付けた本人か管理者だけが消せます';
  if (m.includes('not_allowed_to_update')) return 'お客様用に載せるかは、社員・管理者と付けた本人だけが変えられます';
  if (m.includes('attachment_readonly')) return '添付はお客様用に載せるかだけ変えられます';
  if (m.includes('report_not_found') || m.includes('issue_not_found')) return '日報または件が見つからないか、権限がありません';
  if (m.includes('storage_object_missing')) return OBJECT_MISSING_MESSAGE;
  if (m.includes('storage_object_too_large')) return TOO_LARGE_MESSAGE;
  if (m.includes('storage_object_not_owned')) return '自分で付けた写真・ファイルではありません。もう一度付け直してください';
  if (m.includes('attachment_exists')) return ATTACHMENT_EXISTS_MESSAGE;
  if (m.includes('invalid_storage_path')) return '保存場所の指定が正しくありません。もう一度付け直してください';
  if (m.includes('row-level security')) return '添付を付ける権限がありません';
  return null;
}

/** gn_attachments の 1 行（読み取りで選ぶ列）。 */
export interface AttachmentRow {
  id: string;
  site_id: string;
  report_id: string | null;
  issue_id: string | null;
  kind: string;
  storage_bucket: string | null;
  storage_path: string | null;
  url: string | null;
  name: string;
  caption: string | null;
  mime: string | null;
  size_bytes: number | string | null;
  client_visible: boolean | null;
  attached_on: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export const ATTACHMENT_COLUMNS =
  'id, site_id, report_id, issue_id, kind, storage_bucket, storage_path, url, name, caption, mime, size_bytes, client_visible, attached_on, created_by, created_by_name, created_at';

function isAttachmentKind(v: string): v is AttachmentKind {
  return (ATTACHMENT_KINDS as readonly string[]).includes(v);
}

/** 行を画面用の形に直す。知らない種類の行は null（読み飛ばす）。 */
export function fromAttachmentRow(r: AttachmentRow): Attachment | null {
  if (!isAttachmentKind(r.kind)) return null;
  const a: Attachment = {
    id: r.id,
    siteId: r.site_id,
    kind: r.kind,
    name: r.name,
    caption: r.caption ?? '',
    clientVisible: r.kind === 'photo' && r.client_visible === true,
    attachedOn: r.attached_on,
    createdBy: r.created_by,
    createdByName: r.created_by_name ?? '',
    createdAt: r.created_at,
  };
  if (r.url) a.url = r.url;
  if (r.storage_bucket) a.storageBucket = r.storage_bucket;
  if (r.storage_path) a.storagePath = r.storage_path;
  if (r.mime) a.mime = r.mime;
  if (r.size_bytes !== null && r.size_bytes !== undefined && Number.isFinite(Number(r.size_bytes))) a.sizeBytes = Number(r.size_bytes);
  if (r.issue_id) a.issueId = r.issue_id;
  if (r.report_id) a.reportId = r.report_id;
  return a;
}
