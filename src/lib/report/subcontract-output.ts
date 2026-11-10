import type { ChangeTotals } from '@/lib/calc/change';
import { settlementCategory } from '@/lib/report/change-labels';
import type { IssueKind } from '@/lib/types';

// 外注の支払い（外注の買掛。2026-11-17）を出来高に入れる決まり（2026-11-11 利用者。純関数。画面・帳票・集計で共通）。
//   件を選んでいない外注 … 契約内の出来高に支払金額で入れる
//   件を選んだ外注     … 追加・変更（精算が必要）の、その件の区分（追加・増・変更。客先都合・その他・現場判断は追加）に入れる
//   減・やり直しの件、読めない件を選んだ外注は数えない（件の精算 src/lib/reports/change-model.ts と同じ）
// 外注の行は社員・管理者だけが読める（RLS）。協力会社のアカウントには行が来ないので、出来高に外注は入らない。

/** 外注の支払いのうち出来高に数える分（total = contract + extra + increase + change）。 */
export interface SubcontractOutput { contract: number; extra: number; increase: number; change: number; total: number; }

export const EMPTY_SUBCONTRACT_OUTPUT: Readonly<SubcontractOutput> = Object.freeze({ contract: 0, extra: 0, increase: 0, change: 0, total: 0 });

/** 外注の 1 行（支払金額と根拠の件）。 */
export interface SubcontractOutputLine { amount: number; issueId: string | null; }

/** 件の id → 種別。 */
export type IssueKindLookup = ReadonlyMap<string, IssueKind> | Readonly<Record<string, IssueKind>>;

function kindOf(lookup: IssueKindLookup, id: string): IssueKind | undefined {
  if (lookup instanceof Map) return lookup.get(id);
  return Object.prototype.hasOwnProperty.call(lookup, id) ? (lookup as Record<string, IssueKind>)[id] : undefined;
}

/** 件の一覧から 件の id → 種別。 */
export function issueKindMap(issues: readonly { id: string; kind: IssueKind }[]): Map<string, IssueKind> {
  return new Map(issues.map((i) => [i.id, i.kind]));
}

/** 外注の 1 行を出来高のどこに数えるか（契約内・追加・増・変更）。数えないなら null。 */
export function subcontractOutputCategory(issueId: string | null, kinds: IssueKindLookup): 'contract' | 'extra' | 'increase' | 'change' | null {
  if (issueId === null) return 'contract';
  const kind = kindOf(kinds, issueId);
  if (kind === undefined) return null;
  const category = settlementCategory(kind);
  return category === null || category === 'minus' ? null : category;
}

/** 外注の行を足す。 */
export function subcontractOutput(lines: readonly SubcontractOutputLine[], kinds: IssueKindLookup): SubcontractOutput {
  const out: SubcontractOutput = { ...EMPTY_SUBCONTRACT_OUTPUT };
  for (const l of lines) {
    const category = subcontractOutputCategory(l.issueId, kinds);
    if (category === null || !Number.isFinite(l.amount)) continue;
    out[category] += l.amount;
    out.total += l.amount;
  }
  return out;
}

/** 日報の明細から外注の買掛の行（支払金額・根拠の件）を取り出す。amountOf は行の金額（保存値・画面の数量 × 単価）。 */
export function subcontractOutputLines<L extends { kind: string; purchaseKind?: string; issueId?: string | null }>(
  lines: readonly L[],
  amountOf: (line: L) => number,
): SubcontractOutputLine[] {
  return lines.flatMap((l) => (l.kind === 'credit' && l.purchaseKind === 'subcontract' ? [{ amount: amountOf(l), issueId: l.issueId ?? null }] : []));
}

/** 日報 id ごとの外注の出来高（集計・現場の画面で、外注の行を日報をまたいで読んだとき）。 */
export function subcontractOutputsByReport(
  rows: readonly (SubcontractOutputLine & { reportId: string })[],
  kinds: IssueKindLookup,
): Map<string, SubcontractOutput> {
  const byReport = new Map<string, SubcontractOutputLine[]>();
  for (const r of rows) {
    const list = byReport.get(r.reportId) ?? [];
    list.push({ amount: r.amount, issueId: r.issueId });
    byReport.set(r.reportId, list);
  }
  return new Map([...byReport].map(([id, list]) => [id, subcontractOutput(list, kinds)]));
}

/** 作業内容の区分ごとの金額（減は負）に、件を選んだ外注を足す。どちらも無ければ null。 */
export function changesWithSubcontract(changes: ChangeTotals | null, sub: SubcontractOutput): ChangeTotals | null {
  const subChanges = sub.extra + sub.increase + sub.change;
  if (changes === null && subChanges === 0) return null;
  const c = changes ?? { extra: 0, increase: 0, change: 0, minus: 0, net: 0 };
  return {
    extra: c.extra + sub.extra,
    increase: c.increase + sub.increase,
    change: c.change + sub.change,
    minus: c.minus,
    net: c.net + subChanges,
  };
}

/**
 * 実行予算の請負の行（項目 'subcontract'）を会社ごとに足す（工種をまたぐ。工事原価集計表 ④-2 の請負金額。2026-11-11）。
 * 会社の無い行・ほかの項目は数えない。
 */
export function budgetSubcontractAmounts(lines: readonly { item: string; supplierId: string | null; amount: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (l.item !== 'subcontract' || !l.supplierId || !Number.isFinite(l.amount)) continue;
    out[l.supplierId] = (out[l.supplierId] ?? 0) + l.amount;
  }
  return out;
}
