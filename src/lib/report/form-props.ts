import 'server-only';
import { weekday } from '@/lib/calc/calendar';
import { jpDate, todayJst } from '@/lib/calc/format';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import { listLeaseItems, listSuppliers, listUnits, listVehicles, listWeather, listWorkers } from '@/lib/db/masters';
import type { Profile } from '@/lib/db/profile';
import { getMySiteRole, listIssuesForReport, listOpenFixRequestsForReport, listOpenIssues, listReportHeads, type ReportDetail } from '@/lib/db/reports';
import { canRequestReportFix, canReviewSite } from '@/lib/report/issue-status';
import { getSettings } from '@/lib/db/settings';
import { getSiteMasters, type Site } from '@/lib/db/sites';
import { vendorSuppliers } from '@/lib/calc/supplier-roles';
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

/**
 * 日報の作業員の選択肢（すべてのアカウントで同じ規則。協力会社アカウントの会社では絞らない）。
 * - 自社の作業員：forSite と同じ規則を自社の作業員だけで計算する（自社を 1 人も選んでいない現場は有効な自社の作業員全部）。
 * - 協力会社の作業員：この現場に登録した（gn_site_workers にある）有効な作業員だけ。登録が無くても全員にはしない。
 * - この日報ですでに使っている作業員（無効・登録を外した協力会社の作業員も）は残す。
 * 並びは 自社（forSite の並び）→ 協力会社（登録順）→ 使用中で残ったもの。手入力は画面側でいつでも使える。
 */
export function workersForSiteLabor<T extends { id: string; active: boolean; affiliation: 'own' | 'partner' }>(
  workers: T[],
  selectedWorkerIds: string[],
  usedIds: Set<string>,
): T[] {
  const own = workers.filter((w) => w.affiliation !== 'partner');
  const ownIds = new Set(own.map((w) => w.id));
  const out = forSite(own, selectedWorkerIds.filter((id) => ownIds.has(id)), usedIds);
  const seen = new Set(out.map((w) => w.id));
  const partners = new Map(workers.filter((w) => w.affiliation === 'partner').map((w) => [w.id, w]));
  for (const id of selectedWorkerIds) {
    const w = partners.get(id);
    if (w && !seen.has(id) && (w.active || usedIds.has(id))) {
      out.push(w);
      seen.add(id);
    }
  }
  for (const id of usedIds) {
    const w = partners.get(id);
    if (w && !seen.has(id)) {
      out.push(w);
      seen.add(id);
    }
  }
  return out;
}

/**
 * 日報の買掛の行の会社の選択肢：取引先の印のある会社だけ（協力会社だけの会社は出さない）で forSite と同じ規則。
 * この日報ですでに使っている会社は印が無くても残す。現場で選んだ会社が協力会社だけなら、選んでいない扱い（有効な取引先全部）にする。
 */
export function creditSuppliersForSite<T extends { id: string; active: boolean; isVendor: boolean }>(
  suppliers: T[],
  selectedIds: string[],
  usedIds: Set<string>,
): T[] {
  const vendors = suppliers.filter((s) => s.isVendor);
  const vendorIds = new Set(vendors.map((s) => s.id));
  return forSite(vendorSuppliers(suppliers, usedIds), selectedIds.filter((id) => vendorIds.has(id)), usedIds);
}

/** ReportForm の props のうち、画面ごとに決める readOnly / review は除いたものを返す。 */
export async function loadReportFormProps(
  profile: Profile,
  site: Site,
  date: string,
  report: ReportDetail,
): Promise<Omit<ReportFormProps, 'readOnly' | 'review'>> {
  const siteId = site.id;
  const [heads, selected, workers, suppliers, vehicles, leaseItems, units, weather, openIssues, issues, settings, role, fixRequests] = await Promise.all([
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
    getMySiteRole(siteId),
    report.head ? listOpenFixRequestsForReport(report.head.id) : Promise.resolve([]),
  ]);
  const used = { workers: new Set<string>(), suppliers: new Set<string>(), vehicles: new Set<string>(), leaseItems: new Set<string>() };
  for (const l of report.lines) {
    if (l.kind === 'labor' && l.workerId) used.workers.add(l.workerId);
    if (l.kind === 'credit' && l.supplierId) used.suppliers.add(l.supplierId);
    if (l.kind === 'fuel' && l.vehicleId) used.vehicles.add(l.vehicleId);
    if (l.kind === 'lease' && l.itemId) used.leaseItems.add(l.itemId);
  }

  const masters: ReportMasters = {
    workers: workersForSiteLabor(workers, selected.workerIds, used.workers).map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      rates: w.rates,
      overtimeRate: w.overtimeRate,
      affiliation: w.affiliation,
      supplierId: w.supplierId,
    })),
    vehicles: forSite(vehicles, selected.vehicleIds, used.vehicles).map((v) => ({ id: v.id, name: v.name, active: v.active, kmPerL: v.kmPerL })),
    leaseItems: forSite(leaseItems, selected.leaseItemIds, used.leaseItems).map((x) => ({
      id: x.id,
      name: x.name,
      spec: x.spec,
      active: x.active,
      rates: x.rates,
    })),
    suppliers: creditSuppliersForSite(suppliers, selected.supplierIds, used.suppliers).map((s) => ({ id: s.id, name: s.name, active: s.active })),
    units,
    weather,
    // 作業員の行の所属（自社／取引先名／所属なし）の表示用。協力会社のアカウントにも見えてよい（1 現場 1 日 1 枚で共有）。
    supplierNames: Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
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
    // 承認解除はその現場の確認者・承認者と管理者（最終判定は DB のガード）。完了現場は画面側で出さない。
    canReopen: canReviewSite(profile.isAdmin, role),
    canRequestFix: canRequestReportFix({
      status: head ? head.status : 'none',
      siteClosed: site.status === 'done',
      isAdmin: profile.isAdmin,
      accountType: profile.accountType,
      createdBy: head ? head.createdBy : null,
      currentUserId: profile.id,
    }),
    fixRequests,
    // 客先確認の記録の有無は確認日時で決める（日報の帳票 buildDailyReport と同じ）。
    clientConfirmation:
      head && head.clientConfirmedAt !== null
        ? { by: head.clientConfirmedBy ?? '', at: head.clientConfirmedAt, note: head.clientConfirmedNote ?? '' }
        : null,
  };
}
