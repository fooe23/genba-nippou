import { todayJst } from '@/lib/calc/format';
import { budgetTemplateFileName } from '@/lib/budget/template-format';
import { buildBudgetWorkbook } from '@/lib/budget/template-xlsx';
import { emptyBudgetData, type BudgetData } from '@/lib/budget/types';
import { loadBudgetData } from '@/lib/db/budget';
import { listSuppliers } from '@/lib/db/masters';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { isUuid } from '@/lib/uuid';

// 実行予算・元請けの内訳の Excel 雛形。GET /api/budget/template?site=<uuid>&mode=empty|current
// current＝いまの工種・予算・内訳入り（直して、また取り込める）、empty＝工種だけの空の雛形。
// 社員・管理者だけ（協力会社は 403。金額の表は RLS でも読めない）。失敗は JSON { ok: false, error }。

export const runtime = 'nodejs';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const siteId = params.get('site') ?? '';
  const mode = params.get('mode') ?? 'current';
  if (!isUuid(siteId)) return fail(400, '現場の指定が正しくありません');
  if (mode !== 'empty' && mode !== 'current') return fail(400, '出力の種類が正しくありません');

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (!isEmployeeOrAdmin(profile)) return fail(403, '実行予算・元請けの内訳は社員・管理者だけが出力できます');

  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let data: BudgetData;
  let partners: { id: string; name: string }[];
  try {
    const [loaded, suppliers] = await Promise.all([loadBudgetData(siteId), listSuppliers()]);
    data = mode === 'current' ? loaded : { ...emptyBudgetData(), trades: loaded.trades };
    partners = suppliers.filter((s) => s.isPartner).map((s) => ({ id: s.id, name: s.name }));
  } catch (e) {
    console.error('[budget/template] load', e);
    return fail(500, '実行予算を読み込めませんでした。時間をおいてやり直してください');
  }

  let buf: Buffer;
  try {
    buf = await buildBudgetWorkbook(data, { name: site.name, code: site.projectNo, dailyRate: site.defaultDailyRate }, partners);
  } catch (e) {
    console.error('[budget/template] build', e);
    return fail(500, 'Excel の作成に失敗しました');
  }

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': contentDisposition(budgetTemplateFileName(site.name, mode, todayJst())),
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}
