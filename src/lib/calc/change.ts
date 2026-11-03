import { amount } from '@/lib/calc/report';
import type { WorkLine } from '@/lib/types';

/** その日の作業内容の 追加・変更・減 の金額（円）。minus は 0 以下、net = extra + change + minus。 */
export interface ChangeTotals { extra: number; change: number; minus: number; net: number; }

/**
 * 作業内容の行を区分ごとに 施工数量 × 施工単価 で足す（契約内は数えない）。
 * 減は数量・金額を正で入れてよい決まりなので、行の符号にかかわらず負で数える（−|金額|）。
 */
export function changeTotals(lines: WorkLine[]): ChangeTotals {
  let extra = 0;
  let change = 0;
  let minus = 0;
  for (const l of lines) {
    const a = amount(l.qty, l.unitPrice);
    if (l.changeKind === 'extra') extra += a;
    else if (l.changeKind === 'change') change += a;
    else if (l.changeKind === 'minus') minus -= Math.abs(a);
  }
  return { extra, change, minus, net: extra + change + minus };
}
