import { yen } from '@/lib/calc/format';

// 日報の外注の買掛の行の「請負の進み」（2026-11-11 利用者。設計書の追記。純関数）。
// 外注の行で工種と支払先（協力会社）を選ぶと、行の下に
//   「{工種}・{会社}の請負額 ¥270,000（実行予算）／これまでの支払い ¥100,000 ＋ 今回 ¥170,000 ＝ ¥270,000（出来高 100%）」
// を出す。予算と実績（src/lib/budget/budget-model.ts）の請負の行と同じ数え方：
// - 請負額 ＝ 実行予算の請負の行（item 'subcontract'）のその工種 × その会社の金額の合計。無ければ「実行予算に請負額がありません」。
// - これまでの支払い ＝ この日より前のほかの日報の、同じ工種 × 会社の外注の行（根拠の件なし）の合計 ＋ この日報で上にある同じ
//   工種 × 会社の外注の行（根拠の件なし）。
// - 根拠の件を選んだ外注の行は「追加の発注（件：…）」として、出来高の % にも これまでの支払い にも入れない。
// - 累計が請負額を超えたら知らせる（保存は止めない）。
// 請負額・支払いは社員・管理者だけに渡す（協力会社のアカウントには外注の行も来ない）。

/** 工種 × 会社の鍵。 */
export function subcontractKey(tradeId: string, supplierId: string): string {
  return `${tradeId}|${supplierId}`;
}

/** 日報の画面に渡す、請負額と これまでの支払い（鍵は subcontractKey）。 */
export interface SubcontractBudgetView {
  contracts: Record<string, number>;
  paidBefore: Record<string, number>;
}

/** 実行予算の請負の行を 工種 × 会社 で足す（工種・会社の無い行は数えない）。 */
export function subcontractContracts(
  lines: readonly { item: string; tradeId: string | null; supplierId: string | null; amount: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (l.item !== 'subcontract' || !l.tradeId || !l.supplierId || !Number.isFinite(l.amount)) continue;
    const k = subcontractKey(l.tradeId, l.supplierId);
    out[k] = (out[k] ?? 0) + l.amount;
  }
  return out;
}

/** ほかの日報の外注の行（根拠の件なし）を 工種 × 会社 で足す。 */
export function subcontractPaidBefore(
  rows: readonly { siteTradeId: string | null; supplierId: string | null; issueId: string | null; amount: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.siteTradeId || !r.supplierId || r.issueId || !Number.isFinite(r.amount)) continue;
    const k = subcontractKey(r.siteTradeId, r.supplierId);
    out[k] = (out[k] ?? 0) + r.amount;
  }
  return out;
}

/** 日報の画面の外注の行（区分・工種・支払先・根拠の件・支払金額）。 */
export interface SubcontractProgressLine {
  purchaseKind: string;
  siteTradeId: string | null;
  supplierId: string | null;
  issueId: string | null;
  amount: number;
}

export type SubcontractProgress =
  | { kind: 'issue'; issueId: string }
  | { kind: 'noContract'; key: string }
  | { kind: 'contract'; key: string; contract: number; before: number; current: number; total: number; percent: number; over: boolean };

/**
 * 行ごとの請負の進み（外注で工種と支払先を選んだ行だけ。ほかの行は null）。
 * lines は日報の買掛の行の並び（上の行から これまでの支払い に足す）。
 */
export function subcontractProgress(lines: readonly SubcontractProgressLine[], view: SubcontractBudgetView): (SubcontractProgress | null)[] {
  const sameReport: Record<string, number> = {};
  return lines.map((l) => {
    if (l.purchaseKind !== 'subcontract' || !l.siteTradeId || !l.supplierId) return null;
    if (l.issueId) return { kind: 'issue', issueId: l.issueId };
    const key = subcontractKey(l.siteTradeId, l.supplierId);
    const current = Number.isFinite(l.amount) ? l.amount : 0;
    const before = (view.paidBefore[key] ?? 0) + (sameReport[key] ?? 0);
    sameReport[key] = (sameReport[key] ?? 0) + current;
    const contract = view.contracts[key];
    if (contract === undefined || contract <= 0) return { kind: 'noContract', key };
    const total = before + current;
    return { kind: 'contract', key, contract, before, current, total, percent: (total / contract) * 100, over: total > contract };
  });
}

/** 出来高の %（10 以上は整数、10 未満は小数 1 桁）。 */
function pctText(p: number): string {
  const v = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${v}%`;
}

/** 行の下の文（工種・会社の名前つき）。 */
export function subcontractProgressText(p: SubcontractProgress, names: { trade: string; supplier: string; issue?: string }): string {
  if (p.kind === 'issue') return `追加の発注（件：${names.issue ?? '（一覧に無い件）'}）。請負額の出来高には数えません`;
  if (p.kind === 'noContract') return `${names.trade}・${names.supplier}：実行予算に請負額がありません`;
  return `${names.trade}・${names.supplier}の請負額 ${yen(p.contract)}（実行予算）／これまでの支払い ${yen(p.before)} ＋ 今回 ${yen(p.current)} ＝ ${yen(p.total)}（出来高 ${pctText(p.percent)}）`;
}

/** 累計が請負額を超えたときの知らせ（保存は止めない）。 */
export function subcontractOverWarning(p: SubcontractProgress, names: { trade: string; supplier: string }): string | null {
  if (p.kind !== 'contract' || !p.over) return null;
  return `${names.trade}・${names.supplier}の支払いの累計 ${yen(p.total)} が請負額 ${yen(p.contract)} を超えています（${yen(p.total - p.contract)}）`;
}

/** 「今回の出来高 ○%」→ 支払金額（円未満四捨五入）。% が空・負・数でなければ null。 */
export function amountFromPercent(contract: number, percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent) || percent < 0) return null;
  return Math.round(Math.round(((contract * percent) / 100) * 1e6) / 1e6);
}
