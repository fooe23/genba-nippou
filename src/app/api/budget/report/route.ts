import { todayJst } from '@/lib/calc/format';
import type { BudgetModelInput } from '@/lib/budget/budget-model';
import { budgetReportFileName, buildBudgetReportXlsx } from '@/lib/budget/report-xlsx';
import { loadBudgetModelInput } from '@/lib/db/budget';
import { listSuppliers } from '@/lib/db/masters';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { isUuid } from '@/lib/uuid';

// 予算と実績の集計 Excel（7 シート）。GET /api/budget/report?site=<uuid>
// 社員・管理者だけ（協力会社は 403。金額の表は RLS でも読めない）。今日（日本時間）までの日報で数える。
// 失敗は JSON { ok: false, error }（400 クエリ／401・403 権限／404 現場／500 読み込み・作成失敗）。

export const runtime = 'nodejs';
export const maxDuration = 60;

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const siteId = new URL(request.url).searchParams.get('site') ?? '';
  if (!isUuid(siteId)) return fail(400, '現場の指定が正しくありません');

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (!isEmployeeOrAdmin(profile)) return fail(403, '予算と実績は社員・管理者だけが出力できます');

  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  const today = todayJst();
  let input: BudgetModelInput | null;
  let partners: { id: string; name: string }[];
  try {
    const [loaded, suppliers] = await Promise.all([loadBudgetModelInput(siteId, today), listSuppliers()]);
    input = loaded;
    partners = suppliers.filter((s) => s.isPartner).map((s) => ({ id: s.id, name: s.name }));
  } catch (e) {
    console.error('[budget/report] load', e);
    return fail(500, '予算と実績を読み込めませんでした。時間をおいてやり直してください');
  }
  if (!input) return fail(403, '予算と実績は社員・管理者だけが出力できます');

  let buf: Buffer;
  try {
    buf = await buildBudgetReportXlsx(input, { siteName: site.name, projectNo: site.projectNo, outputAt: new Date().toISOString() }, partners);
  } catch (e) {
    console.error('[budget/report] build', e);
    return fail(500, 'Excel の作成に失敗しました');
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': contentDisposition(budgetReportFileName(site.name, today)),
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}
