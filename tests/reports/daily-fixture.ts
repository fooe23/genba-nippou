import { buildDailyReport } from '@/lib/reports/daily-model';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { DailyReportInput, DailyReportModel, DailyReportSource, SavedReportLine } from '@/lib/reports/types';

// 日報の帳票（モデル・CSV・PDF）のテスト用：明細の種類がすべてそろった 1 日分の入力。
// 保存値（stored・saved）は計算で出る値とわざと違えてある（帳票が再計算していないことを確かめるため）。

const stored = (amount: number, manDays = 0, overtimeHours = 0) => ({ amount, manDays, overtimeHours });
const noTime = { start: null, end: null, breakMin: null, gapMin: null };

export const site: Site = {
  id: 's1', name: '〇〇邸新築工事', clientName: '〇〇様', projectName: null, projectNo: 'K-001', overview: null,
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: '2027-01-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null,
};

export const lines: SavedReportLine[] = [
  // 共通時間どおり（時刻は空）。
  {
    kind: 'labor', workerId: 'w1', workerName: '田中', time: noTime, dailyRate: 18000, note: '', overtimeRate: null,
    saved: { hours: 8, manDays: 1, overtimeHours: 0, cost: 18000 }, stored: stored(18001, 1, 0),
  },
  // 開始・終了だけ入れた行（休憩・中抜は共通時間）。手入力の作業員。
  {
    kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time: { start: '07:00', end: '19:00', breakMin: null, gapMin: 30 },
    dailyRate: 15000, note: '残業あり', overtimeRate: null,
    saved: { hours: 9, manDays: 1, overtimeHours: 1.5, cost: 17344 }, stored: stored(17344, 1, 1.5),
  },
  // 開始だけ（終了が空）→ 共通時間で計算されるので、表示も共通時間。saved なし。
  { kind: 'labor', workerId: 'w2', workerName: '佐藤', time: { start: '09:00', end: null, breakMin: 0, gapMin: null }, dailyRate: null, note: '', overtimeRate: null, stored: stored(0) },
  { kind: 'fuel', vehicleId: 'v1', vehicleName: '2t ダンプ', kmPerL: 10, distanceKm: 42, pricePerL: 170, note: '残土運搬', stored: stored(714) },
  { kind: 'fuel', vehicleId: null, vehicleName: '借用車', kmPerL: null, distanceKm: 10, pricePerL: null, note: '', stored: stored(0) },
  { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '枠組', unit: '日', qty: 3, unitPrice: 1000, note: '', stored: stored(3000) },
  { kind: 'lease', itemId: null, itemName: '発電機', spec: '', unit: '台', qty: 1, unitPrice: 5000, note: '持込', stored: stored(5000) },
  { kind: 'cash', itemName: '釘', spec: 'N65', unit: '箱', qty: 1, unitPrice: 1200, vendor: '=ホームセンター', stored: stored(1200) },
  { kind: 'credit', itemName: '合板', spec: '12mm', unit: '枚', qty: 10, unitPrice: 1500, supplierId: 'sp1', vendor: '山田商店', stored: stored(15000) },
  { kind: 'credit', itemName: '金物', spec: '', unit: '式', qty: 1, unitPrice: 800, supplierId: null, vendor: '川村金物', stored: stored(800) },
  { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地, "1 階"', qty: 20, unit: 'm2', manDays: 2, unitPrice: 5000, source: 'extra', stored: stored(100000, 2) },
  { kind: 'work', estimateItemId: null, trade: '', description: '片付け', qty: null, unit: '', manDays: 0.5, unitPrice: null, source: 'extra', stored: stored(0, 0.5) },
];

export const COST_TOTAL = 18001 + 17344 + 0 + 714 + 0 + 3000 + 5000 + 1200 + 15000 + 800;

export function report(date = '2026-11-02', over: Partial<DailyReportSource> = {}): DailyReportSource {
  return {
    id: `r-${date}`, siteId: 's1', reportDate: date, weather: '晴れ', supervisor: '大江', status: 'approved', rejectedReason: null,
    outputTotal: 100000, costTotal: COST_TOTAL, manDaysTotal: 2, updatedAt: null, createdBy: 'p1',
    lines,
    common: { start: '08:00', end: '17:30', breakMin: 90, gapMin: 0 },
    issuesText: '施主より追加の依頼あり',
    notesText: '明日は雨天予報',
    reviewedBy: 'p2', approvedBy: 'p3', approvedAt: '2026-11-03T01:00:00Z',
    ...over,
  };
}

export const issues: Issue[] = [
  { id: 'i1', siteId: 's1', reportId: 'r-2026-11-02', reportDate: '2026-11-02', body: '棚の追加', status: 'open', doneAt: null },
  { id: 'i2', siteId: 's1', reportId: 'r-2026-11-02', reportDate: '2026-11-02', body: '窓の変更', status: 'done', doneAt: '2026-11-04T03:00:00Z' },
];

export function dailyInput(over: Partial<DailyReportInput> = {}): DailyReportInput {
  return {
    site,
    report: report(),
    reportDates: ['2026-10-20', '2026-10-21', '2026-11-01', '2026-11-02', '2026-11-05'],
    issues,
    names: { p1: '作成 太郎', p2: '確認 次郎', p3: '承認 三郎' },
    cumulativeOutputBefore: 150000,
    ...over,
  };
}

export function sampleDaily(over: Partial<DailyReportInput> = {}): DailyReportModel {
  return buildDailyReport(dailyInput(over));
}
