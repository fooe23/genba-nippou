import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPartnerSupplier, MSG_NOT_PARTNER, type SupplierRoles } from '@/lib/calc/supplier-roles';

// 取引先・協力会社の印をサーバーで読む（Server Actions の検証用）。

/** 会社 ID → 印（is_vendor・is_partner）。ids が空なら読まない。 */
export async function loadSupplierRoles(supabase: SupabaseClient, ids: Iterable<string>): Promise<SupplierRoles> {
  const list = [...new Set([...ids].filter(Boolean))];
  if (list.length === 0) return new Map();
  const { data, error } = await supabase.from('gn_suppliers').select('id, is_vendor, is_partner').in('id', list);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as { id: string; is_vendor: boolean | null; is_partner: boolean | null }[]).map((r) => [
      r.id,
      { isVendor: r.is_vendor !== false, isPartner: r.is_partner === true },
    ]),
  );
}

/** 協力会社の印の無い会社（見つからない会社も）なら文言、協力会社なら null。 */
export async function notPartnerError(supabase: SupabaseClient, supplierId: string): Promise<string | null> {
  const roles = await loadSupplierRoles(supabase, [supplierId]);
  return isPartnerSupplier(roles, supplierId) ? null : MSG_NOT_PARTNER;
}
