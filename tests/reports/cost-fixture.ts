import { buildCostReport } from '@/lib/reports/cost-model';
import type { Site } from '@/lib/db/sites';
import type { CostReportInput, CostReportModel, CostReportPeriod, ReportWithLines, SavedReportLine } from '@/lib/reports/types';

// 帳票のレンダラー（CSV・Excel・PDF）のテスト用：小さな入力から buildCostReport でモデルを作る。

const touched = { updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' };
const stored = (amount: number, manDays = 0, overtimeHours = 0) => ({ amount, manDays, overtimeHours });
const time = { start: null, end: null, breakMin: null, gapMin: null };

const site: Site = {
  id: 's1', name: '〇〇邸新築工事', clientName: '〇〇様', projectName: null, projectNo: 'K-001', overview: '木造 2 階建て "在来"',
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: '2027-01-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null,
};

const lines: SavedReportLine[] = [
  { kind: 'labor', workerId: 'w1', workerName: '田中', time, dailyRate: 18000, note: '', overtimeRate: null, stored: stored(18000, 1, 1.5) },
  { kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time, dailyRate: 15000, note: '', overtimeRate: null, stored: stored(15000, 1) },
  { kind: 'fuel', vehicleId: 'v1', vehicleName: '2t ダンプ', kmPerL: 10, distanceKm: 42, pricePerL: 170, note: '', stored: stored(714) },
  { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '', unit: '日', qty: 3, unitPrice: 1000, note: '', stored: stored(3000) },
  { kind: 'cash', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 1200, vendor: '', stored: stored(1200) },
  { kind: 'credit', itemName: '合板', spec: '', unit: '枚', qty: 10, unitPrice: 1500, supplierId: 'sp1', vendor: '山田商店', stored: stored(15000) },
  { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 20, unit: 'm2', manDays: 2, unitPrice: 5000, source: 'extra', stored: stored(100000, 2) },
  { kind: 'work', estimateItemId: null, trade: '', description: '片付け', qty: null, unit: '', manDays: 0, unitPrice: 0, source: 'extra', stored: stored(0, 0) },
];

const report = (date: string, status: ReportWithLines['status']): ReportWithLines => {
  const cost = lines.filter((l) => l.kind !== 'work').reduce((s, l) => s + l.stored.amount, 0);
  const output = lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.stored.amount, 0);
  return {
    id: `r-${date}`, siteId: 's1', reportDate: date, weather: '晴れ', supervisor: null, status, rejectedReason: null,
    outputTotal: output, costTotal: cost, manDaysTotal: 2, updatedAt: null, createdBy: null, lines,
  };
};

export const costInput = (reports: ReportWithLines[] = [report('2026-10-20', 'approved'), report('2026-11-02', 'submitted')]): CostReportInput => ({
  site,
  reports,
  carryovers: [],
  workers: [{ id: 'w1', name: '田中', trade: '大工', note: null, active: true, rates: [], overtimeRate: null, ...touched }],
  suppliers: [{ id: 'sp1', name: '山田商店', category: null, contact: null, note: null, active: true, ...touched }],
  vehicles: [{ id: 'v1', name: '2t ダンプ', kind: null, kmPerL: 10, note: null, active: true, ...touched }],
  leaseItems: [{ id: 'l1', name: '足場', spec: null, note: null, active: true, rates: [], ...touched }],
});

export const NOW = { date: '2026-11-10', by: '大江', at: '2026-11-10T01:23:45.000Z' };

export function sampleModel(period: CostReportPeriod = { kind: 'all' }): CostReportModel {
  return buildCostReport(costInput(), period, NOW);
}

/** 日報 0 件の現場。 */
export function emptyModel(): CostReportModel {
  return buildCostReport(costInput([]), { kind: 'all' }, NOW);
}
