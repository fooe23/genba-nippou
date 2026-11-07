import { z } from 'zod';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';

// お客様のサイン（日報の「お客様確認」）の入力の検証・判定・DB の拒否理由の文言。サーバー（Server Action・Route Handler）と
// 画面（サインの欄）の両方で使う純関数。
//
// 流れ：画面がサインを PNG にして、本人のログインで gn-photos/<site_id>/sign/<ランダムな uuid>.png に置く →
// saveClientSignature（Server Action）がその画像を読み、お客様用日報 PDF を作って gn-exports/<site_id>/signed/<report_id>-<ミリ秒>.pdf
// に置く → DB の gn_save_client_signature が確かめて列を入れる（確認者・日時・メモも固定）。取り消しは管理者だけ（理由必須）。

/** サインの画像の上限（DB の gn_save_client_signature と同じ 2MB）。 */
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
/** これより小さい PNG はサインとして扱わない（壊れた・空のファイル）。 */
export const SIGNATURE_MIN_BYTES = 100;

export const SIGNATURE_EMPTY_MESSAGE = 'サインを書いてください';
export const SIGNATURE_EXISTS_MESSAGE = 'サインはもう保存されています。画面を再読み込みしてください。';
export const SIGNATURE_LOCKED_MESSAGE = 'お客様のサインがあるため、客先確認は変えられません（間違えたときは管理者がサインを取り消します）';
export const SIGNATURE_IMAGE_FAILED_MESSAGE = 'サインの画像を保存できませんでした。もう一度「サインを保存」を押してください。';
export const SIGNATURE_TOO_LARGE_MESSAGE = 'サインの画像が大きすぎます（2MB まで）。書き直してください。';
export const REVOKE_ADMIN_ONLY_MESSAGE = 'サインを取り消せるのは管理者だけです';
export const REPORT_CONFIRMED_ISSUE_DELETE_MESSAGE =
  'お客様の確認を受けた件がある日報は削除できません（管理者がそのサインを取り消した後なら削除できます）';
export const REPORT_SIGNED_DELETE_MESSAGE = 'お客様のサインがある日報は削除できません（管理者がサインを取り消した後なら削除できます）';
/** 画面に出す注意（モックアップの文言）。 */
export const SIGNATURE_NOTE = '保存したサインは消せません（間違えたときは管理者が取り消します）';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MSG_BY = '確認者名を入力してください';
const MSG_REASON = '取り消しの理由を入力してください';

/** サインの画像の置き場所：<site_id>/sign/<uuid>.png（gn-photos）。 */
export function signaturePath(siteId: string, id: string): string {
  return `${siteId}/sign/${id}.png`;
}

/** そのパスが、その現場のサインの画像の規約どおりか（DB と同じ規則。uuid は小文字）。 */
export function isSignaturePathFor(siteId: string, path: string): boolean {
  return new RegExp(`^${UUID_RE}$`).test(siteId) && new RegExp(`^${siteId}/sign/${UUID_RE}\\.png$`).test(path);
}

/** サインした時点の PDF の置き場所：<site_id>/signed/<report_id>-<ミリ秒>.pdf（gn-exports）。 */
export function signedPdfPath(siteId: string, reportId: string, atMs: number): string {
  return `${siteId}/signed/${reportId}-${Math.trunc(atMs)}.pdf`;
}

/** 画面の入力（確認者・メモ）。サインの画像のパスはアップロードの後で足す。 */
export const signatureFormSchema = z.object({
  confirmedBy: z.string({ error: MSG_BY }).trim().min(1, MSG_BY).max(100, '確認者名は100文字以内で入力してください'),
  note: z.string({ error: 'メモは文字で入力してください' }).trim().max(500, 'メモは500文字以内で入力してください').default(''),
});

/** 1 回のサインで確認していただける件の数の上限（DB の gn_save_client_signature と同じ）。 */
export const MAX_CONFIRM_ISSUES = 50;
export const INVALID_ISSUE_MESSAGE = '確認していただく件に選べない件があります。画面を再読み込みして選び直してください。';
export const TOO_MANY_ISSUES_MESSAGE = `確認していただく件は ${MAX_CONFIRM_ISSUES} 件までです`;

/**
 * 確認していただく件の id の一覧（uuid。大文字は小文字にそろえ、重複を除いて 50 件まで。並びは最初に出た順）。
 * 渡さなければ空（件の確認は記録しない）。
 */
export const confirmIssueIdsSchema = z
  .array(z.string({ error: INVALID_ISSUE_MESSAGE }).regex(new RegExp(`^${UUID_RE}$`, 'i'), INVALID_ISSUE_MESSAGE), {
    error: INVALID_ISSUE_MESSAGE,
  })
  .max(MAX_CONFIRM_ISSUES * 4, TOO_MANY_ISSUES_MESSAGE)
  .default([])
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])
  .refine((ids) => ids.length <= MAX_CONFIRM_ISSUES, TOO_MANY_ISSUES_MESSAGE);

/** saveClientSignature の入力。 */
export const clientSignatureSchema = signatureFormSchema.extend({
  signaturePath: z
    .string({ error: SIGNATURE_IMAGE_FAILED_MESSAGE })
    .regex(new RegExp(`^${UUID_RE}/sign/${UUID_RE}\\.png$`), SIGNATURE_IMAGE_FAILED_MESSAGE),
  issueIds: confirmIssueIdsSchema,
});
export type ClientSignatureInput = z.input<typeof clientSignatureSchema>;

export const revokeReasonSchema = z
  .string({ error: MSG_REASON })
  .trim()
  .min(1, MSG_REASON)
  .max(500, '取り消しの理由は500文字以内で入力してください');

/**
 * 描いた絵が空か（canvas の getImageData の RGBA）。白い背景に対して濃い点（明るさ 200 未満・不透明）が minInk 個未満なら空。
 * 点を 1 つ打っただけ・ほとんど描いていないものも空とみなす。
 */
export function isBlankDrawing(rgba: ArrayLike<number>, minInk = 20): boolean {
  let ink = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (lum < 200) {
      ink += 1;
      if (ink >= minInk) return false;
    }
  }
  return true;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** サーバーで受け取ったサインの画像の確認。問題があれば文言、無ければ null。 */
export function checkSignaturePng(bytes: Uint8Array): string | null {
  if (bytes.length > SIGNATURE_MAX_BYTES) return SIGNATURE_TOO_LARGE_MESSAGE;
  if (bytes.length < SIGNATURE_MIN_BYTES) return SIGNATURE_EMPTY_MESSAGE;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return SIGNATURE_IMAGE_FAILED_MESSAGE;
  return null;
}

/** サインをもらえるか：保存済みの日報で、サインがまだ無いとき（日報の状態・現場の完了は問わない）。 */
export function canSign(s: { reportId: string | null; signed: boolean }): boolean {
  return s.reportId !== null && !s.signed;
}

/** サインを取り消せるか：管理者で、サインがあるとき。 */
export function canRevokeSignature(s: { isAdmin: boolean; signed: boolean }): boolean {
  return s.isAdmin && s.signed;
}

/** 客先確認の「記録する・記録し直す・取り消す」ができるか：サインが無いときだけ。 */
export function canEditClientConfirmation(signed: boolean): boolean {
  return !signed;
}

/** gn_save_client_signature / gn_revoke_client_signature・ガードの拒否理由 → 画面の文言。 */
export function signatureErrorMessage(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('stale_report')) return STALE_CONFIRMATION_MESSAGE;
  if (m.includes('signature_exists')) return SIGNATURE_EXISTS_MESSAGE;
  if (m.includes('signature_missing')) return '取り消すサインがありません。画面を再読み込みしてください。';
  if (m.includes('signature_locked')) return SIGNATURE_LOCKED_MESSAGE;
  if (m.includes('report_signed')) return REPORT_SIGNED_DELETE_MESSAGE;
  if (m.includes('report_has_confirmed_issue')) return REPORT_CONFIRMED_ISSUE_DELETE_MESSAGE;
  if (m.includes('report_not_found')) return '日報が見つからないか、権限がありません';
  if (m.includes('invalid_issue')) return INVALID_ISSUE_MESSAGE;
  if (m.includes('invalid_signature_input')) return '確認者・メモ・日時の内容が正しくありません。入力を確かめてもう一度お試しください。';
  if (m.includes('storage_object_too_large')) return SIGNATURE_TOO_LARGE_MESSAGE;
  if (m.includes('invalid_storage_path') || m.includes('storage_object_missing') || m.includes('storage_object_not_owned')) {
    return SIGNATURE_IMAGE_FAILED_MESSAGE;
  }
  if (m.includes('not_admin')) return REVOKE_ADMIN_ONLY_MESSAGE;
  if (m.includes('invalid_revoke_reason')) return '取り消しの理由を入力してください（500文字以内）';
  if (m.includes('not_authenticated')) return 'ログインし直してください';
  return '処理に失敗しました。もう一度お試しください。';
}

/** いまのサイン（gn_daily_reports.client_signature_* と客先確認の 3 列）。 */
export interface ClientSignature {
  path: string;
  pdfPath: string | null;
  signedAt: string;
  confirmedBy: string;
  note: string;
}

/** 取り消したサインの記録（client_signature_history の 1 件）。index は配列の位置（PDF を開くときに使う）。 */
export interface RevokedSignature {
  index: number;
  pdfPath: string | null;
  signedAt: string | null;
  confirmedBy: string;
  revokedAt: string | null;
  reason: string;
}

/** 日報画面に渡すサインの表示用（imageUrl は署名付き URL。作れなければ ''）。 */
export interface ClientSignatureView {
  current: (Omit<ClientSignature, 'path' | 'pdfPath'> & { imageUrl: string; hasPdf: boolean }) | null;
  history: RevokedSignature[];
}

export const NO_SIGNATURE: ClientSignatureView = { current: null, history: [] };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** client_signature_history（jsonb の配列）を読む。形の違う要素は飛ばす（index は元の位置のまま）。 */
export function parseSignatureHistory(json: unknown): RevokedSignature[] {
  if (!Array.isArray(json)) return [];
  const out: RevokedSignature[] = [];
  json.forEach((e, index) => {
    if (!e || typeof e !== 'object') return;
    const o = e as Record<string, unknown>;
    out.push({
      index,
      pdfPath: str(o.pdf_path),
      signedAt: str(o.signed_at),
      confirmedBy: str(o.confirmed_by) ?? '',
      revokedAt: str(o.revoked_at),
      reason: str(o.reason) ?? '',
    });
  });
  return out;
}

/**
 * お客様用日報（PDF・確認画面）の「確認していただく件」に載せる件の id。
 * - サインの無い日報：その日報の件。
 * - サインのある日報：そのサインで記録した件の一覧（gn_report_signature_issue_sets。空の一覧もそのまま＝「ありません」）。
 * - 件の一覧の行が無いサイン（件ごとの確認を記録する前＝第 4 段階より前にもらったサイン）：その日報の件。
 * signedIssueSet は行が無ければ null。
 */
export function clientIssueIdsForReport(s: { signed: boolean; signedIssueSet: readonly string[] | null; reportIssueIds: readonly string[] }): string[] {
  if (s.signed && s.signedIssueSet !== null) return [...s.signedIssueSet];
  return [...s.reportIssueIds];
}

/** /api/reports/signed のクエリ：report=<uuid>（いまのサイン）か、&history=<番号>（取り消したサイン）。 */
export function parseSignedPdfQuery(url: string): { reportId: string; history: number | null } | { error: string } {
  const q = new URL(url).searchParams;
  const reportId = q.get('report') ?? '';
  if (!new RegExp(`^${UUID_RE}$`, 'i').test(reportId)) return { error: '日報の指定が正しくありません' };
  const h = q.get('history');
  if (h === null) return { reportId, history: null };
  if (!/^\d{1,4}$/.test(h)) return { error: '取り消したサインの指定が正しくありません' };
  return { reportId, history: Number(h) };
}
