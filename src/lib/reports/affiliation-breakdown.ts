import { NO_AFFILIATION_LABEL, OWN_LABEL, UNKNOWN_PARTNER_LABEL, type SupplierNames } from '@/lib/calc/affiliation';
import type { Affiliation } from '@/lib/types';

// 帳票（社内用）の所属別の集計に使う純関数。所属は労務の行の写し（affiliation・supplier_id。保存した日の所属）だけを
// 見る。作業員マスターのいまの所属は使わない（後で所属を変えても過去の集計は動かない）。
// 協力会社は会社（取引先）ごとにまとめる（上下の区別なし）。表示名は 自社／取引先名／所属なし。

export type AffiliationKind = 'own' | 'partner' | 'none';

/** 所属のまとまり。key は 'own'・'none'・'partner:<取引先 ID>'（取引先が無い協力会社は 'partner:'）。 */
export interface AffiliationGroup {
  key: string;
  kind: AffiliationKind;
  supplierId: string | null;
  label: string;
}

/** 所属ごとの人工（変更増減の按分）。 */
export interface AffiliationManDays extends AffiliationGroup {
  manDays: number;
}

/** 労務の行の写しから所属のまとまりを決める。手入力・写しの無い行は所属なし。 */
export function affiliationGroup(
  line: { affiliation?: Affiliation | null; supplierId?: string | null },
  supplierNames: SupplierNames,
): AffiliationGroup {
  if (line.affiliation === 'own') return { key: 'own', kind: 'own', supplierId: null, label: OWN_LABEL };
  if (line.affiliation === 'partner') {
    const supplierId = line.supplierId ?? null;
    return {
      key: `partner:${supplierId ?? ''}`,
      kind: 'partner',
      supplierId,
      label: (supplierId ? supplierNames[supplierId] : undefined) || UNKNOWN_PARTNER_LABEL,
    };
  }
  return NONE_GROUP;
}

export const OWN_GROUP: AffiliationGroup = { key: 'own', kind: 'own', supplierId: null, label: OWN_LABEL };
export const NONE_GROUP: AffiliationGroup = { key: 'none', kind: 'none', supplierId: null, label: NO_AFFILIATION_LABEL };

const KIND_ORDER: Record<AffiliationKind, number> = { own: 0, partner: 1, none: 2 };

/** 並び：自社 → 協力会社（名前順）→ 所属なし。 */
export function compareAffiliation(a: AffiliationGroup, b: AffiliationGroup): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label, 'ja') || a.key.localeCompare(b.key);
}

/**
 * 人工 manDays を、所属ごとの重み（その日の労務の行の人工）の比で分ける（按分の規則はここだけに書く。
 * tests/reports/affiliation-breakdown.test.ts で固定）。
 *
 * - 0.01 人工単位で比例配分し、端数（0.01 未満の切り捨て分）は重みの最も大きい所属に足す（同じ重みなら並びの先）。
 *   最も大きい所属の値は manDays − ほかの所属の和にするので、分けた人工の和は元の人工と一致する。
 * - 重みの合計が 0（その日に労務の行が無い・人工 0）なら全部を所属なしにする。
 * - manDays 0 なら空。戻り値は compareAffiliation の並びで、0 の所属は出さない。
 */
export function apportionManDays(manDays: number, weights: AffiliationManDays[]): AffiliationManDays[] {
  if (manDays === 0) return [];
  const positive = weights.filter((w) => w.manDays > 0);
  const totalWeight = positive.reduce((s, w) => s + w.manDays, 0);
  if (totalWeight <= 0) return [{ ...NONE_GROUP, manDays }];
  // 重みの大きい順（同じなら並びの先）。先頭が端数を受ける
  const sorted = [...positive].sort((a, b) => b.manDays - a.manDays || compareAffiliation(a, b));
  const [largest, ...others] = sorted;
  const parts = others.map((w) => ({ ...w, manDays: Math.floor(((manDays * 100 * w.manDays) / totalWeight) + 1e-9) / 100 }));
  const rest = Math.round((manDays - parts.reduce((s, p) => s + p.manDays, 0)) * 1e9) / 1e9;
  return [{ ...largest, manDays: rest }, ...parts].filter((p) => p.manDays !== 0).sort(compareAffiliation);
}

/** その日（日報 1 件）の労務の行の、所属ごとの人工（按分の重み）。 */
export function dayAffiliationWeights(
  lines: { kind: string; affiliation?: Affiliation | null; supplierId?: string | null; stored: { manDays: number } }[],
  supplierNames: SupplierNames,
): AffiliationManDays[] {
  const map = new Map<string, AffiliationManDays>();
  for (const l of lines) {
    if (l.kind !== 'labor') continue;
    const g = affiliationGroup(l, supplierNames);
    const cur = map.get(g.key);
    if (cur) cur.manDays += l.stored.manDays;
    else map.set(g.key, { ...g, manDays: l.stored.manDays });
  }
  return [...map.values()].sort(compareAffiliation);
}

/** 所属ごとの人工を足し合わせる（並びは compareAffiliation。0 の所属は出さない。浮動小数の誤差は 1e-9 で落とす）。 */
export function sumAffiliationManDays(lists: AffiliationManDays[][]): AffiliationManDays[] {
  const map = new Map<string, AffiliationManDays>();
  for (const list of lists) {
    for (const p of list) {
      const cur = map.get(p.key);
      if (cur) cur.manDays += p.manDays;
      else map.set(p.key, { ...p });
    }
  }
  return [...map.values()]
    .map((p) => ({ ...p, manDays: Math.round(p.manDays * 1e9) / 1e9 }))
    .filter((p) => p.manDays !== 0)
    .sort(compareAffiliation);
}

const MAN_DAYS_FMT = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** 「自社 2.0／〇〇工業 1.5」（人工は小数 1〜2 桁）。所属が無ければ ''。 */
export function affiliationManDaysText(parts: AffiliationManDays[]): string {
  return parts.map((p) => `${p.label} ${MAN_DAYS_FMT.format(Math.round(p.manDays * 100) / 100)}`).join('／');
}
