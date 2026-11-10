import { daysBetween } from '@/lib/calc/calendar';
import { jpDate, yen } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import type { Issue, ReportHead } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import { sortIssuesByStatus } from '@/lib/report/issue-status';
import { IssueStatusChip } from '@/components/report/IssueStatusChip';

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <dt className="text-sm text-gray-600 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold">{children}</dd>
    </div>
  );
}

/**
 * 現場詳細の上部サマリー。heads は日付昇順。issues は完了していない件（見積中 → 対応中の順に並べて出す）。
 * showMoney が false（協力会社）なら、請負金額から出す進捗率を出さない（「—」も出さない）。
 */
export function SiteSummary({
  site,
  heads,
  today,
  issues,
  showMoney,
  subcontractTotal = 0,
}: {
  site: Site;
  heads: ReportHead[];
  today: string;
  issues: Issue[];
  showMoney: boolean;
  /** 外注の買掛の合計（2026-11-17。見出しの cost_total に入っていない分。協力会社には 0）。 */
  subcontractTotal?: number;
}) {
  const costTotal = heads.reduce((sum, h) => sum + h.costTotal, 0) + subcontractTotal;
  const outputTotal = heads.reduce((sum, h) => sum + h.outputTotal, 0);
  const rate = !showMoney || site.contractAmount === null ? null : progressRate(outputTotal, site.contractAmount) * 100;
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
          {showMoney && (
            <span className="ml-2 text-base font-medium">
              （進捗率 {rate === null ? '—' : `${rate.toFixed(1)}%`}）
            </span>
          )}
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
        <h2 className="mb-2 text-base font-bold">対応中・見積中の重要事項{issues.length > 0 && `（${issues.length} 件）`}</h2>
        {issues.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">対応中・見積中の重要事項はありません</p>
        ) : (
          <ul className="divide-y divide-yellow-300 rounded-lg border border-yellow-400 bg-yellow-50 text-yellow-950 dark:divide-yellow-700 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50">
            {sortIssuesByStatus(issues).map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <p className="min-w-0 flex-1 basis-48 self-center text-sm">
                  <span className="font-bold">{jpDate(i.reportDate)}</span>　<span className="whitespace-pre-wrap break-words">{i.body}</span>
                </p>
                {/* 完了した現場は DB が件の変更を拒否するので、札を見せるだけにする */}
                <IssueStatusChip issueId={i.id} body={i.body} status={i.status} readOnly={site.status === 'done'} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
