// 帳票の入口まわりの純関数（Next・Supabase に依存しない）：年月の形式と、添付の Content-Disposition。

/** 'YYYY-MM'。帳票のクエリ（src/lib/reports/query.ts）でも使う。 */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** RFC 5987 の値（encodeURIComponent が残す ' ( ) * も % で書く）。 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 添付の Content-Disposition。日本語のファイル名は filename* に入れ、filename は古いブラウザ向けに
 * ASCII の `export.<拡張子>` にする。`inline: true` はブラウザで開く（PDF のプレビュー）。ファイル名は同じで、
 * 開いた先で保存したときの名前になる。
 */
export function contentDisposition(fileName: string, opts?: { inline?: boolean }): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1];
  const fallback = ext ? `export.${ext}` : 'export';
  const type = opts?.inline ? 'inline' : 'attachment';
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}
