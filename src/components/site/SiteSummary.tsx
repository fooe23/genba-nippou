import { daysBetween } from '@/lib/calc/calendar';
import { jpDate, yen } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import type { Issue, ReportHead } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <dt className="text-sm text-gray-600 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold">{children}</dd>
    </div>
  );
}

/** 現場詳細の上部サマリー。heads は日付昇順。 */
export function SiteSummary({ site, heads, today, issues }: { site: Site; heads: ReportHead[]; today: string; issues: Issue[] }) {
  const costTotal = heads.reduce((sum, h) => sum + h.costTotal, 0);
  const outputTotal = heads.reduce((sum, h) => sum + h.outputTotal, 0);
  const rate = site.contractAmount === null ? null : progressRate(outputTotal, site.contractAmount) * 100;
  const allDates = heads.map((h) => h.reportDate);
  const recent = heads.slice(-3).reverse();

  let period = '—';
  if (site.startDate || site.endDate) {
    period = `${site.startDate ? jpDate(site.startDate) : '未定'}〜${site.endDate ? jpDate(site.endDate) : '未定'}`;
  }
  let elapsed: string | null = null;
  if (site.startDate) {
    const days = daysBetween(site.startDate, today);
    elapsed = days < 0 ? `着工まであと${-days}日` : `経過 ${days}日`;
  }

  return (
    <section aria-label="現場サマリー" className="mb-6">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Item label="工期">
          <span className="text-base">{period}</span>
          {elapsed && <span className="ml-2 text-base font-medium">（{elapsed}）</span>}
        </Item>
        <Item label="通算入場回数">{heads.length}回</Item>
        <Item label="累計原価">{yen(costTotal)}</Item>
        <Item label="累計出来高">
          {yen(outputTotal)}
          <span className="ml-2 text-base font-medium">
            （進捗率 {rate === null ? '—' : `${rate.toFixed(1)}%`}）
          </span>
        </Item>
      </dl>

      <div className="mt-4">
        <h2 className="mb-2 text-base font-bold">直近の日報</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">まだ日報がありません。</p>
        ) : (
          <ul className="divide-y divide-gray-300 rounded-lg border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
            {recent.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                <span className="text-sm">{visitLabel(h.reportDate, visitNumbers(allDates, h.reportDate))}</span>
                <span className="font-bold">{yen(h.outputTotal)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-base font-bold">対応中の重要事項</h2>
        {issues.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">対応中の重要事項はありません</p>
        ) : (
          <ul className="divide-y divide-yellow-300 rounded-lg border border-yellow-400 bg-yellow-50 text-yellow-950 dark:divide-yellow-700 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50">
            {issues.map((i) => (
              <li key={i.id} className="px-3 py-2 text-sm">
                <span className="font-bold">{jpDate(i.reportDate)}</span>　<span className="whitespace-pre-wrap break-words">{i.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
