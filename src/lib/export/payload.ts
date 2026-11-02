import { workerCumulative } from '@/lib/calc/aggregate';
import { rateAt } from '@/lib/calc/rates';
import { visitNumbers } from '@/lib/calc/visit';
import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type {
  ExportDay,
  ExportInput,
  ExportLaborRow,
  ExportLeaseRow,
  ExportPayload,
  ExportPurchaseRow,
  ExportReport,
  ExportResult,
  ExportWarning,
  ExportWarningCode,
  ExportWorker,
} from '@/lib/export/types';
import type { LaborLine, LeaseLine, ReportLine, TimeSpec } from '@/lib/types';

// Excel 出力用の payload を組み立てる（純関数。Supabase に依存しない）。
// 形は python/tests/fixtures/payload_days.json が正。上限を超えるときも payload は作り、warnings で知らせる
// （Route 側で止めるかどうかを決める）。

// 雛形 V34 の上限（python/genba_export/layout.py と同じ）。
const MASTER_LIMITS = { workers: 30, suppliers: 30, vehicles: 20, leaseItems: 20 } as const;
const MAX_DAYS = 31;
/** 日報シートの明細行数。2回目だけ作業内容が 8 行。 */
const TABLE_ROWS = { labor: 10, fuel: 3, lease: 6, cash: 6, credit: 6, work: 6 } as const;
const TABLE_LABELS: Record<keyof typeof TABLE_ROWS, string> = {
  labor: '作業員', fuel: '車両', lease: 'リース', cash: '現金購入', credit: '買掛購入', work: '作業内容',
};

function tableRows(index: number, key: keyof typeof TABLE_ROWS): number {
  return index === 2 && key === 'work' ? 8 : TABLE_ROWS[key];
}

// 浮動小数の誤差（20330.000000000004 など）を落とす。
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
/** 空文字・空白だけは null（Python 側で空欄になる）。 */
function text(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v.trim() === '' ? null : v;
}
function jpDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

// ─── ファイル名 ───

const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

/** `現場名_YYYY年MM月.xlsm`。禁止文字（/ \ : * ? " < > |）と制御文字は _、前後の空白は除き、空なら「現場」。 */
export function exportFileName(siteName: string, month: string): string {
  const name = siteName.trim().replace(FORBIDDEN, '_').trim() || '現場';
  const [y, m] = month.split('-');
  return `${name}_${y}年${m.padStart(2, '0')}月.xlsm`;
}

// ─── マスターの選び方 ───

/**
 * 現場で選択した順 → 未選択だがその月に使ったものを名前順で末尾。
 * マスターに無い id（削除済みなど）は飛ばす。
 */
function pickMasters<T extends { id: string; name: string }>(all: T[], selectedIds: string[], usedIds: Iterable<string>): T[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const m = byId.get(id);
    if (m && !seen.has(id)) {
      out.push(m);
      seen.add(id);
    }
  }
  const extra: T[] = [];
  for (const id of usedIds) {
    const m = byId.get(id);
    if (m && !seen.has(id)) {
      extra.push(m);
      seen.add(id);
    }
  }
  extra.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return [...out, ...extra];
}

function linesOf<K extends ReportLine['kind']>(reports: ExportReport[], kind: K): Extract<ReportLine, { kind: K }>[] {
  const out: Extract<ReportLine, { kind: K }>[] = [];
  for (const r of reports) for (const l of r.lines) if (l.kind === kind) out.push(l as Extract<ReportLine, { kind: K }>);
  return out;
}

function nonNull(ids: (string | null)[]): string[] {
  return ids.filter((id): id is string => id !== null);
}

/**
 * 明細の単価の「雛形のマスター値」。雛形は名前で VLOOKUP するので、参照先（id）→ 同じ名前の出力対象 → 行の保存値 の順に探す。
 * 参照も同名も無い手入力行は保存値（＝上書きしない）。
 */
function masterRate<T extends { id: string; name: string }>(
  refId: string | null,
  name: string,
  picked: T[],
  rateOf: (m: T) => number | null,
  own: number | null,
): number | null {
  const m = (refId !== null ? picked.find((x) => x.id === refId) : undefined) ?? picked.find((x) => x.name === name);
  return m ? rateOf(m) : own;
}

// ─── 明細 ───

/** 時間が無く休憩・中抜だけある行は、共通の開始・終了を入れる（雛形は C・D が空だと共通実働を使うため）。 */
function laborTime(t: TimeSpec, common: TimeSpec): { start: string | null; end: string | null } {
  if (t.start === null && t.end === null && (t.breakMin !== null || t.gapMin !== null)) {
    return { start: common.start, end: common.end };
  }
  return { start: t.start, end: t.end };
}

function laborRow(l: LaborLine, common: TimeSpec, workers: Worker[], rateOf: (w: Worker) => number | null): ExportLaborRow {
  const { start, end } = laborTime(l.time, common);
  return {
    name: l.workerName,
    start,
    end,
    break_min: l.time.breakMin,
    gap_min: l.time.gapMin,
    note: text(l.note),
    daily_rate: l.dailyRate,
    master_daily_rate: masterRate(l.workerId, l.workerName, workers, rateOf, l.dailyRate),
  };
}

function leaseRow(l: LeaseLine, items: LeaseItem[], rateOf: (m: LeaseItem) => number | null): ExportLeaseRow {
  return {
    name: l.itemName,
    spec: text(l.spec),
    unit: text(l.unit),
    qty: l.qty,
    note: text(l.note),
    unit_price: l.unitPrice,
    master_unit_price: masterRate(l.itemId, l.itemName, items, rateOf, l.unitPrice),
  };
}

function purchaseRow(l: { itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string }): ExportPurchaseRow {
  return { name: l.itemName, spec: text(l.spec), unit: text(l.unit), qty: l.qty, unit_price: l.unitPrice, vendor: text(l.vendor) };
}

// ─── 入口 ───

export function buildExportPayload(input: ExportInput): ExportResult {
  const warnings: ExportWarning[] = [];
  const warn = (code: ExportWarningCode, message: string, date?: string) =>
    warnings.push(date === undefined ? { code, message } : { code, message, date });

  const reports = [...input.reports].sort((a, b) => a.date.localeCompare(b.date));
  // マスターの日当・リース単価は、その月の最初の日報の日付時点（日報が無ければ月初）。
  const rateDate = reports[0]?.date ?? `${input.month}-01`;
  const workerRate = (w: Worker) => rateAt(w.rates, rateDate);
  const leaseRate = (m: LeaseItem) => rateAt(m.rates, rateDate);

  // マスター（選択順 → その月に使った未選択を名前順）
  const workers = pickMasters(input.workers, input.selected.workerIds, nonNull(linesOf(reports, 'labor').map((l) => l.workerId)));
  const suppliers = pickMasters<Supplier>(input.suppliers, input.selected.supplierIds, nonNull(linesOf(reports, 'credit').map((l) => l.supplierId)));
  const vehicles = pickMasters<Vehicle>(input.vehicles, input.selected.vehicleIds, nonNull(linesOf(reports, 'fuel').map((l) => l.vehicleId)));
  const leaseItems = pickMasters(input.leaseItems, input.selected.leaseItemIds, nonNull(linesOf(reports, 'lease').map((l) => l.itemId)));

  if (workers.length > MASTER_LIMITS.workers)
    warn('too_many_workers', `作業員が ${workers.length} 人います。雛形に書けるのは ${MASTER_LIMITS.workers} 人までです`);
  if (suppliers.length > MASTER_LIMITS.suppliers)
    warn('too_many_suppliers', `取引先が ${suppliers.length} 件あります。雛形に書けるのは ${MASTER_LIMITS.suppliers} 件までです`);
  if (vehicles.length > MASTER_LIMITS.vehicles)
    warn('too_many_vehicles', `車両が ${vehicles.length} 台あります。雛形に書けるのは ${MASTER_LIMITS.vehicles} 台までです`);
  if (leaseItems.length > MASTER_LIMITS.leaseItems)
    warn('too_many_lease_items', `リース品が ${leaseItems.length} 件あります。雛形に書けるのは ${MASTER_LIMITS.leaseItems} 件までです`);
  if (reports.length > MAX_DAYS)
    warn('too_many_days', `この月の日報が ${reports.length} 件あります。雛形に書けるのは ${MAX_DAYS} 件までです`);

  // 前月繰越：workerCumulative と同じ規則（繰越の基準日より前の日報は初期値に含まれているとみなして除く）。
  const [y, m] = input.month.split('-').map(Number);
  const monthStart = `${input.month}-01`;
  const monthEnd = `${input.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const names: Record<string, string> = {};
  for (const w of input.workers) names[w.id] = w.name;
  const cumulative = workerCumulative(input.laborEntries, input.carryovers, names, { from: monthStart, to: monthEnd });

  const exportWorkers: ExportWorker[] = workers.map((w) => {
    // 雛形は名前で集計するので、参照の無い手入力行のうち同じ名前のものもこの作業員に入れる。
    const rows = cumulative.filter((r) => r.workerId === w.id || (r.workerId === null && r.workerName === w.name));
    return {
      name: w.name,
      trade: w.trade,
      daily_rate: workerRate(w),
      overtime_rate: w.overtimeRate,
      note: w.note,
      carry_man_days: round2(rows.reduce((s, r) => s + r.carryManDays, 0)),
      carry_cost: clean(rows.reduce((s, r) => s + r.carryCost, 0)),
    };
  });

  // 通算回目・累計原価は現場の全日報から。
  const siteReports = [...input.siteReports].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const allDates = siteReports.map((r) => r.reportDate);
  const cumulativeCost = (date: string) => clean(siteReports.reduce((s, r) => (r.reportDate <= date ? s + r.costTotal : s), 0));

  // 名前がマスター（出力対象）に無い行：雛形の VLOOKUP が外れる。同じ名前は最初の日に 1 回だけ知らせる。
  const known = {
    labor: new Set(workers.map((w) => w.name)),
    fuel: new Set(vehicles.map((v) => v.name)),
    lease: new Set(leaseItems.map((l) => l.name)),
  };
  const nameLabels = {
    labor: ['作業員名', '日当'],
    fuel: ['車両名', '燃費'],
    lease: ['リース品名', '単価'],
  } as const;
  const warnedNames = new Set<string>();
  const checkName = (kind: keyof typeof known, name: string, date: string) => {
    if (name.trim() === '' || known[kind].has(name) || warnedNames.has(`${kind}:${name}`)) return;
    warnedNames.add(`${kind}:${name}`);
    const [label, what] = nameLabels[kind];
    warn('name_not_in_master', `${label}『${name}』がマスターに無いため、Excel の${what}が引けません`, date);
  };

  const days: ExportDay[] = reports.map((r, i) => {
    const index = i + 1;
    const labor = r.lines.filter((l): l is LaborLine => l.kind === 'labor');
    const fuel = r.lines.filter((l) => l.kind === 'fuel');
    const lease = r.lines.filter((l): l is LeaseLine => l.kind === 'lease');
    const cash = r.lines.filter((l) => l.kind === 'cash');
    const credit = r.lines.filter((l) => l.kind === 'credit');
    const work = r.lines.filter((l) => l.kind === 'work');

    const counts = { labor: labor.length, fuel: fuel.length, lease: lease.length, cash: cash.length, credit: credit.length, work: work.length };
    for (const key of Object.keys(TABLE_ROWS) as (keyof typeof TABLE_ROWS)[]) {
      const max = tableRows(index, key);
      if (counts[key] > max)
        warn('rows_overflow', `${jpDateLabel(r.date)} の${TABLE_LABELS[key]}が${counts[key]}行で、雛形の${max}行を超えています`, r.date);
    }
    for (const l of labor) checkName('labor', l.workerName, r.date);
    for (const l of fuel) checkName('fuel', l.vehicleName, r.date);
    for (const l of lease) checkName('lease', l.itemName, r.date);

    const approved = r.status === 'approved';
    return {
      index,
      date: r.date,
      total_index: visitNumbers(allDates, r.date).totalIndex,
      weather: text(r.weather),
      supervisor: text(r.supervisor),
      common: { start: r.common.start, end: r.common.end, break_min: r.common.breakMin, gap_min: r.common.gapMin },
      labor: labor.map((l) => laborRow(l, r.common, workers, workerRate)),
      fuel: fuel.map((l) => ({ name: l.vehicleName, distance_km: l.distanceKm, price_per_l: l.pricePerL, note: text(l.note) })),
      lease: lease.map((l) => leaseRow(l, leaseItems, leaseRate)),
      cash: cash.map(purchaseRow),
      credit: credit.map(purchaseRow),
      work: work.map((l) => ({
        trade: text(l.trade), description: text(l.description), qty: l.qty, unit: text(l.unit), man_days: l.manDays, unit_price: l.unitPrice,
      })),
      cumulative_cost: cumulativeCost(r.date),
      output_total: r.outputTotal,
      issues_text: text(r.issuesText),
      issues: r.issues.filter((b) => b.trim() !== ''),
      notes_text: text(r.notesText),
      created_by: text(r.createdByName),
      reviewed_by: text(r.reviewedByName),
      approved_by: approved ? text(r.approvedByName) : null,
      approved_at: approved ? r.approvedAt : null,
    };
  });

  const s = input.site;
  const payload: ExportPayload = {
    file_name: exportFileName(s.name, input.month),
    site: {
      name: s.name,
      client_name: s.clientName,
      project_name: s.projectName,
      project_no: s.projectNo,
      overview: s.overview,
      contract_amount: s.contractAmount,
      start_date: s.startDate,
      end_date: s.endDate,
      contract_type: s.contractType,
    },
    settings: {
      shotei_hours: input.rule.shoteiHours,
      fixed_overtime_limit: input.rule.fixedOvertimeLimit,
      overtime_multiplier: input.rule.overtimeMultiplier,
      overtime_base_hours: input.rule.overtimeBaseHours,
    },
    workers: exportWorkers,
    suppliers: suppliers.map((p) => ({ name: p.name, category: p.category, contact: p.contact, note: p.note })),
    vehicles: vehicles.map((v) => ({ name: v.name, kind: v.kind, km_per_l: v.kmPerL, note: v.note })),
    lease_items: leaseItems.map((l) => ({ name: l.name, spec: l.spec, unit_price: leaseRate(l), note: l.note })),
    days,
  };
  return { payload, warnings };
}
