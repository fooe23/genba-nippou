import type { BudgetLine } from '@/lib/budget/types';
import { yen } from '@/lib/calc/format';
import { DEFAULT_LABOR_RULE, overtimeRate } from '@/lib/calc/report';
import type { Affiliation, LaborContract, LaborRule } from '@/lib/types';

// 労務費の決まり（純関数。2026-11-17。計画 docs/superpowers/plans/2026-11-10-subcontract-issue-costs.md の Task 5、
// 決めたこと A・D）。原価を出すすべての所（集計・月次・工事原価集計表・日報の帳票・承認待ち・現場の累計原価・
// 日報の本日原価・件の精算・予算と実績）がこの関数で「原価に数える労務費」を出す。
//
// - 区分は行に保存した手の選択「常用／請負」（labor_contract）で決める（読むときに実行予算から決め直さない）。
//   協力会社の行で 'ukeoi' なら請負、それ以外（'jouyou'・null）は常用。自社・所属なし（手入力）は own。
// - 自社・常用の行：保存値（stored.amount ＝ 人工 × 日当 ＋ 残業）のまま。
// - 請負の行：出面（人工）は全部残し、原価は「うち常用の時間」の分だけ。
//     割合 r       = うち常用の時間 ÷ 行の実働（空欄・実働 0 は 0。1 を超えたら 1）
//     常用の人工   = round2(人工 × r)、請負の人工 = 人工 − 常用の人工
//     常用の残業 H = min(行の残業 H, うち常用の時間)
//     単価         = 実行予算のその会社の常用の行（並びの先頭）の単価 → 無ければ行の日当（設定日当の写し）
//     原価         = 円未満四捨五入（単価 × 常用の人工 ＋ 常用の残業 H × 残業単価（作業員の上書き → 単価 × 割増率 ÷ 基準時間））
// DB の amount（労務の行）は出面の金額（人工 × 日当 ＋ 残業）のまま変えない。

/** 原価の計算に使う現場ごとの材料。jouyouRates は会社 id → 実行予算の常用の単価（社員・管理者だけ。協力会社のアカウントには空）。 */
export interface LaborCostContext {
  jouyouRates: Readonly<Record<string, number>>;
  /** 労務の計算設定（残業単価の割増率・基準時間）。 */
  rule: LaborRule;
}

export const EMPTY_LABOR_COST_CONTEXT: LaborCostContext = { jouyouRates: {}, rule: DEFAULT_LABOR_RULE };

/**
 * 実行予算の行から：会社ごとの常用の行（item 'jouyou'）のうち並び（sortOrder → 同じなら id）の先頭の単価。
 * 渡す行の順に依らない（予算と実績の loadBudgetData と、原価の loadLaborCostContexts で同じ行を選ぶ）。
 */
export function laborCostContextFrom(budgetLines: readonly BudgetLine[], rule: LaborRule = DEFAULT_LABOR_RULE): LaborCostContext {
  const best = new Map<string, BudgetLine>();
  for (const b of budgetLines) {
    if (b.item !== 'jouyou' || !b.supplierId) continue;
    const cur = best.get(b.supplierId);
    if (!cur || b.sortOrder < cur.sortOrder || (b.sortOrder === cur.sortOrder && b.id < cur.id)) best.set(b.supplierId, b);
  }
  return { jouyouRates: Object.fromEntries([...best].map(([id, b]) => [id, b.unitPrice])), rule };
}

/** 労務費の決まりに要る行の値（LaborLine ＋ 保存値。日報の画面では計算した値を stored に入れて渡す）。 */
export interface LaborCostLine {
  affiliation?: Affiliation | null;
  supplierId?: string | null;
  laborContract?: LaborContract | null;
  jouyouHours?: number | null;
  dailyRate: number | null;
  overtimeRate: number | null;
  stored: { amount: number; manDays: number; overtimeHours: number; hours: number };
}

export type LaborCostKind = 'own' | 'jouyou' | 'ukeoi';

export interface LaborCostSplit {
  contract: LaborCostKind;
  /** 出面の人工（stored.manDays。区分にかかわらず全部）。 */
  manDays: number;
  /** 原価に数える人工（自社・常用は全部、請負はうち常用の分）。 */
  jouyouManDays: number;
  /** 出面だけの人工（請負の分）。 */
  ukeoiManDays: number;
  /** 請負の行の常用の残業 H（自社・常用の行は 0。保存値の残業をそのまま使うため）。 */
  jouyouOvertimeHours: number;
  /** 原価に数える労務費（円）。 */
  countedCost: number;
}

export function laborContractOf(line: Pick<LaborCostLine, 'affiliation' | 'laborContract'>): LaborCostKind {
  if (line.affiliation !== 'partner') return 'own';
  return line.laborContract === 'ukeoi' ? 'ukeoi' : 'jouyou';
}

// 浮動小数の誤差を落としてから小数 2 桁（calc/report.ts の round2 と同じ）。
function round2(n: number): number {
  return Math.round(Math.round(n * 1e8) / 1e6) / 100;
}
function roundYen(n: number): number {
  return Math.round(Math.round(n * 1e6) / 1e6);
}

export function laborCostSplit(line: LaborCostLine, ctx: LaborCostContext): LaborCostSplit {
  const s = line.stored;
  const contract = laborContractOf(line);
  if (contract !== 'ukeoi') {
    return { contract, manDays: s.manDays, jouyouManDays: s.manDays, ukeoiManDays: 0, jouyouOvertimeHours: 0, countedCost: s.amount };
  }
  const jh = line.jouyouHours ?? null;
  const ratio = jh === null || !(jh > 0) || !(s.hours > 0) ? 0 : Math.min(jh / s.hours, 1);
  const jouyouManDays = round2(s.manDays * ratio);
  const ukeoiManDays = round2(s.manDays - jouyouManDays);
  const jouyouOvertimeHours = ratio === 0 ? 0 : Math.min(s.overtimeHours, jh ?? 0);
  const rate = (line.supplierId ? ctx.jouyouRates[line.supplierId] : undefined) ?? line.dailyRate ?? 0;
  const otRate = jouyouOvertimeHours > 0 ? overtimeRate(rate, line.overtimeRate, ctx.rule) : 0;
  const countedCost = roundYen(rate * jouyouManDays + jouyouOvertimeHours * otRate);
  return { contract, manDays: s.manDays, jouyouManDays, ukeoiManDays, jouyouOvertimeHours, countedCost };
}

export function laborCountedCost(line: LaborCostLine, ctx: LaborCostContext): number {
  return laborCostSplit(line, ctx).countedCost;
}

/**
 * 新しく足す（作業員を選んだ）行の常用・請負の既定（決めたこと A）：協力会社で、その会社が実行予算の請負の行に入っていれば
 * 請負、入っていなければ常用。自社・所属なしは null（区分を持たない）。
 */
export function defaultLaborContract(
  a: { affiliation: Affiliation | null; supplierId: string | null },
  ukeoiSupplierIds: readonly string[],
): LaborContract | null {
  if (a.affiliation !== 'partner') return null;
  return a.supplierId !== null && ukeoiSupplierIds.includes(a.supplierId) ? 'ukeoi' : 'jouyou';
}

const dec = (n: number) => String(Math.round(n * 100) / 100);

/** 日報の作業員の欄の下の小さな文字（社員・管理者だけ）。請負の行だけ。 */
export function laborCostNote(split: LaborCostSplit): string | null {
  if (split.contract !== 'ukeoi') return null;
  if (split.jouyouManDays === 0) return `原価に数える分：なし（請負 ${dec(split.ukeoiManDays)} 人工は出面だけ）`;
  return `原価に数える分：常用 ${dec(split.jouyouManDays)} 人工（${yen(split.countedCost)}）／請負 ${dec(split.ukeoiManDays)} 人工は出面だけ`;
}

/** うち常用の時間が実働を超える行の知らせ（保存は止めない。全部を常用として数える）。 */
export function jouyouHoursWarning(name: string, jouyouHours: number | null | undefined, hours: number): string | null {
  if (jouyouHours === null || jouyouHours === undefined || !(jouyouHours > hours)) return null;
  return `作業員「${name}」：うち常用の時間（${dec(jouyouHours)} H）が実働（${dec(hours)} H）を超えています（全部を常用として数えます）`;
}
