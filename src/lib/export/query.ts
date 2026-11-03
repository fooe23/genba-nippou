import type { ExportWarning, ExportWarningCode } from '@/lib/export/types';
import { isUuid } from '@/lib/uuid';

// /api/export の入口まわりの純関数（Next・Supabase に依存しない）：クエリの検証、添付ファイル名、
// 原本 Excel に入りきらない警告の文。出力画面（ExportPanel）でも同じ文を出す。

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?site=<uuid>&month=YYYY-MM` を読む。形式が違えばエラーの文。 */
export function parseExportQuery(url: URL | string): { siteId: string; month: string } | { error: string } {
  const params = (typeof url === 'string' ? new URL(url) : url).searchParams;
  const siteId = params.get('site') ?? '';
  const month = params.get('month') ?? '';
  if (!isUuid(siteId)) return { error: '現場の指定が正しくありません' };
  if (!MONTH_RE.test(month)) return { error: '年月の指定が正しくありません' };
  return { siteId, month };
}

/** RFC 5987 の値（encodeURIComponent が残す ' ( ) * も % で書く）。 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 添付の Content-Disposition。日本語のファイル名は filename* に入れ、filename は古いブラウザ向けに
 * ASCII の `export.<拡張子>` にする。
 */
export function contentDisposition(fileName: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1];
  const fallback = ext ? `export.${ext}` : 'export';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

/** 雛形に入りきらない警告（これがあると原本 Excel は出さない）。名前の警告は出力を止めない。 */
const OVERFLOW_CODES: ReadonlySet<ExportWarningCode> = new Set<ExportWarningCode>([
  'rows_overflow',
  'too_many_workers',
  'too_many_suppliers',
  'too_many_vehicles',
  'too_many_lease_items',
  'too_many_days',
]);

/** rows_overflow の文（payload.ts）：「2026年11月3日 の作業員が12行で、雛形の10行を超えています」。 */
const ROWS_OVERFLOW_RE = /^(.+?) の(.+?)が(\d+)行で/;

/**
 * 原本 Excel に入りきらないときの案内文（最初の超過 1 件）。超過が無ければ null。
 * 行の超過は「{日付} の {表} が {n} 行」、件数の超過は警告の文をそのまま入れる。
 */
export function overflowNotice(warnings: ExportWarning[]): string | null {
  const w = warnings.find((x) => OVERFLOW_CODES.has(x.code));
  if (!w) return null;
  const m = w.code === 'rows_overflow' ? ROWS_OVERFLOW_RE.exec(w.message) : null;
  const detail = m ? `${m[1]} の ${m[2]} が ${m[3]} 行` : w.message;
  return `この月は原本 Excel では出せません（${detail}）。PDF／CSV をご利用ください`;
}
