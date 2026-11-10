// 日報 1 日分の原価（純関数。2026-11-17）。明細の保存値（stored.amount）を区分ごとに足す。
// 日報の見出しの cost_total は外注の買掛を含まない（協力会社も読める列のため。update_2026-11-17_subcontract.sql）ので、
// 原価を見せる所はこの関数で明細から出す（外注の買掛を 1 回だけ入れる）。協力会社のアカウントでは外注の行が RLS で
// 読めないので、同じ関数で外注を含まない合計になる。

export interface DayCost {
  labor: number;
  fuel: number;
  lease: number;
  cash: number;
  /** 仕入の買掛（区分の無い古い行を含む）。 */
  credit: number;
  /** 外注の買掛。 */
  subcontract: number;
  /** 全部の和（作業内容の行は入れない）。 */
  total: number;
}

export interface DayCostLine {
  kind: string;
  purchaseKind?: 'material' | 'subcontract' | null;
  stored: { amount: number };
}

/**
 * 区分ごとの合計。労務の金額は laborCostOf で決める（既定は保存値。第 2 段階で「原価に数える分」に差し替える）。
 * 金額は丸めない（保存値の和）。
 */
export function dayCostOf<L extends DayCostLine>(lines: readonly L[], laborCostOf: (line: L) => number = (l) => l.stored.amount): DayCost {
  const c: DayCost = { labor: 0, fuel: 0, lease: 0, cash: 0, credit: 0, subcontract: 0, total: 0 };
  for (const l of lines) {
    switch (l.kind) {
      case 'labor':
        c.labor += laborCostOf(l);
        break;
      case 'fuel':
        c.fuel += l.stored.amount;
        break;
      case 'lease':
        c.lease += l.stored.amount;
        break;
      case 'cash':
        c.cash += l.stored.amount;
        break;
      case 'credit':
        if (l.purchaseKind === 'subcontract') c.subcontract += l.stored.amount;
        else c.credit += l.stored.amount;
        break;
      default:
        break;
    }
  }
  c.total = c.labor + c.fuel + c.lease + c.cash + c.credit + c.subcontract;
  return c;
}
