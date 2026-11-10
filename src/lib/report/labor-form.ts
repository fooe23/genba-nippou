import { laborContractValue, laborRowAffiliation, type StoredLaborAffiliations } from '@/lib/calc/affiliation';
import { laborCostSplit, type LaborCostContext, type LaborCostLine, type LaborCostSplit } from '@/lib/calc/labor-cost';
import type { LaborValues } from '@/lib/calc/report';
import type { Affiliation, LaborLine } from '@/lib/types';

// 日報の画面の作業員の行に労務費の決まり（src/lib/calc/labor-cost.ts）を当てる（2026-11-17）。
// 画面の行は所属の写しをまだ持たない（保存時にサーバーが決める）ので、保存時と同じ規則（laborRowAffiliation・
// laborContractValue）で所属と常用・請負を決めてから、画面で計算した人工・残業・金額を保存値として渡す。

type WorkerAffiliation = { affiliation?: Affiliation; supplierId?: string | null } | undefined;

export function laborCostLineOf(line: LaborLine, v: LaborValues, stored: StoredLaborAffiliations, worker: WorkerAffiliation): LaborCostLine {
  const a = laborRowAffiliation(line, stored, worker);
  return {
    affiliation: a.affiliation,
    supplierId: a.supplierId,
    laborContract: a.affiliation === 'partner' ? laborContractValue(line, stored) : null,
    jouyouHours: line.jouyouHours ?? null,
    dailyRate: line.dailyRate,
    overtimeRate: line.overtimeRate,
    headcount: line.headcount ?? null,
    stored: { amount: v.cost, manDays: v.manDays, overtimeHours: v.overtimeHours, hours: v.hours },
  };
}

export function formLaborSplit(
  line: LaborLine,
  v: LaborValues,
  stored: StoredLaborAffiliations,
  worker: WorkerAffiliation,
  ctx: LaborCostContext,
): LaborCostSplit {
  return laborCostSplit(laborCostLineOf(line, v, stored, worker), ctx);
}
