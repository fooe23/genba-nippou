import Link from 'next/link';
import { notFound } from 'next/navigation';
import { attendance, costSummary, monthlyRows, workerCumulative } from '@/lib/calc/aggregate';
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
  const site = await getSite(siteId);
  if (!site) notFound();

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

  const workerNames = Object.fromEntries(workers.map((w) => [w.id, w.name]));

  return (
    <main className="mx-auto w-full max-w-5xl p-4">
      <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {site.name}
      </Link>
      <h1 className="mb-3 text-xl font-bold">集計</h1>

      <PeriodBar period={period} currentMonth={currentMonth} />
      <SummaryTabs siteId={siteId} active={tab} period={period} />

      {tab === 'monthly' && <MonthlyTable siteId={siteId} rows={monthly} hasContract={!!contractTotal} />}
      {tab === 'cost' && <CostTable summary={costSummary(periodDays, contractTotal)} />}
      {tab === 'attendance' && <AttendanceTable rows={attendance(periodEntries)} />}
      {tab === 'workers' && <WorkersTable rows={workerCumulative(periodEntries, carryovers, workerNames)} />}
    </main>
  );
}
