import type { BudgetModelInput } from '@/lib/budget/budget-model';
import type { BudgetData, BudgetLine, ContractItem } from '@/lib/budget/types';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { SavedReportLine } from '@/lib/reports/types';

// 予算と実績の集計のテスト用：中野橋の数字に近い小さな例。
// 工種：ブラスト・塗装・足場・シール。協力会社：〇〇塗装（塗装の請負）、△△工業（ブラストと足場の常用）、□□建設（予算に無い）。

export const T_BLAST = '00000000-0000-4000-8000-0000000000b1';
export const T_PAINT = '00000000-0000-4000-8000-0000000000b2';
export const T_SCAFF = '00000000-0000-4000-8000-0000000000b3';
export const T_SEAL = '00000000-0000-4000-8000-0000000000b4';

export const SP_PAINT = '00000000-0000-4000-8000-0000000000c1'; // 〇〇塗装
export const SP_TWO = '00000000-0000-4000-8000-0000000000c2'; // △△工業
export const SP_NONE = '00000000-0000-4000-8000-0000000000c3'; // □□建設

const time = { start: null, end: null, breakMin: null, gapMin: null };
const stored = (amount: number, manDays = 0) => ({ amount, manDays, overtimeHours: 0 });

export function own(name: string, amount = 20000, manDays = 1): SavedReportLine {
  return { kind: 'labor', workerId: null, workerName: name, time, dailyRate: amount, note: '', overtimeRate: null, affiliation: 'own', supplierId: null, stored: stored(amount, manDays) };
}
export function partner(supplierId: string | null, name: string, amount = 22000, manDays = 1): SavedReportLine {
  return { kind: 'labor', workerId: null, workerName: name, time, dailyRate: amount, note: '', overtimeRate: null, affiliation: 'partner', supplierId, stored: stored(amount, manDays) };
}
export function noAffiliation(name: string, amount = 15000, manDays = 1): SavedReportLine {
  return { kind: 'labor', workerId: null, workerName: name, time, dailyRate: amount, note: '', overtimeRate: null, stored: stored(amount, manDays) };
}
export function work(opts: { tradeId?: string | null; trade?: string; manDays: number; qty?: number | null; unit?: string; description?: string }): SavedReportLine {
  return {
    kind: 'work',
    estimateItemId: null,
    trade: opts.trade ?? '',
    description: opts.description ?? '',
    qty: opts.qty ?? null,
    unit: opts.unit ?? '',
    manDays: opts.manDays,
    unitPrice: null,
    source: 'extra',
    ...EMPTY_WORK_CHANGE,
    siteTradeId: opts.tradeId ?? null,
    stored: stored(0, opts.manDays),
  };
}
export const fuel = (amount: number): SavedReportLine => ({ kind: 'fuel', vehicleId: null, vehicleName: '2t', kmPerL: null, distanceKm: null, pricePerL: null, note: '', stored: stored(amount) });
export const lease = (amount: number): SavedReportLine => ({ kind: 'lease', itemId: null, itemName: '足場材', spec: '', unit: '日', qty: 1, unitPrice: amount, note: '', stored: stored(amount) });
export const cash = (amount: number): SavedReportLine => ({ kind: 'cash', itemName: 'ウエス', spec: '', unit: '袋', qty: 1, unitPrice: amount, vendor: '', stored: stored(amount) });
export const credit = (amount: number): SavedReportLine => ({ kind: 'credit', itemName: '塗料', spec: '', unit: '缶', qty: 1, unitPrice: amount, supplierId: null, vendor: '', stored: stored(amount) });

let seq = 0;
function ci(p: Partial<ContractItem> & Pick<ContractItem, 'qty' | 'unit' | 'unitPrice'>): ContractItem {
  seq += 1;
  return {
    id: `ci-${seq}`,
    section: 'initial',
    name: '',
    spec: '',
    amount: Math.round(p.qty * p.unitPrice),
    tradeId: null,
    category: 'trade',
    sortOrder: seq,
    ...p,
  };
}
function bl(p: Partial<BudgetLine> & Pick<BudgetLine, 'item' | 'qty' | 'unitPrice'>): BudgetLine {
  seq += 1;
  return {
    id: `bl-${seq}`,
    tradeId: null,
    performer: 'own',
    supplierId: null,
    note: '',
    unit: '',
    amount: Math.round(p.qty * p.unitPrice),
    sortOrder: seq,
    ...p,
  };
}

export function nakanoData(): BudgetData {
  return {
    trades: [
      { id: T_BLAST, name: 'ブラスト', sortOrder: 1 },
      { id: T_PAINT, name: '塗装', sortOrder: 2 },
      { id: T_SCAFF, name: '足場', sortOrder: 3 },
      { id: T_SEAL, name: 'シール', sortOrder: 4 },
    ],
    contractItems: [
      ci({ name: '素地調整 1種', qty: 1200, unit: 'm2', unitPrice: 1500, tradeId: T_BLAST }),
      ci({ name: '素地調整 1種（変更）', section: 'change', qty: 300, unit: '㎡', unitPrice: 1500, tradeId: T_BLAST }),
      ci({ name: '重防食塗装', qty: 1500, unit: 'm2', unitPrice: 2000, tradeId: T_PAINT }),
      ci({ name: '塗装 養生', qty: 1, unit: '式', unitPrice: 500000, tradeId: T_PAINT }),
      ci({ name: '足場 架払い', qty: 1, unit: '式', unitPrice: 800000, tradeId: T_SCAFF }),
      ci({ name: 'シール 打替え', qty: 0, unit: 'm', unitPrice: 1200, tradeId: T_SEAL }),
      ci({ name: '雑工事', qty: 1, unit: '式', unitPrice: 50000 }),
      ci({ name: '現場管理費', qty: 1, unit: '式', unitPrice: 300000, category: 'expense' }),
      ci({ name: '出精値引き', qty: 1, unit: '式', unitPrice: -100000, category: 'reduction' }),
    ],
    budgetLines: [
      bl({ tradeId: T_BLAST, item: 'labor', qty: 60, unit: '人工', unitPrice: 20000 }),
      bl({ tradeId: T_BLAST, performer: 'partner', supplierId: SP_TWO, item: 'jouyou', qty: 10, unit: '人工', unitPrice: 22000 }),
      bl({ tradeId: T_PAINT, performer: 'partner', supplierId: SP_PAINT, item: 'subcontract', qty: 1, unit: '式', unitPrice: 2500000 }),
      bl({ tradeId: T_SCAFF, performer: 'partner', supplierId: SP_TWO, item: 'jouyou', qty: 5, unit: '人工', unitPrice: 22000 }),
      bl({ item: 'labor', qty: 2, unit: '人工', unitPrice: 20000 }),
      bl({ item: 'material', qty: 1, unit: '式', unitPrice: 400000 }),
      bl({ item: 'lease', qty: 1, unit: '式', unitPrice: 150000 }),
      bl({ item: 'other', qty: 1, unit: '式', unitPrice: 50000 }),
    ],
    aliases: [{ tradeText: 'ブラスト工', tradeId: T_BLAST }],
    progress: [{ tradeId: T_PAINT, percent: 40, setBy: null, setAt: '2026-10-05T00:00:00Z' }],
    progressTradeIds: [T_PAINT],
  };
}

/**
 * 日報：
 * - 10/01 自社 3 人（ブラスト 3 人工・100 m2）、〇〇塗装 2 人（塗装 2 人工・80 m2、工種は文字「塗装」で名前一致）。
 * - 10/02 自社 2 人、△△工業 1 人。ブラスト（読み替え「ブラスト工」）1 人工・50 ㎡、足場 3 人工、工種の決まらない行 1 人工。燃料・リース。
 * - 10/03 自社 1 人、□□建設 1 人（21000）。ブラスト 2 人工・30 m2、塗装 1 人工・10 m（単位違い）。現金・掛け。
 * - 10/04 自社 1 人。工種の空の行だけ → 全部予算外。
 * - 10/20 自社 1 人・ブラスト 1 人工・500 m2（asOf 10/10 なら数えない）。
 */
export function nakanoInput(overrides: Partial<BudgetModelInput> = {}): BudgetModelInput {
  return {
    data: nakanoData(),
    reports: [
      {
        date: '2026-10-02',
        lines: [
          own('A'), own('B'), partner(SP_TWO, '△△ 1'),
          work({ trade: 'ブラスト工', manDays: 1, qty: 50, unit: '㎡' }),
          work({ tradeId: T_SCAFF, trade: '足場', manDays: 3, qty: null }),
          work({ trade: '片付け（予算外）', manDays: 1 }),
          fuel(3000), lease(5000),
        ],
      },
      {
        date: '2026-10-01',
        lines: [
          own('A'), own('B'), own('C'), partner(SP_PAINT, '〇〇 1'), partner(SP_PAINT, '〇〇 2'),
          work({ tradeId: T_BLAST, trade: 'ブラスト', manDays: 3, qty: 100, unit: 'm2' }),
          work({ trade: ' 塗装 ', manDays: 2, qty: 80, unit: 'ｍ２' }),
        ],
      },
      {
        date: '2026-10-03',
        lines: [
          own('A'), partner(SP_NONE, '□□ 1', 21000, 1),
          work({ tradeId: T_BLAST, manDays: 2, qty: 30, unit: 'M2' }),
          work({ tradeId: T_PAINT, manDays: 1, qty: 10, unit: 'm' }),
          cash(1200), credit(15000),
        ],
      },
      { date: '2026-10-04', lines: [own('A'), work({ trade: '', manDays: 1, description: '清掃' })] },
      { date: '2026-10-20', lines: [own('A'), work({ tradeId: T_BLAST, manDays: 1, qty: 500, unit: 'm2' })] },
    ],
    dailyRate: 20000,
    asOf: '2026-10-10',
    sitePartners: [
      { supplierId: SP_PAINT, name: '〇〇塗装', amount: 2600000 },
      { supplierId: SP_TWO, name: '△△工業', amount: null },
      { supplierId: SP_NONE, name: '□□建設', amount: 300000 },
    ],
    ...overrides,
  };
}
