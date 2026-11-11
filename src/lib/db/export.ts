import 'server-only';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import type { LineRowRead } from '@/lib/report/rows';
import { createServerSupabase } from '@/lib/supabase/server';

// 帳票の読み取りで共通に使う小さな関数（RLS 前提）：氏名と、日報の明細行。

// .in() の URL が長くなりすぎないよう id を分けて問い合わせる（summary.ts と同じ考え方）。
const ID_CHUNK = 200;

/**
 * 指定した id の氏名（無ければメール）。profiles は本人と管理者しか読めない（RLS）ので、DB 関数 gn_profile_names
 * （security definer。supabase/update_2026-11-03d_profile_names.sql）を使う。関数が無い・失敗したときは全員分を空にして続ける。
 */
export async function loadProfileNames(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)];
  const out: Record<string, string> = {};
  if (unique.length === 0) return out;
  try {
    const supabase = await createServerSupabase();
    for (const part of chunk(unique, ID_CHUNK)) {
      const { data, error } = await supabase.rpc('gn_profile_names', { p_ids: part });
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { id: string; display_name: string | null }[]) if (r.display_name) out[r.id] = r.display_name;
    }
  } catch (e) {
    console.error('[loadProfileNames]', e);
    return {};
  }
  return out;
}

/** 指定した日報の明細行（gn_report_lines の全列。日報・並び順）。原価集計表の読み取り（reports-data.ts）でも使う。 */
export async function fetchReportLineRows(reportIds: string[]): Promise<(LineRowRead & { report_id: string })[]> {
  if (reportIds.length === 0) return [];
  const supabase = await createServerSupabase();
  const pages = await Promise.all(
    chunk(reportIds, ID_CHUNK).map((part) =>
      fetchAllPages<LineRowRead & { report_id: string }>(async (rFrom, rTo) => {
        const { data, error } = await supabase
          .from('gn_report_lines')
          .select('*')
          .in('report_id', part)
          .order('report_id', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
          .range(rFrom, rTo);
        if (error) throw new Error(error.message);
        return (data ?? []) as (LineRowRead & { report_id: string })[];
      }),
    ),
  );
  return pages.flat();
}
