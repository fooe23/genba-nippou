import { productivity } from '@/lib/calc/report';
import { visitNumbers } from '@/lib/calc/visit';
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
// 金額・人工・残業・実働は DB の保存値（stored・saved・cost_total・output_total）だけを使い、ここで再計算しない。

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

function workerRow(line: LaborLine & { stored: StoredLineValues }, common: TimeSpec): DailyWorkerRow {
  const t = laborTime(line.time, common);
  return {
    workerId: line.workerId,
    name: line.workerName,
    manual: line.workerId === null,
    ...t,
    hours: line.saved?.hours ?? null,
    manDays: line.stored.manDays,
    overtimeHours: line.stored.overtimeHours,
    dailyRate: line.dailyRate,
    cost: line.stored.amount,
    note: line.note,
  };
}

/** 日報のある日の帳票データ。 */
export function buildDailyReport(input: DailyReportInput): DailyReportModel {
  const { site, report, names } = input;
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
        workers.push(workerRow(line, report.common));
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
          name: line.itemName,
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
        overtimeHours: sum(workers.map((r) => r.overtimeHours)),
        cost: labor,
      },
    },
    vehicles: { rows: vehicles, total: { distanceKm: sum(vehicles.map((r) => r.distanceKm ?? 0)), cost: fuel } },
    leases: { rows: leases, total: { amount: lease } },
    cash: { rows: cash, total: { amount: cashTotal } },
    credit: { rows: credit, total: { amount: creditTotal } },
    costs: { labor, fuel, lease, cash: cashTotal, credit: creditTotal, total: labor + fuel + lease + cashTotal + creditTotal, costTotal: report.costTotal },
    output: { today: report.outputTotal, cumulative, contractAmount: contract, progress: contract ? cumulative / contract : null },
    work: { rows: work, total: { manDays: sum(work.map((r) => r.manDays)), amount: sum(work.map((r) => r.amount)) } },
    issues: { text: report.issuesText, items: input.issues.map((i) => ({ body: i.body, status: i.status, doneAt: i.doneAt })) },
    notes: report.notesText,
    signature: {
      createdBy: nameOf(report.createdBy) ?? report.supervisor,
      reviewedBy: nameOf(report.reviewedBy),
      approvedBy: nameOf(report.approvedBy),
      approvedAt: report.approvedAt,
    },
  };
}

/** 日報の無い日の帳票データ（エラーにしない。isEmpty: true、表はすべて空）。 */
export function buildEmptyDailyReport(site: Site, date: string): DailyReportModel {
  return {
    isEmpty: true,
    header: { siteName: site.name, projectNo: site.projectNo, date, monthIndex: null, totalIndex: null, weather: null, supervisor: null, common: { ...EMPTY_TIME } },
    workers: { rows: [], total: { hours: 0, manDays: 0, overtimeHours: 0, cost: 0 } },
    vehicles: { rows: [], total: { distanceKm: 0, cost: 0 } },
    leases: { rows: [], total: { amount: 0 } },
    cash: { rows: [], total: { amount: 0 } },
    credit: { rows: [], total: { amount: 0 } },
    costs: { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, total: 0, costTotal: 0 },
    output: { today: 0, cumulative: null, contractAmount: site.contractAmount, progress: null },
    work: { rows: [], total: { manDays: 0, amount: 0 } },
    issues: { text: '', items: [] },
    notes: '',
    signature: { createdBy: null, reviewedBy: null, approvedBy: null, approvedAt: null },
  };
}
