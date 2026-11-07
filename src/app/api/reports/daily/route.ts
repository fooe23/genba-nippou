import { getCurrentProfile } from '@/lib/db/profile';
import { loadDailyMonthInputs, loadDailyReportInput } from '@/lib/db/reports-data';
import { getSite, type Site } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { renderDailyPdf } from '@/lib/pdf/daily-report';
import { renderClientDailyPdfFor } from '@/lib/reports/client-daily-render';
import { buildDailyCsv } from '@/lib/reports/daily-csv';
import { buildDailyReport, buildEmptyDailyReport } from '@/lib/reports/daily-model';
import { dailyReportFileName, parseDailyQuery, type DailyFormat, type DailyTarget } from '@/lib/reports/query';
import type { DailyReportModel } from '@/lib/reports/types';

// 日報の帳票。GET /api/reports/daily?site=<uuid>&date=YYYY-MM-DD&format=pdf|csv（1 日分）
//          GET /api/reports/daily?site=<uuid>&month=YYYY-MM&format=pdf|csv（月まとめ。日付の昇順、PDF は日ごとに改ページ）
// 日報が無い日・月も空の帳票（PDF・CSV とも「日報がありません」の 1 行）を返す。失敗はすべて JSON { ok: false, error }
// （400 クエリ／401・403 権限／404 現場／500 読み込み・作成失敗）。PDF（react-pdf）は Node で作る。
// PDF は &disposition=inline のときだけブラウザで開く（inline。プレビュー）。それ以外と xlsx/csv は attachment。
// &audience=client は現場日報（お客様用）の PDF（date＋pdf のときだけ。月まとめ・CSV との組み合わせは 400）。
// 同じ DailyReportModel から金額・氏名・連絡事項を除き、その日の「お客様用 PDF に載せる」写真（Storage から読む）を
// 足した帳票を作る（client-daily-render.ts → client-daily-report.tsx）。

export const runtime = 'nodejs';

const CONTENT_TYPES: Record<DailyFormat, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
};

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** 帳票のデータ（日付の昇順）。日報が無ければ空の 1 件（月のときは日付の代わりに年月を入れ、PDF は「YYYY年MM月」と出す）。 */
async function loadModels(site: Site, target: DailyTarget): Promise<DailyReportModel[]> {
  if (target.kind === 'date') {
    const input = await loadDailyReportInput(site, target.date);
    return [input ? buildDailyReport(input) : buildEmptyDailyReport(site, target.date)];
  }
  const inputs = await loadDailyMonthInputs(site, target.month);
  return inputs.length > 0 ? inputs.map(buildDailyReport) : [buildEmptyDailyReport(site, target.month)];
}

async function render(models: DailyReportModel[], format: DailyFormat, outputAt: string): Promise<Buffer> {
  if (format === 'pdf') return renderDailyPdf(models, outputAt);
  return Buffer.from(buildDailyCsv(models), 'utf-8');
}

/** お客様用（parseDailyQuery が date＋pdf に限る）。日報・写真の読み込みから PDF まで。 */
async function renderClient(site: Site, target: DailyTarget): Promise<Buffer> {
  if (target.kind !== 'date') throw new Error('お客様用は 1 日分だけです');
  return renderClientDailyPdfFor(site, target.date);
}

export async function GET(request: Request): Promise<Response> {
  const query = parseDailyQuery(request.url);
  if ('error' in query) return fail(400, query.error);
  const { siteId, target, format, disposition, audience } = query;

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (profile.accountType === 'partner') return fail(403, '協力会社のアカウントでは出力できません');

  // 完了した現場も出力できる。削除済みは出さない（画面と同じ）。
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let data: Buffer;
  if (audience === 'client') {
    try {
      data = await renderClient(site, target);
    } catch (e) {
      console.error('[reports/daily] client', e);
      return fail(500, '日報の帳票の作成に失敗しました。時間をおいてやり直してください');
    }
  } else {
    let models: DailyReportModel[];
    try {
      models = await loadModels(site, target);
    } catch (e) {
      console.error('[reports/daily] load', e);
      return fail(500, '日報を読み込めませんでした。時間をおいてやり直してください');
    }
    try {
      data = await render(models, format, new Date().toISOString());
    } catch (e) {
      console.error('[reports/daily] render', format, e);
      return fail(500, '日報の帳票の作成に失敗しました');
    }
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': contentDisposition(dailyReportFileName(site.name, target, format, audience), { inline: disposition === 'inline' }),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
