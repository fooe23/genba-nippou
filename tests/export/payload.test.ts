import { describe, it, expect } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildExportPayload, exportFileName } from '@/lib/export/payload';
import type { ExportInput, ExportReport } from '@/lib/export/types';
import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { Site } from '@/lib/db/sites';
import type { LaborLine, LeaseLine, ReportLine, TimeSpec, WorkLine } from '@/lib/types';

// ─── 入力を手で作る補助 ───

const T = { updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' };
const worker = (id: string, name: string, rates: [number, string][] = [[18000, '2026-01-01']], o: Partial<Worker> = {}): Worker => ({
  id, name, trade: '大工', note: null, active: true, rates: rates.map(([amount, effectiveFrom]) => ({ amount, effectiveFrom })), overtimeRate: null, affiliation: 'own', supplierId: null, ...T, ...o,
});
const supplier = (id: string, name: string): Supplier => ({ id, name, category: '材料', contact: null, note: null, active: true, ...T });
const vehicle = (id: string, name: string): Vehicle => ({ id, name, kind: 'バン', kmPerL: 8.5, note: null, active: true, ...T });
const leaseItem = (id: string, name: string, rates: [number, string][] = [[3000, '2026-01-01']]): LeaseItem => ({
  id, name, spec: '2.8kVA', note: null, active: true, rates: rates.map(([amount, effectiveFrom]) => ({ amount, effectiveFrom })), ...T,
});

const NO_TIME: TimeSpec = { start: null, end: null, breakMin: null, gapMin: null };
const labor = (workerId: string | null, workerName: string, o: Partial<LaborLine> = {}): LaborLine => ({
  kind: 'labor', workerId, workerName, time: { ...NO_TIME }, dailyRate: 18000, note: '', overtimeRate: null, ...o,
});
const lease = (itemId: string | null, itemName: string, unitPrice: number): LeaseLine => ({
  kind: 'lease', itemId, itemName, spec: '2.8kVA', unit: '日', qty: 1, unitPrice, note: '',
});

const SITE: Site = {
  id: 's1', name: '検証現場', clientName: '検証客先', projectName: '検証工事', projectNo: 'K-001', overview: '概要',
  contractAmount: 12000000, startDate: '2026-10-01', endDate: '2027-03-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null,
};

const report = (date: string, lines: ReportLine[] = [], o: Partial<ExportReport> = {}): ExportReport => ({
  id: `r-${date}`, date, status: 'draft', weather: '晴れ', supervisor: '検証太郎',
  common: { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 },
  outputTotal: 0, costTotal: 0, issuesText: null, notesText: null, lines, issues: [],
  createdByName: '検証太郎', reviewedByName: null, approvedByName: null, approvedAt: null, ...o,
});

function input(o: Partial<ExportInput> = {}): ExportInput {
  const reports = o.reports ?? [];
  return {
    month: '2026-11',
    site: SITE,
    rule: { shoteiHours: 7.5, fixedOvertimeLimit: 8, overtimeMultiplier: 1.25, overtimeBaseHours: 8 },
    selected: { workerIds: [], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    workers: [], suppliers: [], vehicles: [], leaseItems: [],
    reports,
    siteReports: o.siteReports ?? reports.map((r) => ({ reportDate: r.date, costTotal: r.costTotal })),
    laborEntries: [],
    carryovers: [],
    ...o,
  };
}

// ─── テスト ───

describe('buildExportPayload: 日報の並びと回目', () => {
  it('日付順に並べ、index は 1 から、total_index は現場の全日報での通算', () => {
    const reports = [report('2026-11-20'), report('2026-11-02'), report('2026-11-10')];
    const siteReports = [
      { reportDate: '2026-10-05', costTotal: 0 },
      { reportDate: '2026-10-20', costTotal: 0 },
      ...reports.map((r) => ({ reportDate: r.date, costTotal: 0 })),
      { reportDate: '2026-12-01', costTotal: 0 },
    ];
    const { payload } = buildExportPayload(input({ reports, siteReports }));
    expect(payload.days.map((d) => [d.index, d.date, d.total_index])).toEqual([
      [1, '2026-11-02', 3],
      [2, '2026-11-10', 4],
      [3, '2026-11-20', 5],
    ]);
  });

  it('日報 0 件の月は days: [] で、警告も出さない', () => {
    const { payload, warnings } = buildExportPayload(input({ workers: [worker('w1', '山田 太郎')], selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] } }));
    expect(payload.days).toEqual([]);
    expect(payload.workers.map((w) => w.name)).toEqual(['山田 太郎']);
    expect(warnings).toEqual([]);
    expect(payload.file_name).toBe('検証現場_2026年11月.xlsm');
  });

  it('現場情報と設定を snake_case で入れる', () => {
    const { payload } = buildExportPayload(input());
    expect(payload.site).toEqual({
      name: '検証現場', client_name: '検証客先', project_name: '検証工事', project_no: 'K-001', overview: '概要',
      contract_amount: 12000000, start_date: '2026-10-01', end_date: '2027-03-31', contract_type: '元請け',
    });
    expect(payload.settings).toEqual({ shotei_hours: 7.5, fixed_overtime_limit: 8, overtime_multiplier: 1.25, overtime_base_hours: 8 });
  });

  it('32 件以上なら too_many_days を返す（payload は作る）', () => {
    // 同じ現場で日付は一意なので実際には起きないが、念のため確かめる（日付は月をまたいでよい）
    const reports = Array.from({ length: 32 }, (_, i) => report(new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)));
    const { payload, warnings } = buildExportPayload(input({ reports }));
    expect(payload.days).toHaveLength(32);
    expect(warnings.map((w) => w.code)).toContain('too_many_days');
  });
});

describe('buildExportPayload: マスターの並びと上限', () => {
  it('現場で選択した順 → 未選択だがその月に使ったものを名前順で末尾。使っていない未選択は入れない', () => {
    const workers = [worker('w1', '佐藤'), worker('w2', '山田'), worker('w3', 'いとう'), worker('w4', 'あべ'), worker('w5', '未使用')];
    const reports = [
      report('2026-11-02', [labor('w3', 'いとう'), labor('w1', '佐藤')]),
      report('2026-11-03', [labor('w4', 'あべ'), labor('w3', 'いとう')]),
    ];
    const { payload, warnings } = buildExportPayload(input({
      workers, reports,
      selected: { workerIds: ['w2', 'w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    }));
    expect(payload.workers.map((w) => w.name)).toEqual(['山田', '佐藤', 'あべ', 'いとう']);
    expect(warnings).toEqual([]);
  });

  it('取引先・車両・リース品も同じ並び', () => {
    const reports = [report('2026-11-02', [
      { kind: 'fuel', vehicleId: 'v3', vehicleName: 'ハイエース', kmPerL: 8.5, distanceKm: 40, pricePerL: 170, note: '' },
      { kind: 'credit', itemName: '合板', spec: '12mm', unit: '枚', qty: 2, unitPrice: 1500, supplierId: 'p2', vendor: 'B建材' },
      lease('l2', '発電機', 3000),
    ])];
    const { payload } = buildExportPayload(input({
      reports,
      suppliers: [supplier('p1', 'A建材'), supplier('p2', 'B建材'), supplier('p3', 'C建材')],
      vehicles: [vehicle('v1', '軽トラ'), vehicle('v2', '2t'), vehicle('v3', 'ハイエース')],
      leaseItems: [leaseItem('l1', '足場'), leaseItem('l2', '発電機')],
      selected: { workerIds: [], supplierIds: ['p3', 'p1'], vehicleIds: ['v2'], leaseItemIds: ['l1'] },
    }));
    expect(payload.suppliers.map((s) => s.name)).toEqual(['C建材', 'A建材', 'B建材']);
    expect(payload.vehicles.map((v) => v.name)).toEqual(['2t', 'ハイエース']);
    expect(payload.vehicles[0]).toEqual({ name: '2t', kind: 'バン', km_per_l: 8.5, note: null });
    expect(payload.lease_items.map((l) => l.name)).toEqual(['足場', '発電機']);
    expect(payload.suppliers[0]).toEqual({ name: 'C建材', category: '材料', contact: null, note: null });
  });

  it('作業員が 31 人なら too_many_workers を返す（payload には全員入れる）', () => {
    const workers = Array.from({ length: 31 }, (_, i) => worker(`w${i}`, `作業員${String(i).padStart(2, '0')}`));
    const { payload, warnings } = buildExportPayload(input({
      workers, selected: { workerIds: workers.map((w) => w.id), supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    }));
    expect(payload.workers).toHaveLength(31);
    expect(warnings.map((w) => w.code)).toEqual(['too_many_workers']);
  });

  it('車両 21 台・リース 21 件・取引先 31 件もそれぞれ警告', () => {
    const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const { warnings } = buildExportPayload(input({
      suppliers: ids('p', 31).map((id) => supplier(id, id)),
      vehicles: ids('v', 21).map((id) => vehicle(id, id)),
      leaseItems: ids('l', 21).map((id) => leaseItem(id, id)),
      selected: { workerIds: [], supplierIds: ids('p', 31), vehicleIds: ids('v', 21), leaseItemIds: ids('l', 21) },
    }));
    expect(warnings.map((w) => w.code).sort()).toEqual(['too_many_lease_items', 'too_many_suppliers', 'too_many_vehicles']);
  });

  it('日報の名前がマスターに無ければ name_not_in_master（同じ名前は 1 回だけ）', () => {
    const reports = [
      report('2026-11-02', [labor('w1', '山田 太郎'), labor(null, '応援 一郎'), labor(null, '応援 一郎')]),
      report('2026-11-03', [labor(null, '応援 一郎'), lease(null, '投光器', 500)]),
    ];
    const { payload, warnings } = buildExportPayload(input({
      reports, workers: [worker('w1', '山田 太郎')],
      selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    }));
    expect(payload.days[0].labor.map((l) => l.name)).toEqual(['山田 太郎', '応援 一郎', '応援 一郎']);
    expect(warnings).toEqual([
      { code: 'name_not_in_master', message: '作業員名『応援 一郎』がマスターに無いため、日当は日報の保存値を書きます', date: '2026-11-02' },
      { code: 'name_not_in_master', message: 'リース品名『投光器』がマスターに無いため、単価は日報の保存値を書きます', date: '2026-11-03' },
    ]);
  });

  it('明細が雛形の行数を超える日は rows_overflow（2回目の作業内容だけ 8 行まで）', () => {
    const work = (n: number): ReportLine[] => Array.from({ length: n }, () => ({
      kind: 'work', estimateItemId: null, trade: '解体', description: '撤去', qty: 1, unit: 'm2', manDays: 1, unitPrice: 100, source: 'extra', ...EMPTY_WORK_CHANGE,
    }));
    const reports = [
      report('2026-11-01', [...work(6), ...Array.from({ length: 11 }, () => labor(null, 'X'))]),
      report('2026-11-02', work(8)),
      report('2026-11-03', work(7)),
    ];
    const workers = [worker('w1', 'X')];
    const { warnings } = buildExportPayload(input({ reports, workers, selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] } }));
    expect(warnings).toEqual([
      { code: 'rows_overflow', message: '2026年11月1日 の作業員が11行で、雛形の10行を超えています', date: '2026-11-01' },
      { code: 'rows_overflow', message: '2026年11月3日 の作業内容が7行で、雛形の6行を超えています', date: '2026-11-03' },
    ]);
  });

  it('作業内容の減の行は数量を負（単価は正）にし、施工内容の頭に【追加】【増】【変更】【減】を付ける（増の数量は正のまま）（雛形の J＝E×I と出来高を揃える）', () => {
    const w = (o: Partial<WorkLine>): WorkLine => ({
      kind: 'work', estimateItemId: null, trade: '内装', description: '石膏ボード', qty: 10, unit: 'm2', manDays: 1, unitPrice: 2000, source: 'extra',
      ...EMPTY_WORK_CHANGE, ...o,
    });
    const reports = [report('2026-11-02', [
      w({}),
      w({ changeKind: 'extra', description: '開口補強' }),
      w({ changeKind: 'increase', description: '石膏ボード 追加張り', qty: 3 }),
      w({ changeKind: 'change', description: '仕様変更' }),
      w({ changeKind: 'minus', description: '天井撤去取りやめ', qty: 5, unitPrice: 3000 }),
      w({ changeKind: 'minus', description: '', qty: null }),
    ], { outputTotal: 20000 + 20000 + 6000 + 20000 - 15000 })];
    const { payload } = buildExportPayload(input({ reports }));
    const rows = payload.days[0].work;
    expect(rows.map((r) => [r.description, r.qty, r.unit_price])).toEqual([
      ['石膏ボード', 10, 2000],
      ['【追加】開口補強', 10, 2000],
      ['【増】石膏ボード 追加張り', 3, 2000],
      ['【変更】仕様変更', 10, 2000],
      ['【減】天井撤去取りやめ', -5, 3000],
      ['【減】', null, 2000],
    ]);
    // 行の金額（E×I）の合計が、書き込む本日出来高（output_total。減は負で保存）と一致する
    const sum = rows.reduce((a, r) => a + (r.qty ?? 0) * (r.unit_price ?? 0), 0);
    expect(sum).toBe(payload.days[0].output_total);
  });
});

describe('buildExportPayload: 日当・リース単価', () => {
  it('マスターは月の最初の日報日付時点、行は保存値。月途中で変わった行は master と違う', () => {
    const w = worker('w1', '山田 太郎', [[16000, '2026-01-01'], [18000, '2026-11-02'], [20000, '2026-11-15']]);
    const l = leaseItem('l1', '発電機', [[3000, '2026-01-01'], [3500, '2026-11-10']]);
    const reports = [
      report('2026-11-20', [labor('w1', '山田 太郎', { dailyRate: 20000 }), lease('l1', '発電機', 3500)]),
      report('2026-11-05', [labor('w1', '山田 太郎', { dailyRate: 18000 }), lease('l1', '発電機', 3000)]),
    ];
    const { payload } = buildExportPayload(input({
      reports, workers: [w], leaseItems: [l],
      selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: ['l1'] },
    }));
    expect(payload.workers[0].daily_rate).toBe(18000); // 11/05 時点
    expect(payload.lease_items[0].unit_price).toBe(3000);
    const [d1, d2] = payload.days;
    expect([d1.labor[0].daily_rate, d1.labor[0].master_daily_rate]).toEqual([18000, 18000]);
    expect([d2.labor[0].daily_rate, d2.labor[0].master_daily_rate]).toEqual([20000, 18000]);
    expect([d1.lease[0].unit_price, d1.lease[0].master_unit_price]).toEqual([3000, 3000]);
    expect([d2.lease[0].unit_price, d2.lease[0].master_unit_price]).toEqual([3500, 3000]);
  });

  it('マスターに無い名前の手入力行は master が null（Python が保存値を必ず書く）', () => {
    const reports = [report('2026-11-05', [labor(null, '応援', { dailyRate: 25000 }), lease(null, '投光器', 800)])];
    const { payload } = buildExportPayload(input({ reports }));
    expect(payload.days[0].labor[0]).toMatchObject({ daily_rate: 25000, master_daily_rate: null });
    expect(payload.days[0].lease[0]).toMatchObject({ unit_price: 800, master_unit_price: null });
  });

  it('手入力行の名前がマスターの作業員（未選択）と 1 件だけ一致すれば、その作業員を出力対象に入れ、master はそのマスター値', () => {
    const reports = [report('2026-11-05', [labor(null, '山田 太郎', { dailyRate: 25000 }), lease(null, '発電機', 800)])];
    const { payload, warnings } = buildExportPayload(input({
      reports, workers: [worker('w1', '山田 太郎', [[18000, '2026-01-01']])], leaseItems: [leaseItem('l1', '発電機')],
    }));
    expect(payload.workers.map((w) => w.name)).toEqual(['山田 太郎']);
    expect(payload.lease_items.map((l) => l.name)).toEqual(['発電機']);
    expect(payload.days[0].labor[0]).toMatchObject({ daily_rate: 25000, master_daily_rate: 18000 });
    expect(payload.days[0].lease[0]).toMatchObject({ unit_price: 800, master_unit_price: 3000 });
    expect(warnings).toEqual([]);
  });

  it('同じ名前の作業員・リース品が 2 件あれば duplicate_name を出し、その名前の行は master が null', () => {
    const workers = [worker('w1', '山田 太郎', [[18000, '2026-01-01']]), worker('w2', '山田 太郎 ', [[22000, '2026-01-01']])];
    const items = [leaseItem('l1', '発電機', [[3000, '2026-01-01']]), leaseItem('l2', '発電機', [[3500, '2026-01-01']])];
    const reports = [report('2026-11-05', [
      labor('w1', '山田 太郎', { dailyRate: 18000 }),
      labor('w2', '山田 太郎', { dailyRate: 22000 }),
      lease('l2', '発電機', 3500),
    ])];
    const laborEntries = [{ reportDate: '2026-10-10', workerId: null, workerName: '山田 太郎', manDays: 1, cost: 20000, overtimeHours: 0 }];
    const { payload, warnings } = buildExportPayload(input({
      reports, workers, leaseItems: items, laborEntries,
      selected: { workerIds: ['w1', 'w2'], supplierIds: [], vehicleIds: [], leaseItemIds: ['l1'] },
    }));
    expect(payload.days[0].labor.map((l) => [l.daily_rate, l.master_daily_rate])).toEqual([[18000, null], [22000, null]]);
    expect(payload.days[0].lease[0]).toMatchObject({ unit_price: 3500, master_unit_price: null });
    // 名前だけの繰越はどちらにも足さない
    expect(payload.workers.map((w) => [w.carry_man_days, w.carry_cost])).toEqual([[0, 0], [0, 0]]);
    expect(warnings).toEqual([
      { code: 'duplicate_name', message: '作業員名『山田 太郎』が 2 件あります。Excel では先頭の行の日当が使われます（名前だけの前月繰越は入れていません）' },
      { code: 'duplicate_name', message: 'リース品名『発電機』が 2 件あります。Excel では先頭の行の単価が使われます' },
    ]);
  });

  it('同じ作業員の 2 行（午前・午後）はそのまま 2 行で出す', () => {
    const reports = [report('2026-11-05', [
      labor('w1', '山田 太郎', { time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: null } }),
      labor('w1', '山田 太郎', { time: { start: '13:00', end: '17:00', breakMin: 0, gapMin: null }, note: '午後' }),
    ])];
    const { payload } = buildExportPayload(input({ reports, workers: [worker('w1', '山田 太郎')], selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] } }));
    expect(payload.days[0].labor).toEqual([
      { name: '山田 太郎', start: '08:00', end: '12:00', break_min: 0, gap_min: null, note: null, daily_rate: 18000, master_daily_rate: 18000 },
      { name: '山田 太郎', start: '13:00', end: '17:00', break_min: 0, gap_min: null, note: '午後', daily_rate: 18000, master_daily_rate: 18000 },
    ]);
    expect(payload.workers).toHaveLength(1);
  });
});

describe('buildExportPayload: 前月繰越', () => {
  it('繰越初期値 + 基準日以降で出力月より前の日報。基準日より前と出力月以降は入れない', () => {
    const workers = [worker('w1', '山田 太郎'), worker('w2', '鈴木 一郎')];
    const laborEntries = [
      { reportDate: '2026-09-20', workerId: 'w1', workerName: '山田 太郎', manDays: 1, cost: 18000, overtimeHours: 0 }, // 基準日より前（初期値に含まれる）
      { reportDate: '2026-10-10', workerId: 'w1', workerName: '山田 太郎', manDays: 1.07, cost: 19260, overtimeHours: 0 },
      { reportDate: '2026-10-31', workerId: 'w1', workerName: '山田 太郎', manDays: 0.5, cost: 9000, overtimeHours: 0 },
      { reportDate: '2026-11-05', workerId: 'w1', workerName: '山田 太郎', manDays: 1, cost: 18000, overtimeHours: 0 }, // 出力月
      { reportDate: '2026-12-01', workerId: 'w1', workerName: '山田 太郎', manDays: 1, cost: 18000, overtimeHours: 0 }, // 出力月より後
      { reportDate: '2026-10-15', workerId: 'w2', workerName: '鈴木 一郎', manDays: 0.53, cost: 8480, overtimeHours: 0 },
    ];
    const { payload } = buildExportPayload(input({
      workers, laborEntries,
      carryovers: [{ workerId: 'w1', manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }],
      selected: { workerIds: ['w1', 'w2'], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    }));
    expect(payload.workers.map((w) => [w.name, w.carry_man_days, w.carry_cost])).toEqual([
      ['山田 太郎', 14.07, 253260],
      ['鈴木 一郎', 0.53, 8480],
    ]);
  });

  it('未選択でその月に使っていなくても、繰越がある作業員は末尾に入れる（選択 → 使用を名前順 → 繰越だけを名前順）', () => {
    const workers = [
      worker('w1', '選択'), worker('w2', 'つかった'), worker('w3', 'あさく'),
      worker('w4', 'くりこし初期値'), worker('w5', 'いぜんの日報'), worker('w6', '繰越なし'),
    ];
    const reports = [report('2026-11-05', [labor('w2', 'つかった'), labor('w3', 'あさく')])];
    const { payload } = buildExportPayload(input({
      workers, reports,
      selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
      carryovers: [{ workerId: 'w4', manDays: 3, laborCost: 54000, beforeDate: '2026-10-01' }],
      laborEntries: [
        { reportDate: '2026-10-20', workerId: 'w5', workerName: 'いぜんの日報', manDays: 1, cost: 18000, overtimeHours: 0 },
        { reportDate: '2026-12-01', workerId: 'w6', workerName: '繰越なし', manDays: 1, cost: 18000, overtimeHours: 0 }, // 出力月より後は繰越ではない
      ],
    }));
    expect(payload.workers.map((w) => [w.name, w.carry_man_days, w.carry_cost])).toEqual([
      ['選択', 0, 0],
      ['あさく', 0, 0],
      ['つかった', 0, 0],
      ['いぜんの日報', 1, 18000],
      ['くりこし初期値', 3, 54000],
    ]);
  });

  it('名前だけの行は同名の作業員の繰越に入れ、その作業員の基準日より前の分は除く', () => {
    const { payload } = buildExportPayload(input({
      workers: [worker('w1', '山田 太郎')],
      carryovers: [{ workerId: 'w1', manDays: 10, laborCost: 180000, beforeDate: '2026-10-01' }],
      laborEntries: [
        { reportDate: '2026-09-25', workerId: null, workerName: '山田 太郎', manDays: 1, cost: 18000, overtimeHours: 0 }, // 初期値に含まれる
        { reportDate: '2026-10-15', workerId: null, workerName: '山田 太郎', manDays: 0.5, cost: 9000, overtimeHours: 0 },
      ],
    }));
    expect(payload.workers.map((w) => [w.name, w.carry_man_days, w.carry_cost])).toEqual([['山田 太郎', 10.5, 189000]]);
  });

  it('前月までの分が無い作業員は 0', () => {
    const { payload } = buildExportPayload(input({
      workers: [worker('w1', '山田 太郎')], selected: { workerIds: ['w1'], supplierIds: [], vehicleIds: [], leaseItemIds: [] },
    }));
    expect(payload.workers[0]).toEqual({ name: '山田 太郎', trade: '大工', daily_rate: 18000, overtime_rate: null, note: null, carry_man_days: 0, carry_cost: 0 });
  });
});

describe('buildExportPayload: 累計原価', () => {
  it('現場のこの日までの cost_total の累計（出力月より前も含み、後は含まない）', () => {
    const reports = [report('2026-11-05', [], { costTotal: 2000 }), report('2026-11-20', [], { costTotal: 500.1 })];
    const siteReports = [
      { reportDate: '2026-10-10', costTotal: 1000.2 },
      { reportDate: '2026-11-20', costTotal: 500.1 },
      { reportDate: '2026-11-05', costTotal: 2000 },
      { reportDate: '2026-12-01', costTotal: 9999 },
    ];
    const { payload } = buildExportPayload(input({ reports, siteReports }));
    expect(payload.days.map((d) => d.cumulative_cost)).toEqual([3000.2, 3500.3]);
  });
});

describe('buildExportPayload: 労務行の時間', () => {
  it('時間が無く休憩・中抜だけある行は、共通の開始・終了を入れる', () => {
    const reports = [
      report('2026-11-05', [
        labor(null, 'A', { time: { start: null, end: null, breakMin: 60, gapMin: null } }),
        labor(null, 'B', { time: { start: null, end: null, breakMin: null, gapMin: 30 } }),
        labor(null, 'C'),
        labor(null, 'D', { time: { start: '09:00', end: '15:00', breakMin: 30, gapMin: null } }),
      ], { common: { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 } }),
      report('2026-11-06', [labor(null, 'A', { time: { start: null, end: null, breakMin: 60, gapMin: null } })], { common: { ...NO_TIME } }),
    ];
    const { payload } = buildExportPayload(input({ reports }));
    expect(payload.days[0].labor.map((l) => [l.start, l.end, l.break_min, l.gap_min])).toEqual([
      ['08:00', '17:30', 60, null],
      ['08:00', '17:30', null, 30],
      [null, null, null, null],
      ['09:00', '15:00', 30, null],
    ]);
    expect(payload.days[0].common).toEqual({ start: '08:00', end: '17:30', break_min: 90, gap_min: 0 });
    expect(payload.days[1].labor[0]).toMatchObject({ start: null, end: null, break_min: 60 });
  });
});

describe('buildExportPayload: 日報の項目', () => {
  it('明細・重要事項・連絡事項・作成者などを fixture の形で入れる', () => {
    const r = report('2026-11-01', [
      labor('w1', '山田 太郎', { note: '大工' }),
      { kind: 'fuel', vehicleId: 'v1', vehicleName: 'ハイエース', kmPerL: 8.5, distanceKm: 40, pricePerL: 170, note: '' },
      lease('l1', '発電機', 3000),
      { kind: 'cash', itemName: 'ビス', spec: '50mm', unit: '箱', qty: 1, unitPrice: 500, vendor: 'ホームセンター' },
      { kind: 'credit', itemName: '合板', spec: '12mm', unit: '枚', qty: 2, unitPrice: 1500, supplierId: 'p1', vendor: '○○建材' },
      { kind: 'work', estimateItemId: null, trade: '解体', description: '外壁撤去', qty: 10, unit: 'm2', manDays: 1.5, unitPrice: 5000, source: 'extra', ...EMPTY_WORK_CHANGE },
    ], {
      status: 'approved', outputTotal: 50000, costTotal: 10600,
      issuesText: '追加工事の指示あり', issues: ['サッシ追加 2 か所'], notesText: '雨天のため午後中止',
      reviewedByName: '確認花子', approvedByName: '承認次郎', approvedAt: '2026-11-02T01:15:00+00:00',
    });
    const { payload } = buildExportPayload(input({
      reports: [r],
      workers: [worker('w1', '山田 太郎')], vehicles: [vehicle('v1', 'ハイエース')], leaseItems: [leaseItem('l1', '発電機')], suppliers: [supplier('p1', '○○建材')],
      selected: { workerIds: ['w1'], supplierIds: ['p1'], vehicleIds: ['v1'], leaseItemIds: ['l1'] },
    }));
    expect(payload.days[0]).toEqual({
      index: 1, date: '2026-11-01', total_index: 1, weather: '晴れ', supervisor: '検証太郎',
      common: { start: '08:00', end: '17:30', break_min: 90, gap_min: 0 },
      labor: [{ name: '山田 太郎', start: null, end: null, break_min: null, gap_min: null, note: '大工', daily_rate: 18000, master_daily_rate: 18000 }],
      fuel: [{ name: 'ハイエース', distance_km: 40, price_per_l: 170, note: null }],
      lease: [{ name: '発電機', spec: '2.8kVA', unit: '日', qty: 1, note: null, unit_price: 3000, master_unit_price: 3000 }],
      cash: [{ name: 'ビス', spec: '50mm', unit: '箱', qty: 1, unit_price: 500, vendor: 'ホームセンター' }],
      credit: [{ name: '合板', spec: '12mm', unit: '枚', qty: 2, unit_price: 1500, vendor: '○○建材' }],
      work: [{ trade: '解体', description: '外壁撤去', qty: 10, unit: 'm2', man_days: 1.5, unit_price: 5000 }],
      cumulative_cost: 10600, output_total: 50000,
      issues_text: '追加工事の指示あり', issues: ['サッシ追加 2 か所'], notes_text: '雨天のため午後中止',
      created_by: '検証太郎', reviewed_by: '確認花子', approved_by: '承認次郎', approved_at: '2026-11-02T01:15:00+00:00',
    });
  });

  it('承認済みでなければ承認者・承認日は空。空文字は null', () => {
    const r = report('2026-11-01', [], {
      status: 'submitted', weather: '', supervisor: null, issuesText: '', notesText: '',
      approvedByName: '承認次郎', approvedAt: '2026-11-02T01:15:00+00:00', createdByName: null,
    });
    const d = buildExportPayload(input({ reports: [r] })).payload.days[0];
    expect([d.weather, d.issues_text, d.notes_text, d.created_by, d.approved_by, d.approved_at]).toEqual([null, null, null, null, null, null]);
  });
});

describe('exportFileName', () => {
  it('現場名_YYYY年MM月.xlsm', () => {
    expect(exportFileName('検証現場', '2026-03')).toBe('検証現場_2026年03月.xlsm');
  });
  it('禁止文字と制御文字は _、前後の空白は除く', () => {
    expect(exportFileName(' A/B\\C:D*E?F"G<H>I|J\tK\n ', '2026-11')).toBe('A_B_C_D_E_F_G_H_I_J_K_2026年11月.xlsm');
  });
  it('空なら「現場」', () => {
    expect(exportFileName('   ', '2026-11')).toBe('現場_2026年11月.xlsm');
    expect(exportFileName('', '2026-11')).toBe('現場_2026年11月.xlsm');
  });
});

describe('Python の fixture との形の一致', () => {
  // 値ではなくキーの並び（入れ子・配列の要素を含む）を比べる。fixture が正。
  function shape(v: unknown): unknown {
    if (Array.isArray(v)) return v.length === 0 ? [] : [shape(v[0])];
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as Record<string, unknown>)[k])]));
    return 'value';
  }
  it('payload_days.json と同じキー', () => {
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../python/tests/fixtures/payload_days.json', import.meta.url)), 'utf8'));
    const r = report('2026-11-01', [
      labor('w1', '山田 太郎'),
      { kind: 'fuel', vehicleId: 'v1', vehicleName: 'ハイエース', kmPerL: 8.5, distanceKm: 40, pricePerL: 170, note: '' },
      lease('l1', '発電機', 3000),
      { kind: 'cash', itemName: 'ビス', spec: '50mm', unit: '箱', qty: 1, unitPrice: 500, vendor: 'ホームセンター' },
      { kind: 'credit', itemName: '合板', spec: '12mm', unit: '枚', qty: 2, unitPrice: 1500, supplierId: 'p1', vendor: '○○建材' },
      { kind: 'work', estimateItemId: null, trade: '解体', description: '外壁撤去', qty: 10, unit: 'm2', manDays: 1.5, unitPrice: 5000, source: 'extra', ...EMPTY_WORK_CHANGE },
    ], { issues: ['件'] });
    const { payload } = buildExportPayload(input({
      reports: [r],
      workers: [worker('w1', '山田 太郎')], vehicles: [vehicle('v1', 'ハイエース')], leaseItems: [leaseItem('l1', '発電機')], suppliers: [supplier('p1', '○○建材')],
      selected: { workerIds: ['w1'], supplierIds: ['p1'], vehicleIds: ['v1'], leaseItemIds: ['l1'] },
    }));
    expect(shape(payload)).toEqual(shape({ ...fixture, days: [fixture.days[0]] }));
  });
});
