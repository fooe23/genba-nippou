// アプリの中の PDF ビューアー（/pdf）の入口まわりの純関数（Next・ブラウザに依存しない）。
// /pdf?src=<同じサイトの PDF の API>&title=<見出し>&back=<戻り先のパス>
// src は帳票の API（下の 4 つ）だけを通す。ほかのパス・別のサイトの URL・"//" で始まるものは受け付けない
// （ビューアーが読みに行く先を、外から好きに変えられないようにする）。

/** ビューアーで開ける PDF の API（パスが完全に一致するものだけ）。 */
export const PDF_SRC_PATHS: readonly string[] = ['/api/reports/daily', '/api/reports/cost', '/api/reports/changes', '/api/reports/signed'];

export const PDF_VIEWER_PATH = '/pdf';

const MAX_LEN = 2000;
const TITLE_MAX = 80;
const BASE = 'http://localhost';

/** 同じサイトのパスとして読めるか（"/" で始まり "//" でない、バックスラッシュ・制御文字なし）。読めれば URL。 */
function parseLocalPath(p: unknown): URL | null {
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_LEN) return null;
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(p)) return null;
  let url: URL;
  try {
    url = new URL(p, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  return url;
}

/** PDF の src を検証する。許可した API のパスなら「パス＋クエリ」（# は捨てる）、それ以外は null。 */
export function validatePdfSrc(src: unknown): string | null {
  const url = parseLocalPath(src);
  if (!url) return null;
  if (!PDF_SRC_PATHS.includes(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}

/** 戻り先のパスを検証する。同じサイトのパス（"/" で始まり "//" でない）なら「パス＋クエリ＋#」、それ以外は null。 */
export function validateBackPath(p: unknown): string | null {
  const url = parseLocalPath(p);
  if (!url) return null;
  // API やビューアー自身には戻さない（ダウンロードや行ったり来たりになる）
  if (url.pathname === PDF_VIEWER_PATH || url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 見出しを整える（空白をまとめ、長すぎれば切る）。空なら null。 */
export function normalizeTitle(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const s = t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX)}…` : s;
}

/**
 * 「保存」のリンク：同じ src を disposition=attachment にしたもの（ダウンロード）。
 * 日報・原価集計・精算資料の API は inline 以外を attachment として扱い、サインした時点の PDF は attachment を見る。
 * src が許可したものでなければ null。
 */
export function downloadHref(src: unknown): string | null {
  const valid = validatePdfSrc(src);
  if (!valid) return null;
  const url = new URL(valid, BASE);
  url.searchParams.set('disposition', 'attachment');
  return `${url.pathname}${url.search}`;
}

/** 画面の中で開く（ブラウザで開く）src：disposition=inline にしたもの。src が許可したものでなければ null。 */
export function inlineHref(src: unknown): string | null {
  const valid = validatePdfSrc(src);
  if (!valid) return null;
  const url = new URL(valid, BASE);
  url.searchParams.set('disposition', 'inline');
  return `${url.pathname}${url.search}`;
}

/** ビューアーの URL（/pdf?src=&title=&back=）。src が許可したものでなければ null。 */
export function pdfViewerHref(opts: { src: string; title?: string; back?: string }): string | null {
  const src = validatePdfSrc(opts.src);
  if (!src) return null;
  const q = new URLSearchParams({ src });
  const title = normalizeTitle(opts.title);
  if (title) q.set('title', title);
  const back = validateBackPath(opts.back);
  if (back) q.set('back', back);
  return `${PDF_VIEWER_PATH}?${q.toString()}`;
}

/** Content-Disposition からファイル名を取り出す（filename* を優先）。取れなければ fallback。 */
export function fileNameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (header) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
    if (star?.[1]) {
      try {
        const name = decodeURIComponent(star[1].trim());
        if (name) return name;
      } catch {
        // 壊れた符号化は下の filename= に回す
      }
    }
    const plain = /filename\s*=\s*"([^"]*)"/.exec(header) ?? /filename\s*=\s*([^;]+)/.exec(header);
    const name = plain?.[1]?.trim();
    if (name) return name;
  }
  return fallback;
}
