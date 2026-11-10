import type { ChangeTotals } from '@/lib/calc/change';
import { creditItemLabel } from '@/lib/report/purchase-kind';
import { laborCostSplit, type LaborCostContext } from '@/lib/calc/labor-cost';
import { productivity } from '@/lib/calc/report';
import { visitNumbers } from '@/lib/calc/visit';
import { issueNumbers } from '@/lib/reports/change-model';
import type { Site } from '@/lib/db/sites';
import type {
  DailyLeaseRow,
  DailyPurchaseRow,
  DailyReportInput,
  DailyReportModel,
  DailyVehicleRow,
  DailyWorkerRow,
  DailyWorkRow,
  StoredLineValues,
} from '@/lib/reports/types';
import type { LaborLine, TimeSpec } from '@/lib/types';

// 日報 1 日分の帳票のデータ（純関数）。数値だけを持ち、整形はレンダラー（PDF・CSV）が行う。
// 金額・人工・残業・実働は DB の保存値（stored・saved・output_total）だけを使い、ここで再計算しない。
// 本日原価の合計は明細の保存値の和（見出しの cost_total は外注の買掛を含まないので使わない。2026-11-17）。
// 労務費は労務費の決まり（src/lib/calc/labor-cost.ts）の「原価に数える分」。人工は出面（全部）のまま。

const EMPTY_TIME: TimeSpec = { start: null, end: null, breakMin: null, gapMin: null };

const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/**
 * 作業員の行に出す時刻。アプリの計算（effectiveHours）と同じく、開始・終了のどちらかが空なら共通時間をそのまま使い、
 * 開始・終了があれば休憩・中抜の空欄だけ共通時間で補う。
 */
function laborTime(time: TimeSpec, common: TimeSpec): TimeSpec {
  if (time.start === null || time.end === null) return { ...common };
  return { start: time.start, end: time.end, breakMin: time.breakMin ?? common.breakMin, gapMin: time.gapMin ?? common.gapMin };
}

function workerRow(line: LaborLine & { stored: StoredLineValues }, common: TimeSpec, ctx: LaborCostContext): DailyWorkerRow {
  const t = laborTime(line.time, common);
  const split = laborCostSplit(line, ctx);
  return {
    workerId: line.workerId,
    name: line.workerName,
    manual: line.workerId === null,
    ...t,
    hours: line.saved?.hours ?? null,
    manDays: line.stored.manDays,
    overtimeHours: line.stored.overtimeHours,
    dailyRate: line.dailyRate,
    cost: split.countedCost,
    contract: split.contract,
    jouyouHours: split.contract === 'ukeoi' ? (line.jouyouHours ?? null) : null,
    ukeoiManDays: split.ukeoiManDays,
    note: line.note,
  };
}

/**
 * 本日の追加・増・変更・減：作業内容の行の保存値（stored.amount。減は負で保存）を区分ごとに足す（changeTotals と同じ形。
 * あちらは画面の入力から計算し直すので、帳票では使わない）。追加・増・変更・減の行が無ければ null。
 */
function storedChangeTotals(rows: DailyWorkRow[]): ChangeTotals | null {
  const of = (k: DailyWorkRow['changeKind']) => sum(rows.filter((r) => r.changeKind === k).map((r) => r.amount));
  if (!rows.some((r) => r.changeKind !== 'contract')) return null;
  const extra = of('extra');
  const increase = of('increase');
  const change = of('change');
  const minus = of('minus');
  return { extra, increase, change, minus, net: extra + increase + change + minus };
}

/** 日報のある日の帳票データ。 */
export function buildDailyReport(input: DailyReportInput): DailyReportModel {
  const { site, report, names } = input;
  const issueNumber = issueNumbers(input.issues);
  const workers: DailyWorkerRow[] = [];
  const vehicles: DailyVehicleRow[] = [];
  const leases: DailyLeaseRow[] = [];
  const cash: DailyPurchaseRow[] = [];
  const credit: DailyPurchaseRow[] = [];
  const work: DailyWorkRow[] = [];

  for (const line of report.lines) {
    const amount = line.stored.amount;
    switch (line.kind) {
      case 'labor':
        workers.push(workerRow(line, report.common, input.laborCost));
        break;
      case 'fuel':
        vehicles.push({
          vehicleId: line.vehicleId,
          name: line.vehicleName,
          manual: line.vehicleId === null,
          kmPerL: line.kmPerL,
          distanceKm: line.distanceKm,
          pricePerL: line.pricePerL,
          cost: amount,
          note: line.note,
        });
        break;
      case 'lease':
        leases.push({
          itemId: line.itemId,
          name: line.itemName,
          manual: line.itemId === null,
          spec: line.spec,
          unit: line.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
          amount,
          note: line.note,
        });
        break;
      case 'cash':
        cash.push({ name: line.itemName, spec: line.spec, unit: line.unit, qty: line.qty, unitPrice: line.unitPrice, amount, vendor: line.vendor, vendorManual: false });
        break;
      case 'credit':
        credit.push({
          // 外注の行（2026-11-17）は品名の頭に【外注・工種名】。
          name: creditItemLabel(line, line.siteTradeId ? (input.tradeNames?.[line.siteTradeId] ?? null) : null),
          spec: line.spec,
          unit: line.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
          amount,
          vendor: line.vendor,
          vendorManual: line.supplierId === null && line.vendor !== '',
        });
        break;
      case 'work': {
        const manDays = line.stored.manDays;
        work.push({
          trade: line.trade,
          description: line.description,
          qty: line.qty,
          unit: line.unit,
          manDays,
          productivity: productivity(line.qty, manDays),
          unitPrice: line.unitPrice,
          amount,
          changeKind: line.changeKind,
        });
        break;
      }
    }
  }

  const labor = sum(workers.map((r) => r.cost));
  const fuel = sum(vehicles.map((r) => r.cost));
  const lease = sum(leases.map((r) => r.amount));
  const cashTotal = sum(cash.map((r) => r.amount));
  const creditTotal = sum(credit.map((r) => r.amount));
  // 買掛のうち外注（2026-11-17）。買掛費（creditTotal）に 1 回だけ入っている。
  const subcontractTotal = sum(report.lines.flatMap((l) => (l.kind === 'credit' && l.purchaseKind === 'subcontract' ? [l.stored.amount] : [])));
  const visit = visitNumbers(input.reportDates, report.reportDate);
  const cumulative = input.cumulativeOutputBefore + report.outputTotal;
  const contract = site.contractAmount;
  const nameOf = (id: string | null) => (id !== null ? (names[id] ?? null) : null);

  return {
    isEmpty: false,
    header: {
      siteName: site.name,
      projectNo: site.projectNo,
      date: report.reportDate,
      monthIndex: visit.monthIndex,
      totalIndex: visit.totalIndex,
      weather: report.weather,
      supervisor: report.supervisor,
      common: { ...report.common },
    },
    workers: {
      rows: workers,
      total: {
        hours: sum(workers.map((r) => r.hours ?? 0)),
        manDays: sum(workers.map((r) => r.manDays)),
        ukeoiManDays: Math.round(sum(workers.map((r) => r.ukeoiManDays)) * 100) / 100,
        overtimeHours: sum(workers.map((r) => r.overtimeHours)),
        cost: labor,
      },
    },
    vehicles: { rows: vehicles, total: { distanceKm: sum(vehicles.map((r) => r.distanceKm ?? 0)), cost: fuel } },
    leases: { rows: leases, total: { amount: lease } },
    cash: { rows: cash, total: { amount: cashTotal } },
    credit: { rows: credit, total: { amount: creditTotal } },
    costs: { labor, fuel, lease, cash: cashTotal, credit: creditTotal, subcontract: subcontractTotal, total: labor + fuel + lease + cashTotal + creditTotal },
    output: { today: report.outputTotal, cumulative, contractAmount: contract, progress: contract ? cumulative / contract : null, ...contractBasis(site) },
    work: { rows: work, total: { manDays: sum(work.map((r) => r.manDays)), amount: sum(work.map((r) => r.amount)) }, changes: storedChangeTotals(work) },
    issues: {
      text: report.issuesText,
      items: input.issues.map((i) => ({
        number: issueNumber.get(i.id) ?? 0,
        body: i.body,
        status: i.status,
        doneAt: i.doneAt,
        kind: i.kind,
        instructedBy: i.instructedBy,
        instructionMethod: i.instructionMethod,
      })),
    },
    notes: report.notesText,
    signature: {
      createdBy: nameOf(report.createdBy) ?? report.supervisor,
      reviewedBy: nameOf(report.reviewedBy),
      approvedBy: nameOf(report.approvedBy),
      approvedAt: report.approvedAt,
    },
    clientConfirmation:
      report.clientConfirmedAt !== null
        ? { by: report.clientConfirmedBy ?? '', at: report.clientConfirmedAt, note: report.clientConfirmedNote ?? '' }
        : null,
  };
}

/** 契約の状態：未確定の現場は概算金額も出す（確定の現場の estimatedAmount は null）。 */
function contractBasis(site: Site): { tentative: boolean; estimatedAmount: number | null } {
  const tentative = site.contractStatus === 'tentative';
  return { tentative, estimatedAmount: tentative ? site.estimatedAmount : null };
}

/**
 * 日報の無い日の帳票データ（エラーにしない。isEmpty: true、表はすべて空）。日報の無い月の帳票では date に 'YYYY-MM' を渡す
 * （PDF の見出しは「YYYY年MM月」。dailyDateLabel）。
 */
export function buildEmptyDailyReport(site: Site, date: string): DailyReportModel {
  return {
    isEmpty: true,
    header: { siteName: site.name, projectNo: site.projectNo, date, monthIndex: null, totalIndex: null, weather: null, supervisor: null, common: { ...EMPTY_TIME } },
    workers: { rows: [], total: { hours: 0, manDays: 0, ukeoiManDays: 0, overtimeHours: 0, cost: 0 } },
    vehicles: { rows: [], total: { distanceKm: 0, cost: 0 } },
    leases: { rows: [], total: { amount: 0 } },
    cash: { rows: [], total: { amount: 0 } },
    credit: { rows: [], total: { amount: 0 } },
    costs: { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, total: 0 },
    output: { today: 0, cumulative: null, contractAmount: site.contractAmount, progress: null, ...contractBasis(site) },
    work: { rows: [], total: { manDays: 0, amount: 0 }, changes: null },
    issues: { text: '', items: [] },
    notes: '',
    signature: { createdBy: null, reviewedBy: null, approvedBy: null, approvedAt: null },
    clientConfirmation: null,
  };
}
