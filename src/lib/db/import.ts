import 'server-only';
import type { ImportCounts, KindCounts } from '@/lib/import/types';
import { createServerSupabase } from '@/lib/supabase/server';

// 取り込み履歴（gn_import_log。RLS で管理者のみ閲覧可）。書き込みは RPC gn_import_masters だけ。

export interface ImportLogEntry {
  id: number;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  fileName: string | null;
  effectiveFrom: string | null;
  counts: ImportCounts;
}

interface ImportLogRow {
  id: number | string;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  file_name: string | null;
  effective_from: string | null;
  counts: unknown;
}

function kindCounts(v: unknown): KindCounts {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);
  return { inserted: n(o.inserted), updated: n(o.updated), unchanged: n(o.unchanged) };
}

/** RPC の返り値・履歴の counts（キーは workers / suppliers / vehicles / lease_items）を ImportCounts にする。 */
export function toImportCounts(v: unknown): ImportCounts {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    workers: kindCounts(o.workers),
    suppliers: kindCounts(o.suppliers),
    vehicles: kindCounts(o.vehicles),
    leaseItems: kindCounts(o.lease_items),
  };
}

/** 新しい順に最大 limit 件。テーブルが無い（SQL 未適用）・読めないときは空。 */
export async function listImportLog(limit = 50): Promise<ImportLogEntry[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from('gn_import_log')
      .select('id, created_at, actor_name, actor_email, file_name, effective_from, counts')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[gn_import_log]', error.message);
      return [];
    }
    return ((data ?? []) as ImportLogRow[]).map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      actorName: r.actor_name,
      actorEmail: r.actor_email,
      fileName: r.file_name,
      effectiveFrom: r.effective_from,
      counts: toImportCounts(r.counts),
    }));
  } catch (e) {
    console.error('[gn_import_log]', e);
    return [];
  }
}
