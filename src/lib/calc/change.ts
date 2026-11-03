import { workAmount } from '@/lib/calc/report';
import type { WorkLine } from '@/lib/types';

/**
 * その日の作業内容の 追加・増・変更・減 の金額（円）。minus は減の行の金額（workAmount。正で入れた行は負）の合計、
 * net = extra + increase + change + minus。
 */
export interface ChangeTotals { extra: number; increase: number; change: number; minus: number; net: number; }

/**
 * 作業内容の行を区分ごとに金額（workAmount）で足す（契約内は数えない）。
 * 減は数量・単価を正で入れる決まりで、workAmount が負（−数量 × 単価）を返す（DB の保存値 amount と同じ）ので、
 * 減の合計はその負の金額をそのまま足したもの。
 */
export function changeTotals(lines: WorkLine[]): ChangeTotals {
  let extra = 0;
  let increase = 0;
  let change = 0;
  let minus = 0;
  for (const l of lines) {
    const a = workAmount(l);
    if (l.changeKind === 'extra') extra += a;
    else if (l.changeKind === 'increase') increase += a;
    else if (l.changeKind === 'change') change += a;
    else if (l.changeKind === 'minus') minus += a;
  }
  return { extra, increase, change, minus, net: extra + increase + change + minus };
}
