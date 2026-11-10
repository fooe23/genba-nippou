import { buildChangeLedger } from '@/lib/reports/change-model';
import type { ChangeReportMeta } from '@/lib/reports/change-sections';
import { buildCostReport } from '@/lib/reports/cost-model';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type { ChangeLedgerModel, CostReportInput, CostReportModel, CostReportPeriod, ReportWithLines, SavedReportLine } from '@/lib/reports/types';
import { EMPTY_LABOR_COST_CONTEXT } from '@/lib/calc/labor-cost';

type WorkLineSaved = Extract<SavedReportLine, { kind: 'work' }>;

// 帳票のレンダラー（CSV・Excel・PDF）のテスト用：小さな入力から buildCostReport でモデルを作る。

const touched = { updatedAt: null, updatedBy: null, createdAt: '2026-01-01T00:00:00Z' };
const stored = (amount: number, manDays = 0, overtimeHours = 0) => ({ amount, manDays, overtimeHours, hours: manDays * 8 + overtimeHours });
const time = { start: null, end: null, breakMin: null, gapMin: null };

const site: Site = {
  id: 's1', name: '〇〇邸新築工事', clientName: '〇〇様', projectName: null, projectNo: 'K-001', overview: '木造 2 階建て "在来"',
  contractAmount: 1_000_000, startDate: '2026-10-01', endDate: '2027-01-31', contractType: '元請け', status: 'active',
  commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null, deletedAt: null, contractStatus: 'fixed', estimatedAmount: null, defaultDailyRate: null,
};

const lines: SavedReportLine[] = [
  { kind: 'labor', workerId: 'w1', workerName: '田中', time, dailyRate: 18000, note: '', overtimeRate: null, affiliation: 'own', supplierId: null, stored: stored(18000, 1, 1.5) },
  { kind: 'labor', workerId: null, workerName: '飛び込み 鈴木', time, dailyRate: 15000, note: '', overtimeRate: null, stored: stored(15000, 1) },
  { kind: 'fuel', vehicleId: 'v1', vehicleName: '2t ダンプ', kmPerL: 10, distanceKm: 42, pricePerL: 170, note: '', stored: stored(714), issueId: null },
  { kind: 'lease', itemId: 'l1', itemName: '足場', spec: '', unit: '日', qty: 3, unitPrice: 1000, note: '', stored: stored(3000), issueId: null },
  { kind: 'cash', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 1200, vendor: '', stored: stored(1200), issueId: null },
  { kind: 'credit', itemName: '合板', spec: '', unit: '枚', qty: 10, unitPrice: 1500, supplierId: 'sp1', vendor: '山田商店', stored: stored(15000), purchaseKind: 'material', siteTradeId: null, issueId: null },
  { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 20, unit: 'm2', manDays: 2, unitPrice: 5000, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, stored: stored(100000, 2) },
  { kind: 'work', estimateItemId: null, trade: '', description: '片付け', qty: null, unit: '', manDays: 0, unitPrice: 0, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, stored: stored(0, 0) },
];

const report = (date: string, status: ReportWithLines['status']): ReportWithLines => {
  const cost = lines.filter((l) => l.kind !== 'work').reduce((s, l) => s + l.stored.amount, 0);
  const output = lines.filter((l) => l.kind === 'work').reduce((s, l) => s + l.stored.amount, 0);
  return {
    id: `r-${date}`, siteId: 's1', reportDate: date, weather: '晴れ', supervisor: null, status, rejectedReason: null,
    outputTotal: output, costTotal: cost, manDaysTotal: 2, updatedAt: null, createdBy: null,
    clientConfirmedBy: null, clientConfirmedAt: null, clientConfirmedNote: null, lines,
  };
};

export const costInput = (reports: ReportWithLines[] = [report('2026-10-20', 'approved'), report('2026-11-02', 'submitted')]): CostReportInput => ({
  site,
  reports,
  laborCost: EMPTY_LABOR_COST_CONTEXT,
  carryovers: [],
  workers: [{ id: 'w1', name: '田中', trade: '大工', note: null, active: true, rates: [], overtimeRate: null, affiliation: 'own', supplierId: null, ...touched }],
  suppliers: [{ id: 'sp1', name: '山田商店', category: null, contact: null, note: null, active: true, isVendor: true, isPartner: false, ...touched }],
  vehicles: [{ id: 'v1', name: '2t ダンプ', kind: null, kmPerL: 10, note: null, active: true, ...touched }],
  leaseItems: [{ id: 'l1', name: '足場', spec: null, note: null, active: true, rates: [], ...touched }],
  issues: [],
  sitePartners: [],
});

export const NOW = { date: '2026-11-10', by: '大江', at: '2026-11-10T01:23:45.000Z' };
export const RATES = { legalWelfareRate: 0.151, materialExpenseRate: 0.12, leaseFuelExpenseRate: 0.12, overheadProfitRate: 0.08 };

export function sampleModel(period: CostReportPeriod = { kind: 'all' }): CostReportModel {
  return buildCostReport(costInput(), period, NOW, RATES);
}

/** 日報 0 件の現場。 */
export function emptyModel(): CostReportModel {
  return buildCostReport(costInput([]), { kind: 'all' }, NOW, RATES);
}

// ─── 変更増減 精算資料（Task 12）用：追加・変更・減の行と根拠の件のある日報（増の行は無い） ───

/** 11/05 の日報：上の lines（契約内 2 人工）に、追加 1.5 人工・変更 0.5 人工・減（10 m2 × 2,500）を足す。 */
const changeLines: SavedReportLine[] = [
  ...lines,
  {
    kind: 'work', estimateItemId: null, trade: '内装', description: 'クロス張替え（2 階洋室）', qty: 30, unit: 'm2', manDays: 1.5, unitPrice: 1200,
    source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind: 'extra', instructedBy: '施主 〇〇様', instructionMethod: 'oral', instructedOn: '2026-11-01',
    issueId: 'i1', stored: stored(36000, 1.5),
  },
  {
    kind: 'work', estimateItemId: null, trade: '大工', description: '棚の位置変更', qty: 1, unit: '式', manDays: 0.5, unitPrice: 8000,
    source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind: 'change', instructionMethod: 'phone', stored: stored(8000, 0.5),
  },
  {
    kind: 'work', estimateItemId: null, trade: '塗装', description: '外壁塗装の一部取りやめ', qty: 10, unit: 'm2', manDays: 0, unitPrice: 2500,
    source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind: 'minus', instructedBy: '設計 佐藤様', instructionMethod: 'document', instructedOn: '2026-11-04',
    stored: stored(-25000, 0),
  },
];

/** 10/20（契約内だけ）と 11/05（追加・変更・減。増は無い。客先確認あり）。根拠の件 i1 は 11/02 の日報の 1 件目。 */
export const changeInput = (): CostReportInput => ({
  ...costInput([
    report('2026-10-20', 'approved'),
    { ...report('2026-11-05', 'approved'), lines: changeLines, clientConfirmedAt: '2026-11-05T09:00:00Z' },
  ]),
  issues: [
    {
      id: 'i1', siteId: 's1', reportId: 'r-2026-11-02', reportDate: '2026-11-02',
      body: '施主様より 2 階洋室のクロスを全面張替えにしたいとの依頼。見積は後日提出。', status: 'open', doneAt: null, kind: 'extra',
      instructedBy: '施主 〇〇様', instructionMethod: 'oral', amountEstimate: 40000,
      settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null, estimateSubmittedOn: null,
    },
  ],
});

/**
 * 件ごとの精算（Task 4）用：11/05 の日報の追加（1.5 人工）は未定の件 i1、変更（0.5 人工）は常用の件 iD（30,000 円／人工）、
 * 減は一式の件 iM（確定額 20,000 → −20,000）に紐づけ、件なしの追加（手すり 0.5 人工）を 1 行足す。
 * 行の無い一式の件 iL（追加 100,000）と、やり直しの件 iR（一式 8,000。参考）も載せる。
 */
export const settledInput = (): CostReportInput => {
  const base = changeInput();
  const [extra, change, minus] = changeLines.slice(lines.length) as WorkLineSaved[];
  const settledLines: SavedReportLine[] = [
    ...lines,
    extra,
    { ...change, issueId: 'iD' },
    { ...minus, issueId: 'iM' },
    {
      kind: 'work', estimateItemId: null, trade: '大工', description: '手すり追加', qty: 1, unit: '式', manDays: 0.5, unitPrice: 6000,
      source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null, changeKind: 'extra', stored: stored(6000, 0.5),
    },
  ];
  const issue = (o: Partial<Issue> & Pick<Issue, 'id' | 'body' | 'kind'>): Issue => ({
    siteId: 's1', reportId: 'r-2026-11-05', reportDate: '2026-11-05', status: 'open', doneAt: null,
    instructedBy: null, instructionMethod: null, amountEstimate: null, settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null, estimateSubmittedOn: null, ...o,
  });
  return {
    ...base,
    reports: [base.reports[0], { ...base.reports[1], lines: settledLines }],
    issues: [
      ...base.issues,
      issue({ id: 'iL', body: '玄関収納の追加', kind: 'extra', amountEstimate: 90000, settlementMethod: 'lump_sum', fixedAmount: 100000, fixedOn: '2026-11-08' }),
      issue({ id: 'iD', body: '棚の位置変更（常用）', kind: 'change', settlementMethod: 'daily_rate', dailyRate: 30000 }),
      issue({ id: 'iM', body: '外壁塗装の一部取りやめ', kind: 'minus', settlementMethod: 'lump_sum', fixedAmount: 20000, fixedOn: '2026-11-06' }),
      issue({ id: 'iR', body: '巾木の手直し', kind: 'rework', settlementMethod: 'lump_sum', fixedAmount: 8000 }),
    ],
  };
};

export function settledChangeModel(period: CostReportPeriod = { kind: 'all' }): ChangeLedgerModel {
  return buildChangeLedger(settledInput(), RATES, period);
}

/**
 * 1 つの件が 2 日にまたがる（明細の件ごとのまとめ用）：settledInput に 11/06 の日報を足し、件 i1（11/02-1）に同じ施工内容
 * 「クロス張替え（2 階洋室）」の行（2.0 人工）をもう 1 行。i1 は 11/05（1.5 人工）と 11/06（2.0 人工）で 2 日・3.5 人工。
 */
export const spanningInput = (): CostReportInput => {
  const base = settledInput();
  const [extra] = changeLines.slice(lines.length) as WorkLineSaved[];
  const next: ReportWithLines = { ...report('2026-11-06', 'approved'), lines: [...lines, { ...extra, manDays: 2, stored: stored(36000, 2) }] };
  return { ...base, reports: [...base.reports, next] };
};

export function spanningChangeModel(period: CostReportPeriod = { kind: 'all' }): ChangeLedgerModel {
  return buildChangeLedger(spanningInput(), RATES, period);
}

export function sampleChangeModel(period: CostReportPeriod = { kind: 'all' }): ChangeLedgerModel {
  return buildChangeLedger(changeInput(), RATES, period);
}

/** 変更行 0 件（契約内だけの日報 2 件）。 */
export function emptyChangeModel(): ChangeLedgerModel {
  return buildChangeLedger(costInput(), RATES, { kind: 'all' });
}

export function changeMeta(o: Partial<ChangeReportMeta> = {}): ChangeReportMeta {
  return {
    site,
    company: { name: '株式会社オオホリ建託', contact: 'TEL 000-000-0000' },
    outputAt: NOW.at,
    by: NOW.by,
    reportSpan: { from: '2026-10-20', to: '2026-11-05' },
    ...o,
  };
}
