import 'server-only';
import { weekday } from '@/lib/calc/calendar';
import { jpDate, todayJst } from '@/lib/calc/format';
import { visitLabel, visitNumbers } from '@/lib/calc/visit';
import { listLeaseItems, listSuppliers, listUnits, listVehicles, listWeather, listWorkers } from '@/lib/db/masters';
import { isEmployeeOrAdmin, type Profile } from '@/lib/db/profile';
import { listAttachmentsForIssues, listAttachmentsForReport, signedUrls } from '@/lib/db/attachments';
import type { Attachment } from '@/lib/db/attachments-schemas';
import type { AttachmentView } from '@/components/attachments/types';
import {
  getMySiteRole,
  listIssueConfirmations,
  listIssuesForReport,
  listOpenFixRequestsForReport,
  listOpenIssues,
  listReportHeads,
  headcountColumnReady,
  subcontractColumnsReady,
  type ReportDetail,
} from '@/lib/db/reports';
import { canRequestReportFix, canReviewSite } from '@/lib/report/issue-status';
import { loadSiteTrades, loadTradeAliases, loadUkeoiSupplierIds } from '@/lib/db/budget';
import { loadLaborCostContext } from '@/lib/db/labor-cost';
import { loadSubcontractBudgetView, loadSubcontractOutputs } from '@/lib/db/subcontract-output';
import { getSettings } from '@/lib/db/settings';
import { getClientSignatureState, signatureImageUrl } from '@/lib/db/client-signature';
import { NO_SIGNATURE, type ClientSignatureView } from '@/lib/report/client-signature';
import { getSiteMasters, listSitePartners, type Site } from '@/lib/db/sites';
import { vendorSuppliers } from '@/lib/calc/supplier-roles';
import { isUnnamedLabor, unnamedCompanyChoices } from '@/lib/report/unnamed-workers';
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

/**
 * 外注の買掛（2026-11-17）の支払先の選択肢：協力会社の印のある会社だけで forSite と同じ規則（選択＝現場の協力会社
 * gn_site_partners。1 社も無い現場は有効な協力会社全部）。この日報の外注の行で使っている会社は無効・印を外した後でも残す。
 * 社員・管理者でない（協力会社のアカウント）か、DB に区分の列が無い（SQL の前）ときは undefined（区分の欄を出さない）。
 */
export function subcontractSuppliersForSite<T extends { id: string; active: boolean; isPartner: boolean }>(opts: {
  isStaff: boolean;
  ready: boolean;
  suppliers: T[];
  sitePartnerIds: string[];
  usedIds: Set<string>;
}): T[] | undefined {
  if (!opts.isStaff || !opts.ready) return undefined;
  const partners = opts.suppliers.filter((s) => s.isPartner || opts.usedIds.has(s.id));
  const partnerIds = new Set(opts.suppliers.filter((s) => s.isPartner).map((s) => s.id));
  return forSite(partners, opts.sitePartnerIds.filter((id) => partnerIds.has(id)), opts.usedIds);
}

/**
 * 件の添付（上の枠の件とこの日報の件）を読み、日報の添付（先に読んだもの）と合わせて署名付き URL をまとめて作る
 * （バケットごとに 1 回）。協力会社には RLS でファイルの行が来ない。
 */
async function loadAttachmentViews(
  report: Attachment[],
  issueIds: string[],
): Promise<{ report: AttachmentView[]; byIssue: Record<string, AttachmentView[]> }> {
  const byIssue = await listAttachmentsForIssues(issueIds);
  const all = [...report, ...[...byIssue.values()].flat()];
  const urls = all.length > 0 ? await signedUrls(all) : new Map<string, string>();
  const view = (a: Attachment): AttachmentView => ({ ...a, href: urls.get(a.id) ?? '' });
  return {
    report: report.map(view),
    byIssue: Object.fromEntries([...byIssue].map(([id, list]) => [id, list.map(view)])),
  };
}

/** ReportForm の props のうち、画面ごとに決める readOnly / review は除いたものを返す。 */
/** 日報のお客様のサイン（いまのサインの画像の URL と、取り消したサインの記録）。 */
async function loadSignatureView(reportId: string): Promise<ClientSignatureView> {
  const state = await getClientSignatureState(reportId);
  if (!state) return NO_SIGNATURE;
  const c = state.current;
  return {
    current: c
      ? { signedAt: c.signedAt, confirmedBy: c.confirmedBy, note: c.note, imageUrl: await signatureImageUrl(c.path), hasPdf: c.pdfPath !== null }
      : null,
    history: state.history,
  };
}

export async function loadReportFormProps(
  profile: Profile,
  site: Site,
  date: string,
  report: ReportDetail,
): Promise<Omit<ReportFormProps, 'readOnly' | 'review'>> {
  const siteId = site.id;
  const staff = isEmployeeOrAdmin(profile);
  const [heads, selected, workers, suppliers, vehicles, leaseItems, units, weather, openIssues, issues, settings, role, fixRequests, reportAttachments, signature, siteTrades, tradeAliases] = await Promise.all([
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
    report.head ? listAttachmentsForReport(report.head.id) : Promise.resolve<Attachment[]>([]),
    report.head ? loadSignatureView(report.head.id) : Promise.resolve(NO_SIGNATURE),
    // 実行予算の工種と読み替え表（名前だけ。協力会社を含む現場メンバーが読める）
    loadSiteTrades(siteId),
    loadTradeAliases(siteId),
  ]);
  // 労務費の決まり（2026-11-17）：設定と実行予算の常用の単価（単価は社員・管理者だけ）、新しい行の常用・請負の既定に使う
  // 請負の会社の一覧（協力会社のアカウントも読める。金額は無い）。
  // 名前なし（会社と人数）の作業員の行（2026-11-19）は、DB に人数の列があるときだけ出す。
  const [laborCost, ukeoiSupplierIds, unnamedReady] = await Promise.all([
    loadLaborCostContext(siteId),
    loadUkeoiSupplierIds(siteId),
    headcountColumnReady(),
  ]);
  // 外注の買掛の支払先（現場の協力会社）と、DB に区分の列があるか。社員・管理者だけ読む（協力会社には区分の欄を出さない）。
  const [sitePartners, subcontractReady] = staff
    ? await Promise.all([listSitePartners(siteId), subcontractColumnsReady()])
    : [[], false];
  const issueIds = [...openIssues.map((i) => i.id), ...issues.map((i) => i.id)];
  const [attachmentViews, confirmations] = await Promise.all([
    loadAttachmentViews(reportAttachments, issueIds),
    listIssueConfirmations(issueIds),
  ]);
  const used = {
    workers: new Set<string>(),
    suppliers: new Set<string>(),
    subcontractSuppliers: new Set<string>(),
    unnamedCompanies: new Set<string>(),
    vehicles: new Set<string>(),
    leaseItems: new Set<string>(),
  };
  for (const l of report.lines) {
    if (l.kind === 'labor' && l.workerId) used.workers.add(l.workerId);
    if (l.kind === 'labor' && !l.workerId && isUnnamedLabor(l) && l.supplierId) used.unnamedCompanies.add(l.supplierId);
    if (l.kind === 'credit' && l.supplierId) {
      if (l.purchaseKind === 'subcontract') used.subcontractSuppliers.add(l.supplierId);
      else used.suppliers.add(l.supplierId);
    }
    if (l.kind === 'fuel' && l.vehicleId) used.vehicles.add(l.vehicleId);
    if (l.kind === 'lease' && l.itemId) used.leaseItems.add(l.itemId);
  }

  const siteWorkers = workersForSiteLabor(workers, selected.workerIds, used.workers);
  const masters: ReportMasters = {
    workers: siteWorkers.map((w) => ({
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
    siteTrades,
    tradeAliases,
    subcontractSuppliers: subcontractSuppliersForSite({
      isStaff: staff,
      ready: subcontractReady,
      suppliers,
      sitePartnerIds: sitePartners.map((p) => p.supplierId),
      usedIds: used.subcontractSuppliers,
    })?.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    // 名前なしの行の会社：現場に関わる協力会社（現場の協力会社［社員・管理者だけ読める］・この現場の協力会社の作業員の会社・
    // 実行予算で請負の会社）。協力会社のアカウントにも出す。DB に人数の列が無ければ undefined（選択肢を出さない）。
    unnamedCompanies: unnamedReady
      ? unnamedCompanyChoices({
          suppliers,
          siteCompanyIds: [
            ...sitePartners.map((p) => p.supplierId),
            ...siteWorkers.flatMap((w) => (w.affiliation === 'partner' && w.supplierId ? [w.supplierId] : [])),
            ...ukeoiSupplierIds,
          ],
          usedIds: used.unnamedCompanies,
        }).map((s) => ({ id: s.id, name: s.name, active: s.active }))
      : undefined,
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

  const showMoney = isEmployeeOrAdmin(profile);
  const allDates = heads.map((h) => h.reportDate);
  // 前日までの出来高は外注の支払いのうち出来高に数える分も入れる（2026-11-11。協力会社には外注の行が無いので 0）。
  // 外注の行の請負の進み（請負額・これまでの支払い）は社員・管理者だけ、DB に区分の列があるときだけ読む。
  const [subcontract, subcontractBudget] = await Promise.all([
    loadSubcontractOutputs(heads.map((h) => h.id)),
    staff && subcontractReady
      ? loadSubcontractBudgetView(siteId, heads.filter((h) => h.reportDate < date).map((h) => h.id))
      : Promise.resolve(undefined),
  ]);
  const outputBefore = heads.filter((h) => h.reportDate < date).reduce((s, h) => s + h.outputTotal + (subcontract.byReport.get(h.id)?.total ?? 0), 0);

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
    // 請負金額・概算金額は社員・管理者だけ（協力会社には null。集計の金額の行と進捗率も出さない：ReportSummary の showMoney）。
    contractAmount: showMoney ? site.contractAmount : null,
    contractTentative: site.contractStatus === 'tentative',
    estimatedAmount: showMoney && site.contractStatus === 'tentative' ? site.estimatedAmount : null,
    outputBefore,
    subcontractIssueKinds: subcontract.issueKinds,
    subcontractBudget,
    hasPrevious: allDates.some((d) => d < date),
    initial,
    masters,
    rule: settings.rule,
    laborCost,
    ukeoiSupplierIds,
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
    attachments: attachmentViews.report,
    issueAttachments: attachmentViews.byIssue,
    isStaff: isEmployeeOrAdmin(profile),
    // 客先確認の記録の有無は確認日時で決める（日報の帳票 buildDailyReport と同じ）。
    clientConfirmation:
      head && head.clientConfirmedAt !== null
        ? { by: head.clientConfirmedBy ?? '', at: head.clientConfirmedAt, note: head.clientConfirmedNote ?? '' }
        : null,
    clientSignature: signature,
    issueConfirmations: Object.fromEntries(confirmations),
  };
}
