import type { SiteMoneyFields } from '@/lib/sites/display';

// 現場のお金の列（請負金額・概算金額・常用単価の既定）の読み取りの手伝い。純粋関数（server-only を読まない）。
// DB では authenticated に gn_sites のお金の列の SELECT が無く（update_2026-11-16_site_money.sql）、
// gn_site_money(p_site_ids)（社員・管理者だけ行が返る）で読む。読み取り本体は src/lib/db/sites.ts。

/** お金の項目が無い（協力会社・読めない現場）ときの値。 */
export const NO_SITE_MONEY: SiteMoneyFields = { contractAmount: null, estimatedAmount: null, defaultDailyRate: null };

/** gn_site_money の行（site_id）か、表から直接読んだ行（id）。 */
export interface SiteMoneyRow {
  site_id?: string | null;
  id?: string | null;
  contract_amount?: number | string | null;
  estimated_amount?: number | string | null;
  default_daily_rate?: number | string | null;
}

function num(v: number | string | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** 1 行をお金の項目に直す（numeric は文字列で返ることがあるので数にする）。 */
export function toSiteMoney(r: SiteMoneyRow): SiteMoneyFields {
  return {
    contractAmount: num(r.contract_amount),
    estimatedAmount: num(r.estimated_amount),
    defaultDailyRate: num(r.default_daily_rate),
  };
}

/** 現場 id → お金の項目。site_id（関数の行）か id（表の行）を鍵にする。どちらも無い行は捨てる。 */
export function siteMoneyMap(rows: readonly SiteMoneyRow[] | null | undefined): Map<string, SiteMoneyFields> {
  const map = new Map<string, SiteMoneyFields>();
  for (const r of rows ?? []) {
    const id = r.site_id ?? r.id;
    if (id) map.set(id, toSiteMoney(r));
  }
  return map;
}

/** 現場にお金の項目を重ねる。money に無い現場（読めない・協力会社）は 3 つとも null。 */
export function mergeSiteMoney<T extends { id: string }>(site: T, money: ReadonlyMap<string, SiteMoneyFields>): T & SiteMoneyFields {
  return { ...site, ...(money.get(site.id) ?? NO_SITE_MONEY) };
}

/**
 * 関数がまだ無い（SQL を実行する前）ときのエラーか。PostgREST のスキーマキャッシュに無い（PGRST202）か、
 * Postgres の undefined_function（42883）。それ以外のエラー（権限・通信）は false（呼び出し側で投げる）。
 */
export function isMissingFunctionError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}
