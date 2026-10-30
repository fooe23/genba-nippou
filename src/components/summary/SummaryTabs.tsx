import Link from 'next/link';

export const SUMMARY_TABS = [
  { key: 'monthly', label: '月次集計' },
  { key: 'cost', label: '現場原価集計' },
  { key: 'attendance', label: '出面一覧' },
  { key: 'workers', label: '作業員別累計' },
] as const;
export type SummaryTabKey = (typeof SUMMARY_TABS)[number]['key'];

export function isSummaryTab(v: string | undefined): v is SummaryTabKey {
  return SUMMARY_TABS.some((t) => t.key === v);
}

/** タブ（?tab= へのリンク）。期間（?period=）は引き継ぐ。 */
export function SummaryTabs({ siteId, active, period }: { siteId: string; active: SummaryTabKey; period: string }) {
  return (
    <nav aria-label="集計の種類" className="-mx-4 mb-4 flex overflow-x-auto border-b border-gray-300 px-4 dark:border-gray-700">
      {SUMMARY_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/sites/${siteId}/summary?tab=${t.key}&period=${period}`}
          aria-current={active === t.key ? 'page' : undefined}
          className={`flex min-h-11 shrink-0 items-center border-b-2 px-4 text-base font-bold ${
            active === t.key
              ? 'border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-gray-600 dark:text-gray-400'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
