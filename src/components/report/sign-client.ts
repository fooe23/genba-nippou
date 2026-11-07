import { saveClientSignature, type ClientConfirmationResult } from '@/lib/db/reports-actions';
import { SIGNATURE_IMAGE_FAILED_MESSAGE, signaturePath } from '@/lib/report/client-signature';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';
import { createBrowserSupabase } from '@/lib/supabase/client';

// お客様のサインを保存する流れ（画面側）。サインの画像（PNG）を本人のログインで gn-photos/<site_id>/sign/<uuid>.png に置き
// （ランダムな名前。上書きしない）、saveClientSignature（確認者・メモ・確認していただく件）を呼ぶ。
// お客様用の確認画面（ClientConfirmView）で使う。

export const SIGN_FAILED_MESSAGE = '保存できませんでした。通信状況を確認してもう一度お試しください。';

export async function uploadAndSaveSignature(p: {
  siteId: string;
  reportId: string;
  png: Blob;
  confirmedBy: string;
  note: string;
  issueIds: string[];
  expected: string | null;
}): Promise<ClientConfirmationResult> {
  const path = signaturePath(p.siteId, crypto.randomUUID());
  const body = new File([p.png], 'signature.png', { type: 'image/png' });
  const { error: upError } = await createBrowserSupabase()
    .storage.from('gn-photos')
    .upload(path, body, { contentType: 'image/png', upsert: false });
  if (upError) {
    console.error('[signature upload]', upError.message);
    return { ok: false, error: SIGNATURE_IMAGE_FAILED_MESSAGE };
  }
  let res: ClientConfirmationResult;
  try {
    res = await saveClientSignature(
      p.reportId,
      { confirmedBy: p.confirmedBy, note: p.note, signaturePath: path, issueIds: p.issueIds },
      p.expected,
    );
  } catch {
    return { ok: false, error: SIGN_FAILED_MESSAGE };
  }
  if (!res.ok && res.stale) return { ...res, error: STALE_CONFIRMATION_MESSAGE };
  return res;
}
