import { todayJst } from '@/lib/calc/format';
import { getCurrentProfile } from '@/lib/db/profile';
import { loadCostReportInput } from '@/lib/db/reports-data';
import { getSettings, type Settings } from '@/lib/db/settings';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { buildCostReport } from '@/lib/reports/cost-model';
import { buildLedgerAttendance } from '@/lib/reports/ledger-attendance';
import { buildLedgerXlsx } from '@/lib/reports/ledger-xlsx';
import { ledgerFileName, parseLedgerQuery } from '@/lib/reports/query';
import type { CostReportInput } from '@/lib/reports/types';

// 現場管理台帳（.xlsx。2026-11-11）。GET /api/export?site=<uuid>&period=all|YYYY-MM
// 数字は工事原価集計表と同じ読み込み・計算（loadCostReportInput → buildCostReport）。シートは「現場原価集計」「出面一覧」。
// 日報が無い期間も空の台帳（「日報がありません」）を返す。失敗はすべて JSON { ok: false, error }
// （400 クエリ／401・403 権限／404 現場／500 読み込み・作成失敗）。

export const runtime = 'nodejs';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const query = parseLedgerQuery(request.url);
  if ('error' in query) return fail(400, query.error);
  const { siteId, period } = query;

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
    console.error('[export] load', e);
    return fail(500, '日報を読み込めませんでした。時間をおいてやり直してください');
  }

  const now = { date: todayJst(), by: profile.name || profile.email, at: new Date().toISOString() };

  let data: Buffer;
  try {
    const model = buildCostReport(input, period, now, rates);
    data = await buildLedgerXlsx(model, buildLedgerAttendance(input, period));
  } catch (e) {
    console.error('[export] build', e);
    return fail(500, '現場管理台帳の作成に失敗しました');
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': contentDisposition(ledgerFileName(site.name, period, now.date)),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
