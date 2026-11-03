import { z } from 'zod';

// 客先確認の記録（recordClientConfirmation の入力）の検証と、日時の入力欄（datetime-local・日本時間）との変換。
// サーバー（Server Action）とクライアント（ダイアログ）の両方で使う。

const MSG_BY = '確認者名を入力してください';
const MSG_AT = '確認の日時が正しくありません';

export const clientConfirmationSchema = z.object({
  confirmedBy: z.string({ error: MSG_BY }).trim().min(1, MSG_BY).max(100, '確認者名は100文字以内で入力してください'),
  /** 時差つきの ISO 8601（ダイアログは jstLocalToIso で +09:00 を付けて送る）。 */
  confirmedAt: z.iso.datetime({ offset: true, error: MSG_AT }),
  note: z.string({ error: 'メモは文字で入力してください' }).trim().max(500, 'メモは500文字以内で入力してください').default(''),
});
export type ClientConfirmationInput = z.input<typeof clientConfirmationSchema>;

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?$/;

/** 日時の入力欄の値（日本時間 'YYYY-MM-DDTHH:mm[:ss]'）→ 'YYYY-MM-DDTHH:mm:ss+09:00'。形が違えば ''（検証で弾く）。 */
export function jstLocalToIso(local: string): string {
  const m = LOCAL_RE.exec(local);
  return m ? `${m[1]}${m[2] ?? ':00'}+09:00` : '';
}

/** 日時（ISO）→ 日本時間の入力欄の値 'YYYY-MM-DDTHH:mm'。読めなければ ''。 */
export function isoToJstLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE は 'YYYY-MM-DD HH:mm' の形。
  const text = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return text.replace(' ', 'T');
}
