import 'server-only';
import { parseSignatureHistory, type ClientSignature, type RevokedSignature } from '@/lib/report/client-signature';
import { createServerSupabase } from '@/lib/supabase/server';

// お客様のサインの読み取り（RLS 前提。日報が見える現場メンバーなら読める。協力会社も自分の現場なら読める）。
// 書き込みは reports-actions.ts の saveClientSignature / revokeClientSignature（DB の関数）だけ。

export const SIGNATURE_BUCKET = 'gn-photos';
export const SIGNED_PDF_BUCKET = 'gn-exports';
const SIGNED_URL_SECONDS = 60 * 60;

export interface ClientSignatureState {
  siteId: string;
  reportDate: string;
  current: ClientSignature | null;
  history: RevokedSignature[];
}

interface SignatureRow {
  site_id: string;
  report_date: string;
  client_confirmed_by: string | null;
  client_confirmed_note: string | null;
  client_signature_path: string | null;
  client_signed_at: string | null;
  client_signed_pdf_path: string | null;
  client_signature_history: unknown;
}

const COLUMNS =
  'site_id, report_date, client_confirmed_by, client_confirmed_note, client_signature_path, client_signed_at, client_signed_pdf_path, client_signature_history';

/** 日報のサイン（いまのサインと取り消したサインの記録）。日報が見えなければ null。 */
export async function getClientSignatureState(reportId: string): Promise<ClientSignatureState | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from('gn_daily_reports').select(COLUMNS).eq('id', reportId).maybeSingle();
  if (error) throw new Error(`[getClientSignatureState] ${error.message}`);
  if (!data) return null;
  const r = data as SignatureRow;
  return {
    siteId: r.site_id,
    reportDate: r.report_date,
    current:
      r.client_signature_path && r.client_signed_at
        ? {
            path: r.client_signature_path,
            pdfPath: r.client_signed_pdf_path || null,
            signedAt: r.client_signed_at,
            confirmedBy: r.client_confirmed_by ?? '',
            note: r.client_confirmed_note ?? '',
          }
        : null,
    history: parseSignatureHistory(r.client_signature_history),
  };
}

/** Storage の実体を読む。読めない（権限が無い・実体が無い）ときは null（ログに残す）。 */
export async function downloadObject(bucket: string, path: string): Promise<Buffer | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    console.error('[downloadObject]', bucket, path, error?.message);
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/** いまのサインの画像（お客様用日報 PDF に載せる）。サインが無い・読めないときは undefined。 */
export async function loadCurrentSignaturePng(reportId: string): Promise<Buffer | undefined> {
  const state = await getClientSignatureState(reportId);
  if (!state?.current) return undefined;
  return (await downloadObject(SIGNATURE_BUCKET, state.current.path)) ?? undefined;
}

/** サインの画像を画面に出す URL（署名付き、1 時間）。作れなければ ''。 */
export async function signatureImageUrl(path: string): Promise<string> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.storage.from(SIGNATURE_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data) {
    console.error('[signatureImageUrl]', error?.message);
    return '';
  }
  return data.signedUrl;
}
