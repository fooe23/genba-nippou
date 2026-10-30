// 表示整形。日付は "YYYY-MM-DD" 文字列のまま扱い、Date オブジェクトは使わない（タイムゾーンずれ防止）。

// 円表示。四捨五入（0.5 は絶対値側へ）して桁区切り。0 は "¥0"、負数は "-¥1,234"。
export function yen(n: number): string {
  const rounded = Math.round(Math.abs(n));
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 && rounded !== 0 ? `-¥${digits}` : `¥${digits}`;
}

// "2026-11-05" → "2026/11/5"（月日はゼロ埋めしない）
export function jpDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}/${m}/${d}`;
}

// "2026-11-05" → "2026-11"
export function monthKey(date: string): string {
  return date.slice(0, 7);
}
