import { describe, expect, it } from 'vitest';
import {
  defaultLaborContract,
  EMPTY_LABOR_COST_CONTEXT,
  laborContractOf,
  laborCostContextFrom,
  laborCostNote,
  laborCostSplit,
  laborCountedCost,
  jouyouHoursWarning,
  type LaborCostLine,
} from '@/lib/calc/labor-cost';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import type { BudgetLine } from '@/lib/budget/types';

// 村山様邸の例（設計書 §4・計画 Task 5）。東北建興＝請負の会社、△△工業＝常用の会社、大江＝自社。
const TOHOKU = 'sup-tohoku';
const MARUMARU = 'sup-marumaru';

const ctx = EMPTY_LABOR_COST_CONTEXT;

function partner(
  supplierId: string,
  laborContract: 'jouyou' | 'ukeoi' | null,
  opts: { hours?: number; manDays?: number; overtimeHours?: number; amount?: number; dailyRate?: number | null; jouyouHours?: number | null; overtimeRate?: number | null } = {},
): LaborCostLine {
  const manDays = opts.manDays ?? 1;
  const dailyRate = opts.dailyRate === undefined ? 22000 : opts.dailyRate;
  return {
    affiliation: 'partner',
    supplierId,
    laborContract,
    jouyouHours: opts.jouyouHours ?? null,
    dailyRate,
    overtimeRate: opts.overtimeRate ?? null,
    stored: { amount: opts.amount ?? (dailyRate ?? 0) * manDays, manDays, overtimeHours: opts.overtimeHours ?? 0, hours: opts.hours ?? 8 },
  };
}

const budgetLine = (b: Partial<BudgetLine>): BudgetLine => ({
  id: b.id ?? 'b1',
  tradeId: b.tradeId ?? 't1',
  performer: b.performer ?? 'partner',
  supplierId: b.supplierId ?? null,
  item: b.item ?? 'jouyou',
  note: '',
  qty: b.qty ?? 1,
  unit: b.unit ?? '人工',
  unitPrice: b.unitPrice ?? 0,
  amount: b.amount ?? 0,
  sortOrder: b.sortOrder ?? 0,
});

describe('労務費の決まり（請負の会社の人工は原価に数えない。うち常用の時間の分だけ）', () => {
  it('A さん：東北建興・請負・実働 8.0 H・1.0 人工・うち常用 4.0 H → 常用 0.5 人工 @¥22,000 = ¥11,000', () => {
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi', { jouyouHours: 4 }), ctx);
    expect(s).toEqual({ contract: 'ukeoi', manDays: 1, jouyouManDays: 0.5, ukeoiManDays: 0.5, jouyouOvertimeHours: 0, countedCost: 11000 });
  });

  it('B さん：請負・うち常用 空欄 → 原価 ¥0、出面は 1.0 人工のまま', () => {
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi'), ctx);
    expect(s).toMatchObject({ contract: 'ukeoi', manDays: 1, jouyouManDays: 0, ukeoiManDays: 1, countedCost: 0 });
  });

  it('C さん：△△工業・常用 1.0 人工 → 保存値 ¥22,000（うち常用の時間は見ない）。区分 null の協力会社も常用', () => {
    expect(laborCostSplit(partner(MARUMARU, 'jouyou', { jouyouHours: 2 }), ctx)).toMatchObject({
      contract: 'jouyou',
      manDays: 1,
      jouyouManDays: 1,
      ukeoiManDays: 0,
      countedCost: 22000,
    });
    expect(laborCostSplit(partner(MARUMARU, null), ctx)).toMatchObject({ contract: 'jouyou', countedCost: 22000 });
  });

  it('実行予算で請負に入っている会社でも、保存した区分が常用の行は常用（読むときに実行予算を見ない）', () => {
    const budgetCtx = laborCostContextFrom([budgetLine({ supplierId: TOHOKU, item: 'subcontract', unit: '式', amount: 270000 })]);
    expect(laborCostSplit(partner(TOHOKU, 'jouyou'), budgetCtx)).toMatchObject({ contract: 'jouyou', countedCost: 22000 });
  });

  it('大江（自社 1.0 人工 ¥20,000）→ own、¥20,000。所属なし（手入力）も own', () => {
    const own: LaborCostLine = { affiliation: 'own', supplierId: null, laborContract: null, jouyouHours: 4, dailyRate: 20000, overtimeRate: null, stored: { amount: 20000, manDays: 1, overtimeHours: 0, hours: 8 } };
    expect(laborCostSplit(own, ctx)).toEqual({ contract: 'own', manDays: 1, jouyouManDays: 1, ukeoiManDays: 0, jouyouOvertimeHours: 0, countedCost: 20000 });
    expect(laborContractOf({ ...own, affiliation: null })).toBe('own');
    // 請負を選んだ行でも、所属が協力会社でなければ own（区分は協力会社の行だけ意味を持つ）
    expect(laborContractOf({ ...own, laborContract: 'ukeoi' })).toBe('own');
  });

  it('実行予算に東北建興の常用の行（並びの先頭 ¥25,000）がある → A さん ¥12,500', () => {
    const budgetCtx = laborCostContextFrom([
      budgetLine({ id: 'b2', supplierId: TOHOKU, unitPrice: 30000, sortOrder: 5 }),
      budgetLine({ id: 'b1', supplierId: TOHOKU, unitPrice: 25000, sortOrder: 1 }),
      budgetLine({ id: 'b3', supplierId: TOHOKU, item: 'subcontract', unitPrice: 999999, sortOrder: 0 }),
    ]);
    expect(budgetCtx.jouyouRates).toEqual({ [TOHOKU]: 25000 });
    expect(laborCountedCost(partner(TOHOKU, 'ukeoi', { jouyouHours: 4 }), budgetCtx)).toBe(12500);
  });

  it('常用の行の並びが同じなら id の小さい行（渡す順に依らない。予算と実績・原価の読み込みで同じ行を選ぶ）', () => {
    const lines = [
      budgetLine({ id: 'b9', supplierId: TOHOKU, unitPrice: 30000, sortOrder: 1 }),
      budgetLine({ id: 'b2', supplierId: TOHOKU, unitPrice: 25000, sortOrder: 1 }),
    ];
    expect(laborCostContextFrom(lines).jouyouRates).toEqual({ [TOHOKU]: 25000 });
    expect(laborCostContextFrom([...lines].reverse()).jouyouRates).toEqual({ [TOHOKU]: 25000 });
  });

  it('残業：実働 10.0 H・1.0 人工・残業 2.0 H・日当 ¥22,000・うち常用 3.0 H → 6,600 ＋ 2.0 H × ¥3,438 ＝ ¥13,476', () => {
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi', { hours: 10, overtimeHours: 2, jouyouHours: 3, amount: 22000 + 2 * 3438 }), ctx);
    expect(s).toEqual({ contract: 'ukeoi', manDays: 1, jouyouManDays: 0.3, ukeoiManDays: 0.7, jouyouOvertimeHours: 2, countedCost: 13476 });
  });

  it('残業の割増は常用の時間の分まで：残業 2.0 H でうち常用 1.0 H → 常用の残業 1.0 H', () => {
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi', { hours: 10, overtimeHours: 2, jouyouHours: 1 }), ctx);
    expect(s.jouyouOvertimeHours).toBe(1);
    expect(s.countedCost).toBe(Math.round(22000 * 0.1 + 1 * 3438));
  });

  it('作業員の残業単価 ¥3,000 の上書きがあればそれを使う', () => {
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi', { hours: 10, overtimeHours: 2, jouyouHours: 3, overtimeRate: 3000 }), ctx);
    expect(s.countedCost).toBe(6600 + 6000);
  });

  it('うち常用の時間が実働より大きい → 割合 1（全部が常用）。実働 0 → 割合 0', () => {
    expect(laborCostSplit(partner(TOHOKU, 'ukeoi', { jouyouHours: 12 }), ctx)).toMatchObject({ jouyouManDays: 1, ukeoiManDays: 0, countedCost: 22000 });
    expect(laborCostSplit(partner(TOHOKU, 'ukeoi', { hours: 0, manDays: 0, jouyouHours: 4 }), ctx)).toMatchObject({ jouyouManDays: 0, countedCost: 0 });
  });

  it('請負の会社で日当も常用の単価も無い → 原価 ¥0', () => {
    expect(laborCountedCost(partner(TOHOKU, 'ukeoi', { dailyRate: null, jouyouHours: 4 }), ctx)).toBe(0);
  });

  it('労務の設定（基準時間・割増率）は ctx の rule を使う', () => {
    const rule = { ...DEFAULT_LABOR_RULE, overtimeMultiplier: 1.5 };
    const s = laborCostSplit(partner(TOHOKU, 'ukeoi', { hours: 10, overtimeHours: 2, jouyouHours: 3 }), laborCostContextFrom([], rule));
    expect(s.countedCost).toBe(6600 + 2 * Math.round((22000 * 1.5) / 8));
  });

  it('1 日：A・B・C・大江 → 労務費 ¥20,000 ＋ ¥11,000 ＋ ¥0 ＋ ¥22,000 ＝ ¥53,000、出面 4.0 人工', () => {
    const own: LaborCostLine = { affiliation: 'own', supplierId: null, laborContract: null, dailyRate: 20000, overtimeRate: null, stored: { amount: 20000, manDays: 1, overtimeHours: 0, hours: 8 } };
    const lines = [own, partner(TOHOKU, 'ukeoi', { jouyouHours: 4 }), partner(TOHOKU, 'ukeoi'), partner(MARUMARU, 'jouyou')];
    const splits = lines.map((l) => laborCostSplit(l, ctx));
    expect(splits.reduce((s, x) => s + x.countedCost, 0)).toBe(53000);
    expect(splits.reduce((s, x) => s + x.manDays, 0)).toBe(4);
  });
});

describe('新しい協力会社の作業員の行の区分の既定（実行予算に請負の行がある会社 → 請負）', () => {
  it('請負の会社 → ukeoi、それ以外の協力会社 → jouyou、自社・所属なし → null', () => {
    expect(defaultLaborContract({ affiliation: 'partner', supplierId: TOHOKU }, [TOHOKU])).toBe('ukeoi');
    expect(defaultLaborContract({ affiliation: 'partner', supplierId: MARUMARU }, [TOHOKU])).toBe('jouyou');
    expect(defaultLaborContract({ affiliation: 'partner', supplierId: null }, [TOHOKU])).toBe('jouyou');
    expect(defaultLaborContract({ affiliation: 'own', supplierId: null }, [TOHOKU])).toBeNull();
    expect(defaultLaborContract({ affiliation: null, supplierId: null }, [TOHOKU])).toBeNull();
  });
});

describe('画面の小さな文字（原価に数える分）', () => {
  it('請負：常用 0.5 人工（¥11,000）／請負 0.5 人工は出面だけ', () => {
    expect(laborCostNote(laborCostSplit(partner(TOHOKU, 'ukeoi', { jouyouHours: 4 }), ctx))).toBe('原価に数える分：常用 0.5 人工（¥11,000）／請負 0.5 人工は出面だけ');
    expect(laborCostNote(laborCostSplit(partner(TOHOKU, 'ukeoi'), ctx))).toBe('原価に数える分：なし（請負 1 人工は出面だけ）');
  });
  it('常用・自社は文字なし', () => {
    expect(laborCostNote(laborCostSplit(partner(MARUMARU, 'jouyou'), ctx))).toBeNull();
  });
});

describe('うち常用の時間が実働を超える知らせ', () => {
  it('超えていれば文言、超えていなければ null', () => {
    expect(jouyouHoursWarning('A', 9, 8)).toBe('作業員「A」：うち常用の時間（9 H）が実働（8 H）を超えています（全部を常用として数えます）');
    expect(jouyouHoursWarning('A', 8, 8)).toBeNull();
    expect(jouyouHoursWarning('A', null, 8)).toBeNull();
  });
});
