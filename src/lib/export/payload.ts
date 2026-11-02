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
 * 現場で選択した順 → 以降の各グループ（その月に使った未選択、繰越だけの未選択 …）をグループごとに名前順で末尾へ。
 * マスターに無い id（削除済みなど）は飛ばす。
 */
function pickMasters<T extends { id: string; name: string }>(all: T[], selectedIds: string[], ...groups: Iterable<string>[]): T[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: T[] = [];
  const seen = new Set<string>();
  const take = (ids: Iterable<string>): T[] => {
    const got: T[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      if (m && !seen.has(id)) {
        got.push(m);
        seen.add(id);
      }
    }
    return got;
  };
  out.push(...take(selectedIds));
  for (const g of groups) out.push(...take(g).sort((a, b) => a.name.localeCompare(b.name, 'ja')));
  return out;
}

/** 名前（前後空白を除く）→ id。同じ名前が 2 件以上あるものは入れない（どちらか決められないため）。 */
function uniqueIdByName<T extends { id: string; name: string }>(all: T[]): Map<string, string> {
  const ids = new Map<string, string | null>();
  for (const m of all) {
    const key = m.name.trim();
    ids.set(key, ids.has(key) ? null : m.id);
  }
  const out = new Map<string, string>();
  for (const [k, id] of ids) if (id !== null) out.set(k, id);
  return out;
}

/** 出力対象の中で 2 件以上ある名前（前後空白を除く）と件数。 */
function duplicateNames(items: { name: string }[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const m of items) count.set(m.name.trim(), (count.get(m.name.trim()) ?? 0) + 1);
  return new Map([...count].filter(([, n]) => n >= 2));
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
 * 明細の単価の「雛形のマスター値」＝ 雛形の VLOOKUP（名前の完全一致）が実際に引く値。
 * 出力対象に無い名前（VLOOKUP は 0）と、同じ名前が 2 件以上ある名前（先頭が引かれる）は null にする。
 * null なら Python は保存値を必ず書くので、各行の金額は保存値と一致する。
 */
function masterRate<T extends { name: string }>(name: string, picked: T[], duplicates: Map<string, number>, rateOf: (m: T) => number | null): number | null {
  const key = name.trim();
  if (duplicates.has(key)) return null;
  const m = picked.find((x) => x.name.trim() === key);
  return m ? rateOf(m) : null;
}

// ─── 明細 ───

/** 時間が無く休憩・中抜だけある行は、共通の開始・終了を入れる（雛形は C・D が空だと共通実働を使うため）。 */
function laborTime(t: TimeSpec, common: TimeSpec): { start: string | null; end: string | null } {
  if (t.start === null && t.end === null && (t.breakMin !== null || t.gapMin !== null)) {
    return { start: common.start, end: common.end };
  }
  return { start: t.start, end: t.end };
}

function laborRow(l: LaborLine, common: TimeSpec, workers: Worker[], duplicates: Map<string, number>, rateOf: (w: Worker) => number | null): ExportLaborRow {
  const { start, end } = laborTime(l.time, common);
  return {
    name: l.workerName,
    start,
    end,
    break_min: l.time.breakMin,
    gap_min: l.time.gapMin,
    note: text(l.note),
    daily_rate: l.dailyRate,
    master_daily_rate: masterRate(l.workerName, workers, duplicates, rateOf),
  };
}

function leaseRow(l: LeaseLine, items: LeaseItem[], duplicates: Map<string, number>, rateOf: (m: LeaseItem) => number | null): ExportLeaseRow {
  return {
    name: l.itemName,
    spec: text(l.spec),
    unit: text(l.unit),
    qty: l.qty,
    note: text(l.note),
    unit_price: l.unitPrice,
    master_unit_price: masterRate(l.itemName, items, duplicates, rateOf),
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

  // 参照の無い手入力行は、名前（前後空白を除く）が 1 件だけ一致するマスターのものとみなす（雛形は名前で引くため）。
  const workerIdByName = uniqueIdByName(input.workers);
  const leaseIdByName = uniqueIdByName(input.leaseItems);
  const workerIdOf = (id: string | null, name: string) => id ?? workerIdByName.get(name.trim()) ?? null;
  const leaseIdOf = (id: string | null, name: string) => id ?? leaseIdByName.get(name.trim()) ?? null;

  // 前月繰越：workerCumulative と同じ規則（繰越の基準日より前の日報は初期値に含まれているとみなして除く）。
  // 名前だけの行も上の規則で作業員に寄せてから数える（寄せた作業員の基準日より前の分も除かれる）。
  const [y, m] = input.month.split('-').map(Number);
  const monthStart = `${input.month}-01`;
  const monthEnd = `${input.month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const names: Record<string, string> = {};
  for (const w of input.workers) names[w.id] = w.name;
  const entries = input.laborEntries.map((e) => ({ ...e, workerId: workerIdOf(e.workerId, e.workerName) }));
  const cumulative = workerCumulative(entries, input.carryovers, names, { from: monthStart, to: monthEnd });
  const hasCarry = (r: { carryManDays: number; carryCost: number }) => r.carryManDays !== 0 || r.carryCost !== 0;

  // マスター（選択順 → その月に使った未選択を名前順 → 繰越だけの未選択を名前順）
  const workers = pickMasters(
    input.workers,
    input.selected.workerIds,
    nonNull(linesOf(reports, 'labor').map((l) => workerIdOf(l.workerId, l.workerName))),
    nonNull(cumulative.filter(hasCarry).map((r) => r.workerId)),
  );
  const suppliers = pickMasters<Supplier>(input.suppliers, input.selected.supplierIds, nonNull(linesOf(reports, 'credit').map((l) => l.supplierId)));
  const vehicles = pickMasters<Vehicle>(input.vehicles, input.selected.vehicleIds, nonNull(linesOf(reports, 'fuel').map((l) => l.vehicleId)));
  const leaseItems = pickMasters(input.leaseItems, input.selected.leaseItemIds, nonNull(linesOf(reports, 'lease').map((l) => leaseIdOf(l.itemId, l.itemName))));

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

  // 同じ名前が出力対象に 2 件以上：雛形は先頭の行の値を引くので、その名前の明細は master を null にして保存値を書かせる。
  const dupWorkers = duplicateNames(workers);
  const dupLease = duplicateNames(leaseItems);
  // 寄せ先が決まらなかった名前だけの繰越（マスターに同名が 2 件以上）。出力対象に 1 件だけならそこへ足す。
  const nameOnlyCarry = cumulative.filter((r) => r.workerId === null && hasCarry(r));
  for (const [name, n] of dupWorkers) {
    const dropped = nameOnlyCarry.some((r) => r.workerName.trim() === name);
    warn('duplicate_name', `作業員名『${name}』が ${n} 件あります。Excel では先頭の行の日当が使われます${dropped ? '（名前だけの前月繰越は入れていません）' : ''}`);
  }
  for (const [name, n] of dupLease) warn('duplicate_name', `リース品名『${name}』が ${n} 件あります。Excel では先頭の行の単価が使われます`);

  const exportWorkers: ExportWorker[] = workers.map((w) => {
    const key = w.name.trim();
    const rows = [
      ...cumulative.filter((r) => r.workerId === w.id),
      ...(dupWorkers.has(key) ? [] : nameOnlyCarry.filter((r) => r.workerName.trim() === key)),
    ];
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
    labor: new Set(workers.map((w) => w.name.trim())),
    fuel: new Set(vehicles.map((v) => v.name.trim())),
    lease: new Set(leaseItems.map((l) => l.name.trim())),
  };
  const nameMessages = {
    labor: (n: string) => `作業員名『${n}』がマスターに無いため、日当は日報の保存値を書きます`,
    fuel: (n: string) => `車両名『${n}』がマスターに無いため、Excel の燃費が引けません`,
    lease: (n: string) => `リース品名『${n}』がマスターに無いため、単価は日報の保存値を書きます`,
  };
  const warnedNames = new Set<string>();
  const checkName = (kind: keyof typeof known, name: string, date: string) => {
    const key = name.trim();
    if (key === '' || known[kind].has(key) || warnedNames.has(`${kind}:${key}`)) return;
    warnedNames.add(`${kind}:${key}`);
    warn('name_not_in_master', nameMessages[kind](key), date);
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
      labor: labor.map((l) => laborRow(l, r.common, workers, dupWorkers, workerRate)),
      fuel: fuel.map((l) => ({ name: l.vehicleName, distance_km: l.distanceKm, price_per_l: l.pricePerL, note: text(l.note) })),
      lease: lease.map((l) => leaseRow(l, leaseItems, dupLease, leaseRate)),
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
