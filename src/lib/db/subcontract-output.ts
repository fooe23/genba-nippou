import 'server-only';
import { chunk, fetchAllPages } from '@/lib/calc/paging';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { isIssueKind } from '@/lib/report/change-labels';
import { subcontractOutputsByReport, type SubcontractOutput } from '@/lib/report/subcontract-output';
import { createServerSupabase } from '@/lib/supabase/server';
import type { IssueKind } from '@/lib/types';

// 外注の支払いのうち出来高に数える分（2026-11-11。決まりは src/lib/report/subcontract-output.ts）を日報ごとに読む（RLS 前提）。
// 外注の行は社員・管理者だけが読める。協力会社のアカウント（と、プロフィールが読めないとき）は問い合わせずに空を返す
// （出来高に外注は入らず、金額も渡らない）。DB に区分の列が無い（SQL の前。42703）ときも空。

const ID_CHUNK = 200;
const PAGE_SIZE = 1000;

interface SubcontractRow {
  report_id: string;
  amount: number | string | null;
  issue_id: string | null;
}

/** 件の id → 種別（外注の行が根拠に選んだ件だけ。読めない件は入らない）。 */
async function loadIssueKinds(ids: string[]): Promise<Record<string, IssueKind>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return {};
  const supabase = await createServerSupabase();
  const parts = await Promise.all(
    chunk(unique, ID_CHUNK).map(async (part) => {
      const { data, error } = await supabase.from('gn_report_issues').select('id, kind').in('id', part);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; kind: string }[];
    }),
  );
  return Object.fromEntries(parts.flat().flatMap((r) => (isIssueKind(r.kind) ? [[r.id, r.kind] as const] : [])));
}

/**
 * 日報 id ごとの外注の出来高と、外注の行が選んだ件の種別。外注の行の無い日報は map に入らない。
 * 社員・管理者以外には空。
 */
export async function loadSubcontractOutputs(
  reportIds: string[],
): Promise<{ byReport: Map<string, SubcontractOutput>; issueKinds: Record<string, IssueKind> }> {
  const empty = { byReport: new Map<string, SubcontractOutput>(), issueKinds: {} };
  if (reportIds.length === 0) return empty;
  const profile = await getCurrentProfile();
  if (!profile || !isEmployeeOrAdmin(profile)) return empty;
  const supabase = await createServerSupabase();
  let rows: SubcontractRow[];
  try {
    const pages = await Promise.all(
      chunk(reportIds, ID_CHUNK).map((ids) =>
        fetchAllPages<SubcontractRow>(async (from, to) => {
          const { data, error } = await supabase
            .from('gn_report_lines')
            .select('report_id, amount, issue_id')
            .in('report_id', ids)
            .eq('kind', 'credit')
            .eq('purchase_kind', 'subcontract')
            .order('id', { ascending: true }) // ページ境界で重複・欠落しないよう並びを固定する
            .range(from, to);
          if (error) throw Object.assign(new Error(error.message), { code: error.code });
          return (data ?? []) as unknown as SubcontractRow[];
        }, PAGE_SIZE),
      ),
    );
    rows = pages.flat();
  } catch (e) {
    // 区分の列が無い DB（update_2026-11-17_subcontract.sql の前）は外注の行が無い
    if ((e as { code?: string }).code === '42703') return empty;
    throw e;
  }
  if (rows.length === 0) return empty;
  const issueKinds = await loadIssueKinds(rows.flatMap((r) => (r.issue_id ? [r.issue_id] : [])));
  const byReport = subcontractOutputsByReport(
    rows.map((r) => ({ reportId: r.report_id, amount: Number(r.amount ?? 0), issueId: r.issue_id ?? null })),
    issueKinds,
  );
  return { byReport, issueKinds };
}

/** 日報 id → 外注の出来高の合計（集計・現場の画面の累計出来高に足す分）。 */
export function subcontractOutputTotals(byReport: ReadonlyMap<string, SubcontractOutput>): Record<string, number> {
  return Object.fromEntries([...byReport].map(([id, o]) => [id, o.total]));
}
