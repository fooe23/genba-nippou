import { daysBetween } from '@/lib/calc/calendar';
import { jpDate, yen } from '@/lib/calc/format';
import { progressRate } from '@/lib/calc/report';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import type { Issue, ReportHead } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import { sortIssuesByStatus } from '@/lib/report/issue-status';
import { EstimatePendingBadge } from '@/components/report/EstimatePendingBadge';
import { IssueEstimateSubmitted } from '@/components/report/IssueEstimateSubmitted';
import { IssueStatusChip } from '@/components/report/IssueStatusChip';
import { SIGN_LATER_REASONS } from '@/lib/report/client-confirm';

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
 * 件の見積書（2026-11-20）：件ごとに赤い印（見積書が要で未提出）を出し、完了した件のうち未提出のもの（pendingDoneIssues）を
 * 「見積書が未提出の完了した件」として下に出す（社員・管理者には「見積提出を記録」）。
 */
export function SiteSummary({
  site,
  heads,
  today,
  issues,
  showMoney,
  costAdjustment = 0,
  subcontractOutputs = {},
  isStaff = false,
  pendingDoneIssues = [],
}: {
  site: Site;
  heads: ReportHead[];
  today: string;
  issues: Issue[];
  showMoney: boolean;
  /**
   * 見出しの cost_total の合計に足す調整（2026-11-17）：外注の買掛（cost_total に入っていない。協力会社には 0）と、請負の作業員の
   * 行の（原価に数える分 − 行の金額）。loadCostAdjustments の合計。
   */
  costAdjustment?: number;
  /**
   * 日報 id → 外注の支払いのうち出来高に数える分（2026-11-11。loadSubcontractOutputs。協力会社には空）。累計出来高・進捗率・
   * 直近の日報の出来高に足す。
   */
  subcontractOutputs?: Readonly<Record<string, number>>;
  /** 社員・管理者（状態の止めの文言・「見積書を後出しにする」・「見積提出を記録」）。 */
  isStaff?: boolean;
  /** 完了した件のうち、見積書が要で見積提出の記録が無いもの。 */
  pendingDoneIssues?: Issue[];
}) {
  const costTotal = heads.reduce((sum, h) => sum + h.costTotal, 0) + costAdjustment;
  const dayOutput = (h: ReportHead) => h.outputTotal + (subcontractOutputs[h.id] ?? 0);
  const outputTotal = heads.reduce((sum, h) => sum + dayOutput(h), 0);
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
                <span className="font-bold">{yen(dayOutput(h))}</span>
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
                <div className="min-w-0 flex-1 basis-48 self-center text-sm">
                  <p>
                    <span className="font-bold">{jpDate(i.reportDate)}</span>　<span className="whitespace-pre-wrap break-words">{i.body}</span>
                  </p>
                  <EstimatePendingBadge issue={i} today={today} />
                </div>
                {/* 完了した現場は DB が件の変更を拒否するので、札を見せるだけにする */}
                <IssueStatusChip
                  issueId={i.id}
                  body={i.body}
                  status={i.status}
                  readOnly={site.status === 'done'}
                  estimate={{ requirement: i.estimateRequirement, pending: i.estimatePending, isStaff }}
                  // 現場の画面は日報が決まらないので、後出しの件の完了では「あとで」だけ（その日の日報の画面からサインをもらう）
                  sign={{ kind: i.kind, href: null, reason: SIGN_LATER_REASONS.noReport }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingDoneIssues.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 text-base font-bold">見積書が未提出の完了した件（{pendingDoneIssues.length} 件）</h2>
          <ul className="divide-y divide-red-200 rounded-lg border border-red-400 bg-red-50 text-red-950 dark:divide-red-800 dark:border-red-600 dark:bg-red-950 dark:text-red-50">
            {pendingDoneIssues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 basis-48 self-center text-sm">
                  <p>
                    <span className="font-bold">{jpDate(i.reportDate)}</span>　<span className="whitespace-pre-wrap break-words">{i.body}</span>
                  </p>
                  <EstimatePendingBadge issue={i} today={today} />
                </div>
                {site.status !== 'done' && (
                  <IssueEstimateSubmitted issue={i} viewer={{ isStaff, siteClosed: false }} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
