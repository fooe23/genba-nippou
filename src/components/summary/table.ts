// 集計表の共通表示ヘルパーとクラス。

/** 割合（0.3 → "30.0%"）。小数 1 桁。 */
export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** 人工（小数 2 桁まで、末尾の 0 は省略）。 */
export function manDaysText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export const NULL_TEXT = '—';

export const tableWrapClass = 'overflow-x-auto rounded-lg border border-gray-300 dark:border-gray-700';
export const tableClass = 'w-full border-collapse text-sm';
export const thClass = 'whitespace-nowrap border-b border-gray-300 bg-gray-100 px-3 py-2 text-right font-bold dark:border-gray-700 dark:bg-gray-800';
export const thStickyClass = `${thClass} sticky left-0 z-10 text-left`;
export const tdClass = 'whitespace-nowrap border-b border-gray-200 px-3 py-2 text-right tabular-nums dark:border-gray-800';
export const tdStickyClass = `${tdClass} sticky left-0 z-10 bg-background text-left`;
export const totalClass = 'bg-gray-100 font-bold dark:bg-gray-800';
