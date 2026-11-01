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

// 日本時間（JST）の今日を "YYYY-MM-DD" で返す。
export function todayJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

// timestamptz の文字列（例 "2026-11-02T03:04:05.123+00:00"）→ 日本時間の "2026/11/02 12:04"。読めなければ元の文字列。
export function jpDateTime(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return timestamp;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}
