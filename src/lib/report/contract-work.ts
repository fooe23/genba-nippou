import type { ChangeTotals } from '@/lib/calc/change';
import { EMPTY_SUBCONTRACT_OUTPUT, type SubcontractOutput } from '@/lib/report/subcontract-output';
import type { ChangeKind, SettlementMethod } from '@/lib/types';

// 契約内の作業と、契約外（追加・増・変更・減。精算が必要）の作業を分けて見せるための純関数（日報の画面・PDF で共通）と、
// 作業員と作業内容の人工のずれ・精算の金額の無い行の知らせ。

/** (a) 人工のある作業員がいるのに、作業内容の行が無い。 */
export const MISSING_CONTRACT_WORK_NONE = '作業員の人工がありますが、作業内容が入っていません。契約内の作業を入れてください。';
/** (b) 人工のある作業員がいて、作業内容が追加・増・変更・減の行だけ。 */
export const MISSING_CONTRACT_WORK_ALL_CHANGES =
  '作業内容が追加・変更の行だけです。契約内の作業が入っていないと、作業員の人工が全部その件に付きます。';

/** (c) 作業員の人工の合計と、作業内容の投入人工の合計が合わない。 */
export function manDaysMismatchMessage(workers: number, work: number): string {
  return `作業員の人工（${manDaysText(workers)} 人工）と作業内容の投入人工（${manDaysText(work)} 人工）が合っていません。`;
}

/** 人工の表示（小数 1 桁は必ず付け、2 桁目があれば 2 桁：1 → '1.0'、1.5 → '1.5'、0.25 → '0.25'）。 */
export function manDaysText(n: number): string {
  const two = (Math.round(n * 100) / 100).toFixed(2);
  return two.endsWith('0') ? two.slice(0, -1) : two;
}

/** 区分が契約外（追加・増・変更・減）で、あとで精算が必要な行か。 */
export function needsSettlement(changeKind: ChangeKind): boolean {
  return changeKind !== 'contract';
}

/** 知らせで見る作業内容の行の項目。 */
export interface WorkWarningLine {
  changeKind: ChangeKind;
  description: string;
  manDays: number | null;
  qty: number | null;
  unitPrice: number | null;
}

/** 中身のある作業内容の行か（施工内容がある、投入人工が 0 より大きい、または金額＝数量 × 施工単価がある）。足したばかりの空の行は数えない。 */
export function hasWorkContent(l: Omit<WorkWarningLine, 'changeKind'>): boolean {
  if (l.description.trim() !== '') return true;
  if (l.manDays !== null && Number.isFinite(l.manDays) && l.manDays > 0) return true;
  const amount = (l.qty ?? 0) * (l.unitPrice ?? 0);
  return Number.isFinite(amount) && amount !== 0;
}

/**
 * 作業員の人工に対して、契約内の作業内容が無いときの知らせ（保存は止めない）。
 * laborManDays は作業員の行ごとの人工。人工が 0 より大きい行が 1 つも無ければ出さない。作業内容は中身のある行だけ数える（hasWorkContent）。
 */
export function contractWorkWarning(laborManDays: readonly number[], lines: readonly WorkWarningLine[]): string | null {
  if (!laborManDays.some((d) => Number.isFinite(d) && d > 0)) return null;
  const work = lines.filter(hasWorkContent);
  if (work.length === 0) return MISSING_CONTRACT_WORK_NONE;
  if (work.every((l) => needsSettlement(l.changeKind))) return MISSING_CONTRACT_WORK_ALL_CHANGES;
  return null;
}

/**
 * 作業員の人工の合計（人工が 0 より大きい行だけ）と作業内容の投入人工の合計（空欄は 0）がずれているときの知らせ（保存は止めない）。
 * 作業員の人工が 0・中身のある作業内容の行が無いときは出さない（(a) の知らせのほうを出す）。差が 0.01 人工未満なら出さない。
 */
export function manDaysMismatchWarning(laborManDays: readonly number[], lines: readonly WorkWarningLine[]): string | null {
  const workers = laborManDays.filter((d) => Number.isFinite(d) && d > 0).reduce((s, d) => s + d, 0);
  const work = lines.filter(hasWorkContent);
  if (workers <= 0 || work.length === 0) return null;
  const planned = work.reduce((s, l) => s + (l.manDays !== null && Number.isFinite(l.manDays) ? l.manDays : 0), 0);
  // 浮動小数の誤差（0.1 ＋ 0.2 など）を落としてから比べる
  if (Math.round(Math.abs(workers - planned) * 1e6) / 1e6 < 0.01) return null;
  return manDaysMismatchMessage(workers, planned);
}

/** 作業員と作業内容の知らせ（当てはまるものを全部。(a)・(b) のどちらかと人工のずれ）。無ければ空。 */
export function workWarnings(laborManDays: readonly number[], work: readonly WorkWarningLine[]): string[] {
  return [contractWorkWarning(laborManDays, work), manDaysMismatchWarning(laborManDays, work)].filter((m): m is string => m !== null);
}

/**
 * 追加・増・変更の行で、精算の金額（施工金額＝数量 × 施工単価）が入っていないか。件の精算の労務は施工金額から出すため、
 * 無いと人工 × 日当で仮に出す（src/lib/reports/change-model.ts）。根拠の件の精算の方法が一式・見積・常用なら提案額を使わないので出さない。
 */
export function missingSettlementAmount(
  line: { changeKind: ChangeKind; qty: number | null; unitPrice: number | null },
  issue?: { settlementMethod: SettlementMethod } | null,
): boolean {
  if (line.changeKind === 'contract' || line.changeKind === 'minus') return false;
  if (issue && issue.settlementMethod !== 'undecided') return false;
  return !((line.qty ?? 0) * (line.unitPrice ?? 0) > 0);
}

/**
 * 本日出来高を「契約内」と「追加・変更（精算が必要）」に分ける。total は作業内容の出来高（output_total）、changes は作業内容の
 * 区分ごとの合計（減は負。契約外の行が無ければ null）。sub は外注の支払いのうち出来高に数える分（src/lib/report/subcontract-output.ts。
 * 2026-11-11：件を選んでいない外注は契約内、件を選んだ外注は追加・変更）。
 * 契約内 = 作業内容の合計 − 契約外の合計（net）＋ 契約内の外注。合計は契約内 + 契約外にそのまま戻る。
 */
export function outputBreakdown(
  total: number,
  changes: ChangeTotals | null,
  sub: SubcontractOutput = EMPTY_SUBCONTRACT_OUTPUT,
): { contract: number; changes: number; total: number; subcontractContract: number; subcontractChanges: number } {
  const net = changes?.net ?? 0;
  const subChanges = sub.total - sub.contract;
  return {
    contract: total - net + sub.contract,
    changes: net + subChanges,
    total: total + sub.total,
    subcontractContract: sub.contract,
    subcontractChanges: subChanges,
  };
}
