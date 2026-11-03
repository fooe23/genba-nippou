import 'server-only';
import { weekday } from '@/lib/calc/calendar';
import { jpDate, todayJst } from '@/lib/calc/format';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import { listLeaseItems, listSuppliers, listUnits, listVehicles, listWeather, listWorkers } from '@/lib/db/masters';
import type { Profile } from '@/lib/db/profile';
import { listIssuesForReport, listOpenIssues, listReportHeads, type ReportDetail } from '@/lib/db/reports';
import { getSettings } from '@/lib/db/settings';
import { getSiteMasters, type Site } from '@/lib/db/sites';
import type { SaveInput } from '@/lib/report/schema';
import type { ReportFormProps } from '@/components/report/ReportForm';
import { newReportCommon, type ReportMasters } from '@/components/report/form-state';

// 日報入力画面と承認画面で共通の、ReportForm に渡す props の組み立て。

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 現場で使う（選択済みの）マスターのうち有効なもの＋この日報ですでに使っているもの。並びは現場の選択順。
// 現場で 1 件も選んでいない種類は、有効なもの全部（マスターの並び）を出す（設定し忘れでも入力できるように）。
export function forSite<T extends { id: string; active: boolean }>(items: T[], selectedIds: string[], usedIds: Set<string>): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  const seen = new Set<string>();
  const ids = selectedIds.length > 0 ? selectedIds : items.filter((i) => i.active).map((i) => i.id);
  for (const id of ids) {
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
  const [heads, selected, workers, suppliers, vehicles, leaseItems, units, weather, openIssues, issues, settings] = await Promise.all([
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
    getSettings(),
  ]);
  const used = { workers: new Set<string>(), suppliers: new Set<string>(), vehicles: new Set<string>(), leaseItems: new Set<string>() };
  for (const l of report.lines) {
    if (l.kind === 'labor' && l.workerId) used.workers.add(l.workerId);
    if (l.kind === 'credit' && l.supplierId) used.suppliers.add(l.supplierId);
    if (l.kind === 'fuel' && l.vehicleId) used.vehicles.add(l.vehicleId);
    if (l.kind === 'lease' && l.itemId) used.leaseItems.add(l.itemId);
  }

  const masters: ReportMasters = {
    workers: forSite(workers, selected.workerIds, used.workers).map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      rates: w.rates,
      overtimeRate: w.overtimeRate,
    })),
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
    // 新しい日報（未保存）の共通時間は、現場の既定 → 全社の設定の既定。保存済みの日報はそのまま。
    // 端末の下書きの復元・前回コピーはこの後にクライアントで行うので、ここでは影響しない。
    common: head
      ? report.common
      : newReportCommon(
          { start: site.commonStart, end: site.commonEnd, breakMin: site.commonBreakMin, gapMin: site.commonGapMin },
          settings.defaultCommon,
        ),
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
    contractTentative: site.contractStatus === 'tentative',
    estimatedAmount: site.contractStatus === 'tentative' ? site.estimatedAmount : null,
    outputBefore,
    hasPrevious: allDates.some((d) => d < date),
    initial,
    masters,
    rule: settings.rule,
    reportId: head ? head.id : null,
    issues,
    openIssues,
    updatedAt: head ? head.updatedAt : null,
    createdBy: head ? head.createdBy : null,
    currentUserId: profile.id,
    isAdmin: profile.isAdmin,
    // 客先確認の記録の有無は確認日時で決める（日報の帳票 buildDailyReport と同じ）。
    clientConfirmation:
      head && head.clientConfirmedAt !== null
        ? { by: head.clientConfirmedBy ?? '', at: head.clientConfirmedAt, note: head.clientConfirmedNote ?? '' }
        : null,
  };
}
