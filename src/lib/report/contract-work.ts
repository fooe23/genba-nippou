import type { ChangeTotals } from '@/lib/calc/change';
import type { ChangeKind } from '@/lib/types';

// 契約内の作業と、契約外（追加・増・変更・減。精算が必要）の作業を分けて見せるための純関数（日報の画面・PDF で共通）。

/** (a) 人工のある作業員がいるのに、作業内容の行が無い。 */
export const MISSING_CONTRACT_WORK_NONE = '作業員の人工がありますが、作業内容が入っていません。契約内の作業を入れてください。';
/** (b) 人工のある作業員がいて、作業内容が追加・増・変更・減の行だけ。 */
export const MISSING_CONTRACT_WORK_ALL_CHANGES =
  '作業内容が追加・変更の行だけです。契約内の作業が入っていないと、作業員の人工が全部その件に付きます。';

/** 区分が契約外（追加・増・変更・減）で、あとで精算が必要な行か。 */
export function needsSettlement(changeKind: ChangeKind): boolean {
  return changeKind !== 'contract';
}

/**
 * 作業員の人工に対して、契約内の作業内容が無いときの知らせ（保存は止めない）。
 * laborManDays は作業員の行ごとの人工。人工が 0 より大きい行が 1 つも無ければ出さない。
 */
export function contractWorkWarning(laborManDays: readonly number[], work: readonly { changeKind: ChangeKind }[]): string | null {
  if (!laborManDays.some((d) => Number.isFinite(d) && d > 0)) return null;
  if (work.length === 0) return MISSING_CONTRACT_WORK_NONE;
  if (work.every((l) => needsSettlement(l.changeKind))) return MISSING_CONTRACT_WORK_ALL_CHANGES;
  return null;
}

/**
 * 本日出来高を「契約内」と「追加・変更（精算が必要）」に分ける。changes は区分ごとの合計（減は負。契約外の行が無ければ null）。
 * 契約内 = 合計 − 契約外の合計（net）。合計は契約内 + 契約外にそのまま戻る。
 */
export function outputBreakdown(total: number, changes: ChangeTotals | null): { contract: number; changes: number; total: number } {
  const net = changes?.net ?? 0;
  return { contract: total - net, changes: net, total };
}
