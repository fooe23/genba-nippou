import { notFound } from 'next/navigation';
import { jpDate, todayJst } from '@/lib/calc/format';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import { dateSchema } from '@/lib/db/masters-schemas';
import { listLeaseItems, listSuppliers, listUnits, listVehicles, listWeather, listWorkers } from '@/lib/db/masters';
import { requireProfile } from '@/lib/db/profile';
import { getReport, listReportHeads } from '@/lib/db/reports';
import { getSite, getSiteMasters } from '@/lib/db/sites';
import type { SaveInput } from '@/lib/report/schema';
import { ReportForm } from '@/components/report/ReportForm';
import type { ReportMasters } from '@/components/report/form-state';

export const metadata = { title: '日報' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// 現場で使う（選択済みの）マスターのうち有効なもの＋この日報ですでに使っているもの。並びは現場の選択順。
function forSite<T extends { id: string; active: boolean }>(items: T[], selectedIds: string[], usedIds: Set<string>): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const item = byId.get(id);
    if (item && !seen.has(id) && (item.active || usedIds.has(id))) {
      out.push(item);
      seen.add(id);
    }
  }
  for (const id of usedIds) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      out.push(item);
      seen.add(id);
    }
  }
  return out;
}

export default async function ReportPage({ params }: PageProps<'/sites/[siteId]/reports/[date]'>) {
  const profile = await requireProfile();
  const { siteId, date } = await params;
  if (!UUID.test(siteId) || !dateSchema.safeParse(date).success) notFound();
  const site = await getSite(siteId);
  if (!site) notFound();

  const [report, heads, selected, workers, suppliers, vehicles, leaseItems, units, weather] = await Promise.all([
    getReport(siteId, date),
    listReportHeads(siteId),
    getSiteMasters(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listUnits(),
    listWeather(),
  ]);

  const used = { workers: new Set<string>(), suppliers: new Set<string>(), vehicles: new Set<string>(), leaseItems: new Set<string>() };
  for (const l of report.lines) {
    if (l.kind === 'labor' && l.workerId) used.workers.add(l.workerId);
    if (l.kind === 'credit' && l.supplierId) used.suppliers.add(l.supplierId);
    if (l.kind === 'fuel' && l.vehicleId) used.vehicles.add(l.vehicleId);
    if (l.kind === 'lease' && l.itemId) used.leaseItems.add(l.itemId);
  }

  const masters: ReportMasters = {
    workers: forSite(workers, selected.workerIds, used.workers).map((w) => ({ id: w.id, name: w.name, active: w.active, rates: w.rates })),
    vehicles: forSite(vehicles, selected.vehicleIds, used.vehicles).map((v) => ({ id: v.id, name: v.name, active: v.active, kmPerL: v.kmPerL })),
    leaseItems: forSite(leaseItems, selected.leaseItemIds, used.leaseItems).map((x) => ({
      id: x.id,
      name: x.name,
      spec: x.spec,
      active: x.active,
      rates: x.rates,
    })),
    suppliers: forSite(suppliers, selected.supplierIds, used.suppliers).map((s) => ({ id: s.id, name: s.name, active: s.active })),
    units,
    weather,
  };

  const head = report.head;
  const initial: SaveInput = {
    siteId,
    date,
    weather: head ? head.weather : null,
    // 新しい日報の作業責任者は自分（書き換え可）。
    supervisor: head ? head.supervisor : profile.name || null,
    common: report.common,
    issuesText: report.issuesText,
    notesText: report.notesText,
    lines: report.lines,
  };

  const allDates = heads.map((h) => h.reportDate);
  const outputBefore = heads.filter((h) => h.reportDate < date).reduce((s, h) => s + h.outputTotal, 0);

  return (
    <main className="mx-auto w-full max-w-6xl p-4">
      <ReportForm
        key={`${siteId}:${date}`}
        siteId={siteId}
        siteName={site.name}
        date={date}
        today={todayJst()}
        heading={visitLabel(date, visitNumbers(allDates, date))}
        dateLabel={`${jpDate(date)}（${weekday(date)}）`}
        prevDate={shiftDate(date, -1)}
        nextDate={shiftDate(date, 1)}
        status={head ? head.status : 'none'}
        readOnly={head?.status === 'approved'}
        siteStartDate={site.startDate}
        contractAmount={site.contractAmount}
        outputBefore={outputBefore}
        hasPrevious={allDates.some((d) => d < date)}
        initial={initial}
        masters={masters}
      />
    </main>
  );
}
