import { z } from 'zod';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';

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

/** 日報の客先確認の 3 列（gn_daily_reports.client_confirmed_*）。 */
export type ClientConfirmationColumns = {
  client_confirmed_by: string | null;
  client_confirmed_at: string | null;
  client_confirmed_note: string | null;
};

/** 3 列が同じか（日時は時刻として比べる。'' と null は同じ）。 */
export function sameClientConfirmation(a: ClientConfirmationColumns, b: ClientConfirmationColumns): boolean {
  const time = (v: string | null) => (v ? new Date(v).getTime() : null);
  return (
    (a.client_confirmed_by || null) === (b.client_confirmed_by || null) &&
    (a.client_confirmed_note || null) === (b.client_confirmed_note || null) &&
    time(a.client_confirmed_at) === time(b.client_confirmed_at)
  );
}

/**
 * 何も変えない記録（同じ内容の記録し直し・記録の無い日報の取り消し）は DB に書かずに済ませる。何も変えない更新は
 * gn_report_guard の客先確認の例外に入らず、承認済み・完了現場では拒否されるため。
 * 書く必要があれば null。書かないときは、画面の版（expected）が今の版と違えば stale、同じ（または版の指定なし）なら成功。
 */
export function unchangedConfirmationResult(
  head: ClientConfirmationColumns & { updated_at: string | null },
  patch: ClientConfirmationColumns,
  expected: string | null,
): { ok: true; updatedAt: string | null } | { ok: false; error: string; stale: true } | null {
  if (!sameClientConfirmation(head, patch)) return null;
  if (expected !== null && head.updated_at !== expected) return { ok: false, error: STALE_CONFIRMATION_MESSAGE, stale: true };
  return { ok: true, updatedAt: head.updated_at };
}
