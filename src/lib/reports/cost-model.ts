import {
  costSummary,
  monthlyRows,
  sumRows,
  workerCumulative,
  type DayTotals,
  type LaborEntry,
  type MonthlyRow,
  type Period,
} from '@/lib/calc/aggregate';
import { daysBetween } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import type {
  CostReportHeader,
  CostReportInput,
  CostReportModel,
  CostReportNow,
  CostReportPeriod,
  EquipmentSection,
  LeaseRow,
  Profitability,
  ReportWithLines,
  TradeRow,
  TradeSection,
  Trend,
  TrendRow,
  VehicleRow,
  VendorRow,
  VendorSection,
  WorkerRow,
  WorkerSection,
} from '@/lib/reports/types';

// 工事原価集計表のデータ組み立て（純関数。DB・Next に依存しない）。数値だけを持ち、整形はレンダラーが行う。
// 金額・人工はすべて保存値（cost_total・output_total・明細の amount・man_days・overtime_hours）から計算し、
// アプリ内の集計画面（src/app/(app)/sites/[siteId]/summary）と同じ関数（monthlyRows・sumRows・costSummary・
// workerCumulative）を使う。
//
// 集計の範囲（期間が月のとき。工期全体のときはどれも全日報）：
// - ① 原価合計、③ の各行の 5 費目・原価合計・出来高、⑤ 取引先別、⑥ 車両・リース、⑦ 工種別 … その月の日報だけ
// - ② 採算（総原価・粗利・累計出来高・進捗率・総人工・1 人工／1 日あたり原価）、③ の累計原価・進捗率
//   … 現場の最初の日報からその月の末日までの累計
// - ④ 作業員別累計 … workerCumulative に { from: 月初, to: 月末 } を渡す（繰越初期値 + 前月までの日報が前月繰越）
// - ③ は工期全体なら日報のある月ごと、月なら日報のある週ごと（月曜始まり。月をまたぐ週はその月の中に切り詰める）

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM' の末日 'YYYY-MM-DD'。 */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** date を含む週の月曜日。 */
function weekMonday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const offset = (t.getUTCDay() + 6) % 7; // 月曜 0 … 日曜 6
  t.setUTCDate(t.getUTCDate() - offset);
  return t.toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string) => (a < b ? a : b);

/** 日報 1 件を集計画面と同じ DayTotals にする（区分別の合計は明細の保存値 amount）。 */
function toDayTotals(r: ReportWithLines): DayTotals {
  const t = { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, workerCount: 0 };
  for (const l of r.lines) {
    switch (l.kind) {
      case 'labor': t.labor += l.stored.amount; t.workerCount += 1; break;
      case 'fuel': t.fuel += l.stored.amount; break;
      case 'lease': t.lease += l.stored.amount; break;
      case 'cash': t.cash += l.stored.amount; break;
      case 'credit': t.credit += l.stored.amount; break;
    }
  }
  return { ...r, ...t };
}

function laborEntries(reports: ReportWithLines[]): LaborEntry[] {
  return reports.flatMap((r) =>
    r.lines.flatMap((l) =>
      l.kind === 'labor'
        ? [{ reportDate: r.reportDate, workerId: l.workerId, workerName: l.workerName, manDays: l.stored.manDays, cost: l.stored.amount, overtimeHours: l.stored.overtimeHours }]
        : [],
    ),
  );
}

// ─── 見出し ───

function buildHeader(
  input: CostReportInput,
  allReports: ReportWithLines[],
  periodReports: ReportWithLines[],
  period: CostReportPeriod,
  now: CostReportNow,
): CostReportHeader {
  const { site } = input;
  const first = allReports[0]?.reportDate ?? null;
  const last = allReports[allReports.length - 1]?.reportDate ?? null;
  const start = site.startDate ?? first;
  const end = site.status === 'done' ? (last ?? now.date) : now.date;
  return {
    siteName: site.name,
    clientName: site.clientName,
    projectName: site.projectName,
    projectNo: site.projectNo,
    contractType: site.contractType,
    overview: site.overview,
    startDate: site.startDate,
    endDate: site.endDate,
    elapsedDays: start === null ? null : Math.max(0, daysBetween(start, end) + 1),
    siteStatus: site.status,
    reportCount: periodReports.length,
    approvedCount: periodReports.filter((r) => r.status === 'approved').length,
    period:
      period.kind === 'month'
        ? { kind: 'month', month: period.month, from: `${period.month}-01`, to: monthEnd(period.month) }
        : { kind: 'all', month: null, from: first, to: last },
    outputDate: now.date,
    outputAt: now.at ?? null,
  };
}

// ─── ② 採算 ───

function buildProfit(cumulativeReports: ReportWithLines[], cumulativeDays: DayTotals[], contractTotal: number | null): Profitability {
  const s = costSummary(cumulativeDays, contractTotal);
  const hasContract = contractTotal !== null && contractTotal !== 0;
  const totalManDays = round2(laborEntries(cumulativeReports).reduce((sum, e) => sum + e.manDays, 0));
  const dayCount = cumulativeDays.length;
  return {
    contractTotal,
    totalCost: s.cost,
    grossProfit: s.grossProfit,
    grossMargin: s.grossMargin,
    cumulativeOutput: cumulativeDays.reduce((sum, d) => sum + d.outputTotal, 0),
    progress: hasContract ? s.progress : null,
    totalManDays,
    costPerManDay: totalManDays === 0 ? null : s.cost / totalManDays,
    costPerDay: dayCount === 0 ? null : s.cost / dayCount,
    dayCount,
  };
}

// ─── ③ 月別推移（週ごと） ───

interface Bucket { key: string; from: string; to: string; }

function buildTrend(allDays: DayTotals[], period: CostReportPeriod, periodMonths: string[], contractTotal: number | null): Trend {
  const hasContract = contractTotal !== null && contractTotal !== 0;
  // 日ごとの行（progress は現場の全日報での累計出来高ベース）。
  const daily: MonthlyRow[] = periodMonths.flatMap((m) => monthlyRows(allDays, m, contractTotal));

  const buckets: Bucket[] = [];
  const seen = new Set<string>();
  for (const r of daily) {
    let b: Bucket;
    if (period.kind === 'month') {
      const monday = weekMonday(r.date);
      const from = maxDate(monday, `${period.month}-01`);
      b = { key: from, from, to: minDate(addDays(monday, 6), monthEnd(period.month)) };
    } else {
      const m = monthKey(r.date);
      b = { key: m, from: `${m}-01`, to: monthEnd(m) };
    }
    if (!seen.has(b.key)) {
      seen.add(b.key);
      buckets.push(b);
    }
  }

  const cumulativeCostTo = (to: string) => allDays.reduce((sum, d) => (d.reportDate <= to ? sum + d.costTotal : sum), 0);
  const rows: TrendRow[] = buckets.map((b) => {
    const inBucket = daily.filter((r) => r.date >= b.from && r.date <= b.to);
    const s = sumRows(inBucket);
    return {
      key: b.key,
      from: b.from,
      to: b.to,
      reportCount: inBucket.length,
      labor: s.labor,
      fuel: s.fuel,
      lease: s.lease,
      cash: s.cash,
      credit: s.credit,
      cost: s.cost,
      output: s.output,
      cumulativeCost: cumulativeCostTo(b.to),
      progress: hasContract ? inBucket[inBucket.length - 1].progress : null,
    };
  });

  const s = sumRows(daily);
  const lastRow = rows[rows.length - 1];
  return {
    unit: period.kind === 'month' ? 'week' : 'month',
    rows,
    total: {
      reportCount: daily.length,
      labor: s.labor,
      fuel: s.fuel,
      lease: s.lease,
      cash: s.cash,
      credit: s.credit,
      cost: s.cost,
      output: s.output,
      cumulativeCost: lastRow?.cumulativeCost ?? 0,
      progress: lastRow?.progress ?? null,
    },
  };
}

// ─── ④ 作業員別累計 ───

function buildWorkers(input: CostReportInput, allReports: ReportWithLines[], workerPeriod: Period): WorkerSection {
  const workerNames = Object.fromEntries(input.workers.map((w) => [w.id, w.name]));
  const tradeById = new Map(input.workers.map((w) => [w.id, w.trade]));
  const cumulative = workerCumulative(laborEntries(allReports), input.carryovers, workerNames, workerPeriod);

  // 出勤日数・残業 H も workerCumulative の行から（同じ規則：to まで・繰越の基準日より前は除く）。
  const rows: WorkerRow[] = cumulative.map((c) => ({
    workerId: c.workerId,
    workerName: c.workerName,
    manual: c.workerId === null,
    trade: c.workerId === null ? null : (tradeById.get(c.workerId) ?? null),
    workDays: c.workDays,
    carryManDays: c.carryManDays,
    carryCost: c.carryCost,
    periodManDays: c.manDays,
    periodCost: c.cost,
    manDays: c.totalManDays,
    overtimeHours: c.overtimeHours,
    cost: c.totalCost,
  }));

  const total = { workDays: 0, manDays: 0, overtimeHours: 0, cost: 0 };
  for (const r of rows) {
    total.workDays += r.workDays;
    total.manDays = round2(total.manDays + r.manDays);
    total.overtimeHours = round2(total.overtimeHours + r.overtimeHours);
    total.cost += r.cost;
  }
  return { rows, total };
}

// ─── ⑤ 取引先別 ───

function buildVendors(input: CostReportInput, periodReports: ReportWithLines[]): VendorSection {
  const nameById = new Map(input.suppliers.map((s) => [s.id, s.name]));
  // 参照の無い名前は、マスターに同じ名前が 1 件だけあるときそのマスターとみなす（購入先は常に手入力のため）。
  const nameCount = new Map<string, number>();
  for (const s of input.suppliers) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
  const idByUniqueName = new Map(input.suppliers.filter((s) => nameCount.get(s.name) === 1).map((s) => [s.name, s.id]));

  const map = new Map<string, VendorRow>();
  for (const r of periodReports) {
    for (const l of r.lines) {
      if (l.kind !== 'cash' && l.kind !== 'credit') continue;
      const refId = l.kind === 'credit' ? l.supplierId : null;
      const name = (refId !== null ? nameById.get(refId) : undefined) ?? l.vendor.trim();
      let row = map.get(name);
      if (!row) {
        row = { name, supplierId: null, manual: false, cash: 0, credit: 0, total: 0 };
        map.set(name, row);
      }
      if (refId !== null && row.supplierId === null) row.supplierId = refId;
      if (l.kind === 'cash') row.cash += l.stored.amount;
      else row.credit += l.stored.amount;
      row.total += l.stored.amount;
    }
  }

  const rows = [...map.values()];
  for (const row of rows) {
    if (row.supplierId === null) row.supplierId = idByUniqueName.get(row.name) ?? null;
    row.manual = row.supplierId === null && row.name !== '';
  }
  // 金額の大きい順。未記入（''）は最後。
  rows.sort((a, b) => {
    if ((a.name === '') !== (b.name === '')) return a.name === '' ? 1 : -1;
    return b.total - a.total || a.name.localeCompare(b.name, 'ja');
  });
  const total = { cash: 0, credit: 0, total: 0 };
  for (const row of rows) {
    total.cash += row.cash;
    total.credit += row.credit;
    total.total += row.total;
  }
  return { rows, total };
}

// ─── ⑥ 車両・リース ───

/**
 * 数量の合計（⑥ リース・⑦ 工種別）。数量が入っている行（qty が null でない）だけを数える。
 * それらの単位の文字列がすべて同じなら合計とその単位（'' は単位なしとして null）、違えば数量・単位とも null。
 * 数量が入っている行が無ければ数量・単位とも null。'' と 'm2' は別の単位として扱う。
 */
class QtyByUnit {
  private qty = 0;
  private count = 0;
  private units = new Set<string>();
  add(qty: number | null, unit: string): void {
    if (qty === null) return;
    this.qty += qty;
    this.count += 1;
    this.units.add(unit);
  }
  result(): { qty: number | null; unit: string | null } {
    if (this.count === 0 || this.units.size > 1) return { qty: null, unit: null };
    const unit = [...this.units][0];
    return { qty: this.qty, unit: unit === '' ? null : unit };
  }
}

function buildEquipment(input: CostReportInput, periodReports: ReportWithLines[]): EquipmentSection {
  const vehicleNames = new Map(input.vehicles.map((v) => [v.id, v.name]));
  const leaseNames = new Map(input.leaseItems.map((i) => [i.id, i.name]));
  const vehicles = new Map<string, VehicleRow>();
  const leases = new Map<string, { row: LeaseRow; qty: QtyByUnit }>();

  for (const r of periodReports) {
    for (const l of r.lines) {
      if (l.kind === 'fuel') {
        const key = l.vehicleId !== null ? `id:${l.vehicleId}` : `name:${l.vehicleName}`;
        let row = vehicles.get(key);
        if (!row) {
          const name = (l.vehicleId !== null ? vehicleNames.get(l.vehicleId) : undefined) ?? l.vehicleName;
          row = { vehicleId: l.vehicleId, name, manual: l.vehicleId === null, distanceKm: 0, fuelCost: 0 };
          vehicles.set(key, row);
        }
        row.distanceKm += l.distanceKm ?? 0;
        row.fuelCost += l.stored.amount;
      } else if (l.kind === 'lease') {
        const key = l.itemId !== null ? `id:${l.itemId}` : `name:${l.itemName}`;
        let v = leases.get(key);
        if (!v) {
          const name = (l.itemId !== null ? leaseNames.get(l.itemId) : undefined) ?? l.itemName;
          v = { row: { itemId: l.itemId, name, manual: l.itemId === null, qty: null, unit: null, leaseCost: 0 }, qty: new QtyByUnit() };
          leases.set(key, v);
        }
        v.qty.add(l.qty, l.unit);
        v.row.leaseCost += l.stored.amount;
      }
    }
  }

  const leaseRows = [...leases.values()].map(({ row, qty }) => ({ ...row, ...qty.result() }));
  const vehicleRows = [...vehicles.values()];
  return {
    vehicles: vehicleRows,
    leases: leaseRows,
    total: {
      distanceKm: vehicleRows.reduce((s, v) => s + v.distanceKm, 0),
      fuelCost: vehicleRows.reduce((s, v) => s + v.fuelCost, 0),
      leaseCost: leaseRows.reduce((s, v) => s + v.leaseCost, 0),
    },
  };
}

// ─── ⑦ 工種別出来高 ───

function buildTrades(periodReports: ReportWithLines[]): TradeSection {
  const map = new Map<string, { manDays: number; output: number; qty: QtyByUnit; descriptions: Map<string, number> }>();
  for (const r of periodReports) {
    for (const l of r.lines) {
      if (l.kind !== 'work') continue;
      const trade = l.trade.trim();
      let v = map.get(trade);
      if (!v) {
        v = { manDays: 0, output: 0, qty: new QtyByUnit(), descriptions: new Map() };
        map.set(trade, v);
      }
      v.manDays = round2(v.manDays + l.stored.manDays);
      v.output += l.stored.amount;
      v.qty.add(l.qty, l.unit);
      const desc = l.description.trim();
      if (desc !== '') v.descriptions.set(desc, (v.descriptions.get(desc) ?? 0) + 1);
    }
  }

  const totalOutput = [...map.values()].reduce((s, v) => s + v.output, 0);
  // 出てきた順。工種なし（''）は最後。
  const entries = [...map.entries()].sort(([a], [b]) => Number(a === '') - Number(b === ''));
  const rows: TradeRow[] = entries.map(([trade, v]) => {
    let mainDescription = '';
    let best = 0;
    for (const [desc, n] of v.descriptions) {
      if (n > best) {
        best = n;
        mainDescription = desc;
      }
    }
    const { qty, unit } = v.qty.result();
    return {
      trade,
      mainDescription,
      qty,
      unit,
      manDays: v.manDays,
      productivity: qty === null || v.manDays === 0 ? null : qty / v.manDays,
      output: v.output,
      share: totalOutput === 0 ? 0 : v.output / totalOutput,
    };
  });
  return { rows, total: { manDays: round2(rows.reduce((s, r) => s + r.manDays, 0)), output: totalOutput } };
}

// ─── 本体 ───

export function buildCostReport(input: CostReportInput, period: CostReportPeriod, now: CostReportNow): CostReportModel {
  const contractTotal = input.site.contractAmount;
  const allReports = [...input.reports].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const periodEnd = period.kind === 'month' ? monthEnd(period.month) : null;
  const inPeriod = (date: string) => period.kind === 'all' || monthKey(date) === period.month;
  const periodReports = allReports.filter((r) => inPeriod(r.reportDate));
  const cumulativeReports = periodEnd === null ? allReports : allReports.filter((r) => r.reportDate <= periodEnd);

  const allDays = allReports.map(toDayTotals);
  const periodDays = allDays.filter((d) => inPeriod(d.reportDate));
  const cumulativeDays = periodEnd === null ? allDays : allDays.filter((d) => d.reportDate <= periodEnd);
  const periodMonths = [...new Set(periodDays.map((d) => monthKey(d.reportDate)))];

  const header = buildHeader(input, allReports, periodReports, period, now);
  const c = costSummary(periodDays, contractTotal);
  const workerPeriod: Period = period.kind === 'month' ? { from: `${period.month}-01`, to: periodEnd } : { from: null, to: null };

  return {
    isEmpty: periodReports.length === 0,
    header,
    costs: { labor: c.labor, fuel: c.fuel, lease: c.lease, cash: c.cash, credit: c.credit, total: c.cost, shares: c.shares },
    profit: buildProfit(cumulativeReports, cumulativeDays, contractTotal),
    trend: buildTrend(allDays, period, periodMonths, contractTotal),
    workers: buildWorkers(input, allReports, workerPeriod),
    vendors: buildVendors(input, periodReports),
    equipment: buildEquipment(input, periodReports),
    trades: buildTrades(periodReports),
    signature: { createdBy: now.by, checkedBy: null, approvedBy: null },
    footer: { reportCount: header.reportCount, approvedCount: header.approvedCount, outputDate: now.date, outputAt: header.outputAt },
  };
}
