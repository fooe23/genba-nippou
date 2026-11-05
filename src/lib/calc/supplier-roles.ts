// 取引先（買掛の相手先）と協力会社（作業員の所属）の区別（2026-11-06。純関数。画面とサーバーの両方から使う）。
// どちらも gn_suppliers の行で、is_vendor（取引先）・is_partner（協力会社）の印で分ける。両方に印が付いた会社もある。
// 外注の作業員は買掛にしないので、協力会社だけの会社は買掛（日報の買掛の行・現場の取引先）の選択肢に出さない。

export const MSG_NOT_PARTNER = '協力会社として登録された会社を選んでください';
export const MSG_NOT_VENDOR = '協力会社は買掛にできません。作業員の行で記録してください';

/** 会社 ID → 印。DB から読めなかった会社は入らない。 */
export type SupplierRoles = ReadonlyMap<string, { isVendor: boolean; isPartner: boolean }>;

interface RoleItem { id: string; active: boolean; isVendor: boolean; isPartner: boolean; }

/**
 * 協力会社の選択肢（作業員の所属・現場の協力会社・協力会社アカウントの会社）：有効な協力会社＋いま選んでいる会社
 * （無効になった・協力会社の印を外した会社でも、いまの値は消さない）。並びはそのまま。
 */
export function partnerChoices<T extends RoleItem>(suppliers: T[], currentId: string | null | undefined = null): T[] {
  return suppliers.filter((s) => (s.active && s.isPartner) || (!!currentId && s.id === currentId));
}

/**
 * 買掛の相手先の候補（日報の買掛の行・現場の取引先の選択）：取引先の印のある会社＋すでに使っている会社（keepIds。
 * その日報の買掛の行・現場で選択済みの会社）。有効・無効の絞り込みはしない（呼び出し側の forSite などが行う）。
 */
export function vendorSuppliers<T extends { id: string; isVendor: boolean }>(suppliers: T[], keepIds: Iterable<string> = []): T[] {
  const keep = new Set(keepIds);
  return suppliers.filter((s) => s.isVendor || keep.has(s.id));
}

/**
 * 新しく買掛の相手先にしようとしている、取引先の印の無い会社（ID の重複なし、順はそのまま）。
 * keepIds（その日報に保存済みの買掛の行・現場で選択済みの会社）は、印を外した後でも保存し直せるように対象外。
 * roles に無い会社（読めなかった）は判断できないので対象外（DB の制約は付けない。寛容にする）。
 */
export function nonVendorAdditions(ids: Iterable<string>, roles: SupplierRoles, keepIds: Iterable<string> = []): string[] {
  const keep = new Set(keepIds);
  const out: string[] = [];
  for (const id of ids) {
    if (!id || keep.has(id) || out.includes(id)) continue;
    if (roles.get(id)?.isVendor === false) out.push(id);
  }
  return out;
}

/** 日報の買掛の行の会社の検証：新しく協力会社だけの会社を買掛にしていれば文言、問題なければ null。 */
export function creditSupplierError(creditSupplierIds: Iterable<string>, roles: SupplierRoles, storedIds: Iterable<string>): string | null {
  return nonVendorAdditions(creditSupplierIds, roles, storedIds).length > 0 ? MSG_NOT_VENDOR : null;
}

/** 協力会社の印のある会社か（読めなかった会社は false）。 */
export function isPartnerSupplier(roles: SupplierRoles, id: string): boolean {
  return roles.get(id)?.isPartner === true;
}
