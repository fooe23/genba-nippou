import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { attendance, costSummary, monthlyRows, sumRows, workerCumulative } from '@/lib/calc/aggregate';
import { monthKey, todayJst } from '@/lib/calc/format';
import { listWorkers } from '@/lib/db/masters';
import { requireProfile } from '@/lib/db/profile';
import { getSite, listCarryovers } from '@/lib/db/sites';
import { loadSummaryData } from '@/lib/db/summary';
import { AttendanceTable } from '@/components/summary/AttendanceTable';
import { CostTable } from '@/components/summary/CostTable';
import { MonthlyTable } from '@/components/summary/MonthlyTable';
import { PeriodBar } from '@/components/summary/PeriodBar';
import { SummaryTabs, isSummaryTab } from '@/components/summary/SummaryTabs';
import { WorkersTable } from '@/components/summary/WorkersTable';

export const metadata = { title: '集計' };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function SummaryPage({ params, searchParams }: PageProps<'/sites/[siteId]/summary'>) {
  await requireProfile();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();

  const sp = await searchParams;
  const rawTab = typeof sp.tab === 'string' ? sp.tab : undefined;
  const rawPeriod = typeof sp.period === 'string' ? sp.period : undefined;
  const tab = isSummaryTab(rawTab) ? rawTab : 'monthly';
  const currentMonth = monthKey(todayJst());
  const period = rawPeriod === 'all' || (rawPeriod !== undefined && MONTH_RE.test(rawPeriod)) ? rawPeriod : currentMonth;
  const isAll = period === 'all';

  const [{ days, entries }, carryovers, workers] = await Promise.all([
    loadSummaryData(siteId),
    listCarryovers(siteId),
    listWorkers(),
  ]);
  const contractTotal = site.contractAmount;

  const inPeriod = (date: string) => isAll || monthKey(date) === period;
  const periodDays = days.filter((d) => inPeriod(d.reportDate));
  const periodEntries = entries.filter((e) => inPeriod(e.reportDate));

  // 月次集計: 工期全体のときは日報のある月をすべて並べる（回目は月ごと・通算で付く）
  const months = isAll ? [...new Set(days.map((d) => monthKey(d.reportDate)))].sort() : [period];
  const monthly = months.flatMap((m) => monthlyRows(days, m, contractTotal));

  // 工期累計: 表示している最終日（工期全体なら全日）までの全日報の合計
  const lastDate = monthly.length > 0 ? monthly[monthly.length - 1].date : null;
  const allMonths = [...new Set(days.map((d) => monthKey(d.reportDate)))].sort();
  const cumulativeRows = lastDate === null ? [] : allMonths.flatMap((m) => monthlyRows(days, m, contractTotal)).filter((r) => r.date <= lastDate);
  const cumulativeTotal = sumRows(cumulativeRows);
  const cumulativeProgress = cumulativeRows.length > 0 ? cumulativeRows[cumulativeRows.length - 1].progress : 0;

  // 原価タブの契約額まわり（総原価・粗利・進捗率）は期間末時点の累計で計算する
  const cumulativeDays = isAll ? days : days.filter((d) => d.reportDate <= `${period}-31`);

  const workerNames = Object.fromEntries(workers.map((w) => [w.id, w.name]));
  // 作業員別累計は全期間の日報を渡し、表示期間より前の分を前月繰越に入れる（Excel 雛形と同じ）
  const workerPeriod = isAll ? { from: null, to: null } : { from: `${period}-01`, to: `${period}-31` };

  return (
    <main className="mx-auto w-full max-w-5xl p-4">
      <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {site.name}
      </Link>
      <h1 className="mb-3 text-xl font-bold">集計</h1>

      <PeriodBar period={period} currentMonth={currentMonth} />
      <SummaryTabs siteId={siteId} active={tab} period={period} />

      {tab === 'monthly' && <MonthlyTable
          siteId={siteId}
          rows={monthly}
          hasContract={!!contractTotal}
          cumulative={{ total: cumulativeTotal, progress: cumulativeProgress }}
        />}
      {tab === 'cost' && <CostTable
          periodSummary={costSummary(periodDays, contractTotal)}
          cumulativeSummary={costSummary(cumulativeDays, contractTotal)}
          periodLabel={isAll ? '工期全体' : `${Number(period.slice(0, 4))}年${Number(period.slice(5, 7))}月`}
        />}
      {tab === 'attendance' && <AttendanceTable rows={attendance(periodEntries)} />}
      {tab === 'workers' && <WorkersTable rows={workerCumulative(entries, carryovers, workerNames, workerPeriod)} isAll={isAll} />}
    </main>
  );
}
