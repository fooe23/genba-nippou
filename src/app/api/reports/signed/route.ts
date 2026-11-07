import { downloadObject, getClientSignatureState, SIGNED_PDF_BUCKET } from '@/lib/db/client-signature';
import { getCurrentProfile } from '@/lib/db/profile';
import { getSite } from '@/lib/db/sites';
import { contentDisposition } from '@/lib/export/query';
import { parseSignedPdfQuery } from '@/lib/report/client-signature';
import { dailyReportFileName } from '@/lib/reports/query';

// サインした時点のお客様用日報 PDF を開く。
//   GET /api/reports/signed?report=<uuid>              いまのサインの PDF
//   GET /api/reports/signed?report=<uuid>&history=<n>  取り消したサインの PDF（client_signature_history の n 番目）
// 読めるのは日報が見える現場メンバー（社員・管理者、協力会社は自分の現場だけ。RLS と Storage のポリシー）。
// 実体はサーバーが本人のログインで読んでそのまま返す（URL を外に出さない）。ブラウザで開く（inline）、キャッシュしない。

export const runtime = 'nodejs';
// 写真入りの PDF を作る・読むための上限時間（秒）。
export const maxDuration = 60;

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const query = parseSignedPdfQuery(request.url);
  if ('error' in query) return fail(400, query.error);

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');

  let state;
  try {
    state = await getClientSignatureState(query.reportId);
  } catch (e) {
    console.error('[reports/signed] load', e);
    return fail(500, 'サインの記録を読み込めませんでした。時間をおいてやり直してください');
  }
  if (!state) return fail(404, '日報が見つからないか、権限がありません');
  const site = await getSite(state.siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let pdfPath: string | null;
  let revoked = false;
  if (query.history === null) {
    pdfPath = state.current?.pdfPath ?? null;
  } else {
    pdfPath = state.history.find((h) => h.index === query.history)?.pdfPath ?? null;
    revoked = true;
  }
  if (!pdfPath) return fail(404, 'サインした時点の PDF がありません');

  const data = await downloadObject(SIGNED_PDF_BUCKET, pdfPath);
  if (!data) return fail(404, 'サインした時点の PDF を読み込めませんでした');

  const name = `${dailyReportFileName(site.name, { kind: 'date', date: state.reportDate }, 'pdf', 'client').replace(/\.pdf$/, '')}_サイン${revoked ? '_取り消し' : ''}.pdf`;
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': contentDisposition(name, { inline: true }),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
