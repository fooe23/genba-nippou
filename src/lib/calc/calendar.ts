// カレンダー用の日付計算。日付は "YYYY-MM-DD"、月は "YYYY-MM" の文字列のまま扱う。
// 曜日と月の日数だけ Date.UTC で求める（ローカルタイムゾーンに依存しない）。

function parseMonth(month: string): { y: number; m: number } {
  const [y, m] = month.split('-').map(Number);
  return { y, m };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 日曜始まりの月カレンダー。日付のない先頭・末尾のマスは null。7 の倍数（35 または 42）。 */
export function monthGrid(month: string): { dates: (string | null)[] } {
  const { y, m } = parseMonth(month);
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates: (string | null)[] = [];
  for (let i = 0; i < offset; i++) dates.push(null);
  for (let d = 1; d <= days; d++) dates.push(`${month}-${pad2(d)}`);
  while (dates.length % 7 !== 0) dates.push(null);
  return { dates };
}

export function prevMonth(month: string): string {
  const { y, m } = parseMonth(month);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

export function nextMonth(month: string): string {
  const { y, m } = parseMonth(month);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`;
}

/** from から to までの日数（to − from）。どちらも "YYYY-MM-DD"。UTC で計算するのでタイムゾーンの影響を受けない。 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}
