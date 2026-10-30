// URL のパラメータ（現場ID・日報ID）の形式確認。DB の uuid 列は 8-4-4-4-12 の16進ならよい
// （バージョン・バリアントは問わない。z.guid() と同じ考え方）。形式が違えば問い合わせる前に 404 にする。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
