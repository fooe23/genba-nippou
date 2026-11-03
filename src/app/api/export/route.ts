import { loadExportInput } from '@/lib/db/export';
import { getCurrentProfile } from '@/lib/db/profile';
import { getSite } from '@/lib/db/sites';
import { FillError, fillWorkbook } from '@/lib/export/fill-client';
import { buildExportPayload } from '@/lib/export/payload';
import { contentDisposition, overflowNotice, parseExportQuery } from '@/lib/export/query';
import type { ExportInput } from '@/lib/export/types';
import { createServerSupabase } from '@/lib/supabase/server';

// 原本 Excel（V34 雛形の xlsm）を 1 か月分作って返す。GET /api/export?site=<uuid>&month=YYYY-MM
// 失敗はすべて JSON { ok: false, error }（400 クエリ・雛形に入りきらない／401・403 権限／404 現場・日報なし／500 作成失敗）。

export const runtime = 'nodejs';

const XLSM_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.12';
const BUCKET = 'gn-exports';

function fail(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 作った xlsm を Storage（gn-exports/<site_id>/<month>/…）にも残す。失敗してもダウンロードは続ける。
 * Storage のキーは ASCII しか使えないので、日本語のファイル名ではなく daicho_v34_<month>.xlsm で置く。
 */
async function keepCopy(siteId: string, month: string, data: Buffer): Promise<void> {
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${siteId}/${month}/daicho_v34_${month}.xlsm`, data, { upsert: true, contentType: XLSM_TYPE });
    if (error) console.error('[export] storage upload', error.message);
  } catch (e) {
    console.error('[export] storage upload', e);
  }
}

export async function GET(request: Request): Promise<Response> {
  const query = parseExportQuery(request.url);
  if ('error' in query) return fail(400, query.error);
  const { siteId, month } = query;

  const profile = await getCurrentProfile();
  if (!profile) return fail(401, 'ログインしてください');
  if (profile.accountType === 'partner') return fail(403, '協力会社のアカウントでは出力できません');

  // 完了した現場も出力できる。削除済みは出さない（画面と同じ）。
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) return fail(404, '現場が見つかりません');

  let input: ExportInput;
  try {
    input = await loadExportInput(siteId, month);
  } catch (e) {
    console.error('[export] load', e);
    return fail(500, '日報を読み込めませんでした。時間をおいてやり直してください');
  }
  if (input.reports.length === 0) return fail(404, 'この月の日報がありません');

  const { payload, warnings } = buildExportPayload(input);
  const notice = overflowNotice(warnings);
  if (notice) return fail(400, notice);

  let data: Buffer;
  try {
    data = await fillWorkbook(payload);
  } catch (e) {
    if (e instanceof FillError) {
      console.error('[export] fill', e.code, e.message);
      return fail(500, e.message);
    }
    console.error('[export] fill', e);
    return fail(500, 'Excel の作成に失敗しました');
  }

  await keepCopy(siteId, month, data);

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': XLSM_TYPE,
      'Content-Disposition': contentDisposition(payload.file_name),
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  });
}
