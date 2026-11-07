import type { Attachment } from '@/lib/db/attachments-schemas';

/** 画面に渡す添付（署名付き URL 付き。リンクはその URL。作れなかったときは空文字）。 */
export type AttachmentView = Attachment & { href: string };

/** 添付の画面で共通に使う、見ている人と日報の情報。 */
export interface AttachmentViewer {
  siteId: string;
  /** 開いている日報の日付（件の添付の「付けた日」に使う）。 */
  reportDate: string;
  currentUserId: string;
  isAdmin: boolean;
  /** 社員・管理者（ファイル＝見積書などを見る・付ける、お客様用のチェックをどの写真でも変えられる）。協力会社は false。 */
  isStaff: boolean;
  /** 完了現場（足す・消すを出さない）。 */
  siteClosed: boolean;
}

/** 消せるか（付けた本人と管理者。日報・件の状態は呼び出し側の locked で止める）。 */
export function canDeleteAttachment(a: Pick<Attachment, 'createdBy'>, v: Pick<AttachmentViewer, 'currentUserId' | 'isAdmin'>): boolean {
  return v.isAdmin || (a.createdBy !== null && a.createdBy === v.currentUserId);
}

/** お客様用のチェックを変えられるか（写真だけ。社員・管理者と付けた本人。提出後も可）。 */
export function canToggleClientVisible(
  a: Pick<Attachment, 'kind' | 'createdBy'>,
  v: Pick<AttachmentViewer, 'currentUserId' | 'isStaff'>,
): boolean {
  return a.kind === 'photo' && (v.isStaff || (a.createdBy !== null && a.createdBy === v.currentUserId));
}

/** リンクの名前を入れなかったときの名前（G ドライブなら「G ドライブ」、ほかはホスト名）。 */
export function defaultLinkName(url: string): string {
  let host = '';
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return 'リンク';
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') return 'G ドライブ';
  return host.replace(/^www\./, '') || 'リンク';
}

/** ファイル名を 100 文字以内に（拡張子は残す）。 */
export function fitAttachmentName(name: string, max = 100): string {
  const n = name.trim() || 'ファイル';
  if (n.length <= max) return n;
  const i = n.lastIndexOf('.');
  const ext = i > 0 && n.length - i <= 10 ? n.slice(i) : '';
  return n.slice(0, max - ext.length) + ext;
}
