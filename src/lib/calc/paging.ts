// 取得のページングと分割（純粋関数）。PostgREST の max_rows（既定 1000）で黙って切り詰められないようにする。

/** 配列を size 件ずつに分ける。 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** from〜to（両端を含む、.range() と同じ）を pageSize ごとに取り、短いページが返るまで続ける。 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}
