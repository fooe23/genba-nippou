import { todayJst } from '@/lib/calc/format';
import { getCurrentProfile } from '@/lib/db/profile';
import { loadCostReportInput } from '@/lib/db/reports-data';
import { getSettings, type Settings } from '@/lib/db/settings';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { renderCostPdf } from '@/lib/pdf/cost-report';
import { buildCostReport } from '@/lib/reports/cost-model';
import { buildCostCsv } from '@/lib/reports/cost-csv';
import { buildCostXlsx } from '@/lib/reports/cost-xlsx';
import { costReportFileName, parseCostQuery, type CostFormat } from '@/lib/reports/query';
import type { CostReportInput, CostReportModel } from '@/lib/reports/types';

// 工事原価集計表。GET /api/reports/cost?site=<uuid>&period=all|YYYY-MM&format=pdf|xlsx|csv
// 日報が無い期間も空の帳票（「日報がありません」）を返す。失敗はすべて JSON { ok: false, error }
// （400 クエリ／401・403 権限／404 現場／500 読み込み・作成失敗）。PDF（react-pdf）は Node で作る。

export const runtime = 'nodejs';

const CONTENT_TYPES: Record<CostFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
};

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function render(model: CostReportModel, format: CostFormat): Promise<Buffer> {
  if (format === 'pdf') return renderCostPdf(model);
  if (format === 'xlsx') return buildCostXlsx(model);
  return Buffer.from(buildCostCsv(model), 'utf-8');
}

export async function GET(request: Request): Promise<Response> {
  const query = parseCostQuery(request.url);
  if ('error' in query) return fail(400, query.error);
  const { siteId, period, format } = query;

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (profile.accountType === 'partner') return fail(403, '協力会社のアカウントでは出力できません');

  // 完了した現場も出力できる。削除済みは出さない（画面と同じ）。
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let input: CostReportInput;
  let rates: Settings['rates'];
  try {
    [input, { rates }] = await Promise.all([loadCostReportInput(siteId), getSettings()]);
  } catch (e) {
    console.error('[reports/cost] load', e);
    return fail(500, '日報を読み込めませんでした。時間をおいてやり直してください');
  }

  const now = { date: todayJst(), by: profile.name || profile.email, at: new Date().toISOString() };
  const model = buildCostReport(input, period, now, rates);

  let data: Buffer;
  try {
    data = await render(model, format);
  } catch (e) {
    console.error('[reports/cost] render', format, e);
    return fail(500, '工事原価集計表の作成に失敗しました');
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': contentDisposition(costReportFileName(site.name, period, now.date, format)),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
