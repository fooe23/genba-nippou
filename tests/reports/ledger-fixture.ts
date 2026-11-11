import { EMPTY_LABOR_COST_CONTEXT } from '@/lib/calc/labor-cost';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { buildCostReport } from '@/lib/reports/cost-model';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { CostReportInput, CostReportModel, CostReportPeriod, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import { NOW, RATES } from './cost-fixture';

// 現場管理台帳（2026-11-11）のテスト用：〇〇様邸の 2026-11-10 の 1 日。
// 原価 215,000（労務 20,000＋燃料 5,000＋買掛 190,000）、外注 170,000、出来高 215,000、総人工 2.0（うち請負 1.0）。

const touched = { updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' };
const stored = (amount: number, manDays = 0, overtimeHours = 0) => ({ amount, manDays, overtimeHours, hours: manDays * 8 + overtimeHours });
const time = { start: null, end: null, breakMin: null, gapMin: null };

const site: Site = {
  id: 's1', name: '〇〇様邸', clientName: '〇〇様', projectName: null, projectNo: 'K-010', overview: null,
  contractAmount: 1_000_000, startDate: '2026-11-01', endDate: '2026-12-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null, estimateRequired: null,
};

/** 自社 Ｓさん 1.0 人工・20,000 円。 */
export const ownLabor = (o: Partial<SavedReportLine> = {}): SavedReportLine =>
  ({
    kind: 'labor', workerId: 'w1', workerName: 'Ｓさん', time, dailyRate: 20000, note: '', overtimeRate: null,
    affiliation: 'own', supplierId: null, laborContract: null, stored: stored(20000, 1), ...o,
  }) as SavedReportLine;

/** 〇〇工務店の名前なし 3 名・計 1.0 人工・請負（労務費は原価に数えない）。 */
export const unnamedLabor = (o: Partial<SavedReportLine> = {}): SavedReportLine =>
  ({
    kind: 'labor', workerId: null, workerName: '〇〇工務店（名前なし）', time, dailyRate: 18000, note: '', overtimeRate: null,
    affiliation: 'partner', supplierId: 'pK', laborContract: 'ukeoi', headcount: 3, stored: { amount: 18000, manDays: 1, overtimeHours: 0, hours: 8 / 3 }, ...o,
  }) as SavedReportLine;

const dayLines = (): SavedReportLine[] => [
  ownLabor(),
  unnamedLabor(),
  { kind: 'fuel', vehicleId: null, vehicleName: '軽トラ', kmPerL: null, distanceKm: null, pricePerL: null, note: '', stored: stored(5000), issueId: null },
  {
    kind: 'credit', itemName: '砂', spec: '', unit: '式', qty: 1, unitPrice: 20000, supplierId: 'sp1', vendor: '〇〇建材',
    purchaseKind: 'material', siteTradeId: null, issueId: null, stored: stored(20000),
  },
  {
    kind: 'credit', itemName: 'タイル張り', spec: '', unit: '式', qty: 1, unitPrice: 170000, supplierId: 'pK', vendor: '〇〇工務店',
    purchaseKind: 'subcontract', siteTradeId: 't-tile', issueId: null, stored: stored(170000),
  },
  {
    kind: 'work', estimateItemId: null, trade: 'とび・土工', description: '清掃', qty: 1, unit: '式', manDays: 0.5, unitPrice: 20000,
    source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, stored: stored(20000, 0.5),
  },
  {
    kind: 'work', estimateItemId: null, trade: 'タイル', description: '目地', qty: 1, unit: '式', manDays: 0.5, unitPrice: 25000,
    source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind: 'increase', issueId: 'iInc', stored: stored(25000, 0.5),
  } as SavedReportLine,
];

/** cost_total は外注の買掛を除く（DB のトリガーと同じ）。 */
export function ledgerReport(date: string, lines: SavedReportLine[]): ReportWithLines {
  const cost = lines
    .filter((l) => l.kind !== 'work' && !(l.kind === 'credit' && l.purchaseKind === 'subcontract'))
    .reduce((s, l) => s + l.stored.amount, 0);
  const output = lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.stored.amount, 0);
  const manDays = lines.filter((l) => l.kind === 'labor').reduce((s, l) => s + l.stored.manDays, 0);
  return {
    id: `r-${date}`, siteId: 's1', reportDate: date, weather: '晴れ', supervisor: null, status: 'approved', rejectedReason: null,
    outputTotal: output, costTotal: cost, manDaysTotal: manDays, updatedAt: null, createdBy: null,
    clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null, lines,
  };
}

const incIssue: Issue = {
  id: 'iInc', siteId: 's1', reportId: 'r-2026-11-10', reportDate: '2026-11-10', body: 'タイル目地の増', status: 'open', doneAt: null, kind: 'increase',
  instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null, estimateSubmittedOn: null, estimateRequirement: 'none', estimatePending: false,
};

export function ledgerInput(reports: ReportWithLines[] = [ledgerReport('2026-11-10', dayLines())]): CostReportInput {
  return {
    site,
    reports,
    laborCost: EMPTY_LABOR_COST_CONTEXT,
    carryovers: [],
    workers: [{ id: 'w1', name: 'Ｓさん', trade: '土工', note: null, active: true, rates: [], overtimeRate: null, affiliation: 'own', supplierId: null, ...touched }],
    suppliers: [
      { id: 'sp1', name: '〇〇建材', category: null, contact: null, note: null, active: true, isVendor: true, isPartner: false, ...touched },
      { id: 'pK', name: '〇〇工務店', category: null, contact: null, note: null, active: true, isVendor: true, isPartner: true, ...touched },
    ],
    vehicles: [],
    leaseItems: [],
    issues: [incIssue],
    sitePartners: [{ supplierId: 'pK', supplierName: '〇〇工務店', amount: null }],
    tradeNames: { 't-tile': 'タイル' },
  };
}

export function ledgerModel(period: CostReportPeriod = { kind: 'all' }, input: CostReportInput = ledgerInput()): CostReportModel {
  return buildCostReport(input, period, NOW, RATES);
}
