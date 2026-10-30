import 'server-only';
import { jpDate, todayJst } from '@/lib/calc/format';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import { listLeaseItems, listSuppliers, listUnits, listVehicles, listWeather, listWorkers } from '@/lib/db/masters';
import type { Profile } from '@/lib/db/profile';
import { listIssuesForReport, listOpenIssues, listReportHeads, type ReportDetail } from '@/lib/db/reports';
import { getSiteMasters, type Site } from '@/lib/db/sites';
import type { SaveInput } from '@/lib/report/schema';
import type { ReportFormProps } from '@/components/report/ReportForm';
import type { ReportMasters } from '@/components/report/form-state';

// 日報入力画面と承認画面で共通の、ReportForm に渡す props の組み立て。

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

/** ReportForm の props のうち、画面ごとに決める readOnly / review は除いたものを返す。 */
export async function loadReportFormProps(
  profile: Profile,
  site: Site,
  date: string,
  report: ReportDetail,
): Promise<Omit<ReportFormProps, 'readOnly' | 'review'>> {
  const siteId = site.id;
  const [heads, selected, workers, suppliers, vehicles, leaseItems, units, weather, openIssues, issues] = await Promise.all([
    listReportHeads(siteId),
    getSiteMasters(siteId),
    listWorkers(),
    listSuppliers(),
    listVehicles(),
    listLeaseItems(),
    listUnits(),
    listWeather(),
    listOpenIssues(siteId),
    report.head ? listIssuesForReport(report.head.id) : Promise.resolve([]),
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

  return {
    siteId,
    siteName: site.name,
    date,
    today: todayJst(),
    heading: visitLabel(date, visitNumbers(allDates, date)),
    dateLabel: `${jpDate(date)}（${weekday(date)}）`,
    prevDate: shiftDate(date, -1),
    nextDate: shiftDate(date, 1),
    status: head ? head.status : 'none',
    rejectedReason: head ? head.rejectedReason : null,
    siteStartDate: site.startDate,
    contractAmount: site.contractAmount,
    outputBefore,
    hasPrevious: allDates.some((d) => d < date),
    initial,
    masters,
    reportId: head ? head.id : null,
    issues,
    openIssues,
    updatedAt: head ? head.updatedAt : null,
    createdBy: head ? head.createdBy : null,
    currentUserId: profile.id,
    isAdmin: profile.isAdmin,
  };
}
