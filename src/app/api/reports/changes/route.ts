import { todayJst } from '@/lib/calc/format';
import { getCurrentProfile } from '@/lib/db/profile';
import { loadCostReportInput } from '@/lib/db/reports-data';
import { getSettings, type Settings } from '@/lib/db/settings';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { renderChangePdf } from '@/lib/pdf/change-ledger';
import { renderClientChangePdf } from '@/lib/pdf/client-change-ledger';
import { buildChangeLedger } from '@/lib/reports/change-model';
import { reportSpan, type ChangeReportMeta } from '@/lib/reports/change-sections';
import { buildChangeXlsx } from '@/lib/reports/change-xlsx';
import { buildClientChangeXlsx } from '@/lib/reports/client-change-xlsx';
import { changeReportFileName, parseChangesQuery, type ChangesFormat } from '@/lib/reports/query';
import type { ChangeLedgerModel, CostReportInput } from '@/lib/reports/types';

// 追加・変更の精算。GET /api/reports/changes?site=<uuid>&period=all|YYYY-MM&format=pdf|xlsx[&audience=client]
// audience=client は客先に渡す「追加・変更工事 精算のご提案（案）」（原価・見込み額・提案額を出さない）、それ以外は
// 「変更増減 社内確認用」。どちらも同じ ChangeLedgerModel から作る。
// 追加・増・変更・減の行が無い期間も空の帳票（「追加・増・変更・減の記録はありません」）を返す。失敗はすべて JSON { ok: false, error }
// （400 クエリ／401・403 権限／404 現場／500 読み込み・作成失敗）。PDF（react-pdf）は Node で作る。
// PDF は &disposition=inline のときだけブラウザで開く（inline。プレビュー）。それ以外と xlsx/csv は attachment。

export const runtime = 'nodejs';

const CONTENT_TYPES: Record<ChangesFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const query = parseChangesQuery(request.url);
  if ('error' in query) return fail(400, query.error);
  const { siteId, period, format, disposition, audience } = query;

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (profile.accountType === 'partner') return fail(403, '協力会社のアカウントでは出力できません');

  // 完了した現場も出力できる。削除済みは出さない（画面と同じ）。
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let input: CostReportInput;
  let settings: Settings;
  try {
    [input, settings] = await Promise.all([loadCostReportInput(siteId), getSettings()]);
  } catch (e) {
    console.error('[reports/changes] load', e);
    return fail(500, '日報を読み込めませんでした。時間をおいてやり直してください');
  }

  const model: ChangeLedgerModel = buildChangeLedger(input, settings.rates, period);
  const meta: ChangeReportMeta = {
    site,
    company: settings.company,
    outputAt: new Date().toISOString(),
    by: profile.name || profile.email,
    reportSpan: reportSpan(input.reports),
  };

  let data: Buffer;
  try {
    if (audience === 'client') {
      data = format === 'pdf' ? await renderClientChangePdf(model, meta) : await buildClientChangeXlsx(model, meta);
    } else {
      data = format === 'pdf' ? await renderChangePdf(model, meta) : await buildChangeXlsx(model, meta);
    }
  } catch (e) {
    console.error('[reports/changes] render', audience, format, e);
    return fail(500, audience === 'client' ? '精算のご提案の作成に失敗しました' : '変更増減 社内確認用の作成に失敗しました');
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': contentDisposition(changeReportFileName(site.name, period, todayJst(), format, audience), { inline: disposition === 'inline' }),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
