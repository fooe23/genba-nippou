import { todayJst } from '@/lib/calc/format';
import { buildBudgetModel } from '@/lib/budget/budget-model';
import { budgetReportFileName } from '@/lib/budget/report-xlsx';
import { loadBudgetData, loadBudgetModelInput } from '@/lib/db/budget';
import { listSuppliers } from '@/lib/db/masters';
import { getCurrentProfile, isEmployeeOrAdmin } from '@/lib/db/profile';
import { getSettings } from '@/lib/db/settings';
import { getSite } from '@/lib/db/sites';
import { fileNameStem } from '@/lib/export/file-name';
import { contentDisposition } from '@/lib/export/query';
import { renderBudgetReportPdf } from '@/lib/pdf/budget-report-pdf';
import { renderBudgetSetupPdf } from '@/lib/pdf/budget-setup-pdf';
import { isUuid } from '@/lib/uuid';

// 実行予算・受注の内訳（kind=setup）と予算と実績（kind=report）の PDF。
// GET /api/budget/pdf?site=<uuid>&kind=setup|report&disposition=inline|attachment
// 社員・管理者だけ（協力会社は 403。金額の表は RLS でも読めない）。disposition=inline のときだけブラウザで開く（アプリの
// PDF ビューアー /pdf から）。それ以外は attachment。失敗は JSON { ok: false, error }。

export const runtime = 'nodejs';
export const maxDuration = 60;

type Kind = 'setup' | 'report';

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const siteId = params.get('site') ?? '';
  const kind = params.get('kind') ?? '';
  const disposition = params.get('disposition') ?? 'attachment';
  if (!isUuid(siteId)) return fail(400, '現場の指定が正しくありません');
  if (kind !== 'setup' && kind !== 'report') return fail(400, '帳票の種類が正しくありません');
  if (disposition !== 'inline' && disposition !== 'attachment') return fail(400, '開き方の指定が正しくありません');

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (!isEmployeeOrAdmin(profile)) return fail(403, '実行予算・予算と実績は社員・管理者だけが出力できます');

  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  const today = todayJst();
  const meta = { siteName: site.name, projectNo: site.projectNo, outputAt: new Date().toISOString() };
  let pdf: Buffer;
  try {
    pdf = await render(kind, siteId, today, meta);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(403, '実行予算・予算と実績は社員・管理者だけが出力できます');
    console.error('[budget/pdf]', kind, e);
    return fail(500, 'PDF の作成に失敗しました。時間をおいてやり直してください');
  }

  const fileName =
    kind === 'report' ? budgetReportFileName(site.name, today, 'pdf') : `${fileNameStem(site.name)}_実行予算と内訳_${today.replaceAll('-', '')}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(fileName, { inline: disposition === 'inline' }),
      'Content-Length': String(pdf.length),
      'Cache-Control': 'no-store',
    },
  });
}

class ForbiddenError extends Error {}

async function render(
  kind: Kind,
  siteId: string,
  today: string,
  meta: { siteName: string; projectNo: string | null; outputAt: string },
): Promise<Buffer> {
  if (kind === 'report') {
    const input = await loadBudgetModelInput(siteId, today);
    if (!input) throw new ForbiddenError();
    return renderBudgetReportPdf(buildBudgetModel(input), meta);
  }
  const [data, suppliers, settings] = await Promise.all([loadBudgetData(siteId), listSuppliers(), getSettings()]);
  const names = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
  return renderBudgetSetupPdf(data, names, settings.budgetDailyRate, meta);
}
