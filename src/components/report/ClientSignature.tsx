'use client';

import { useRef, useState, useTransition } from 'react';
import { jpDateTime } from '@/lib/calc/format';
import { revokeClientSignature, saveClientSignature, type ClientConfirmationResult } from '@/lib/db/reports-actions';
import {
  canRevokeSignature,
  canSign,
  revokeReasonSchema,
  SIGNATURE_IMAGE_FAILED_MESSAGE,
  SIGNATURE_NOTE,
  signatureFormSchema,
  signaturePath,
  type ClientSignatureView,
} from '@/lib/report/client-signature';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';
import { createBrowserSupabase } from '@/lib/supabase/client';
import { EditDialog } from '@/components/masters/EditDialog';
import { fieldClass, TextInput } from './inputs';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

// 日報画面の「お客様のサイン」。サインが無ければ確認者・メモと「サインをもらう」（サインの欄を開く）。
// 保存すると確認者・日時・メモ・サインが固定され、その時点のお客様用日報 PDF が残る。取り消しは管理者だけ（理由必須）。
// どの状態の日報でも・完了現場でも、現場メンバーならサインをもらえる（最終判定は DB）。

const FAILED = '保存できませんでした。通信状況を確認してもう一度お試しください。';
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

interface Props {
  reportId: string | null;
  siteId: string;
  signature: ClientSignatureView;
  /** 確認者の初期値（客先確認の記録があればその名前）。 */
  defaultConfirmedBy: string;
  defaultNote: string;
  isAdmin: boolean;
  expected: string | null;
  onChanged: (updatedAt: string | null) => void;
}

function signedPdfHref(reportId: string, history?: number): string {
  return `/api/reports/signed?report=${encodeURIComponent(reportId)}${history === undefined ? '' : `&history=${history}`}`;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
      {message}
    </p>
  );
}

/** サインをもらう（確認者・メモ・サインの欄・書き直す・サインを保存）。 */
function SignForm({
  reportId,
  siteId,
  defaultConfirmedBy,
  defaultNote,
  expected,
  onChanged,
  onClose,
}: Omit<Props, 'signature' | 'isAdmin' | 'reportId'> & { reportId: string; onClose: () => void }) {
  const [by, setBy] = useState(defaultConfirmedBy);
  const [note, setNote] = useState(defaultNote);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pad = useRef<SignaturePadHandle | null>(null);
  // 二度押しの防止（state の更新を待たずに、同期で止める）
  const inFlight = useRef(false);

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await saveOnce();
    } finally {
      inFlight.current = false;
    }
  }

  async function saveOnce() {
    const checked = signatureFormSchema.safeParse({ confirmedBy: by, note });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? '入力内容が正しくありません');
      return;
    }
    const png = await pad.current?.toPng();
    if (!png) return;
    if ('error' in png) {
      setError(png.error);
      return;
    }
    setError(null);
    setSending(true);
    try {
      // サインの画像は本人のログインで Storage に置く（ランダムな名前。上書きしない）
      const path = signaturePath(siteId, crypto.randomUUID());
      const body = new File([png.blob], 'signature.png', { type: 'image/png' });
      const { error: upError } = await createBrowserSupabase()
        .storage.from('gn-photos')
        .upload(path, body, { contentType: 'image/png', upsert: false });
      if (upError) {
        console.error('[signature upload]', upError.message);
        setError(SIGNATURE_IMAGE_FAILED_MESSAGE);
        return;
      }
      let res: ClientConfirmationResult;
      try {
        res = await saveClientSignature(reportId, { ...checked.data, signaturePath: path }, expected);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.stale ? STALE_CONFIRMATION_MESSAGE : res.error);
        return;
      }
      onChanged(res.updatedAt);
      onClose();
    } catch (e) {
      console.error('[signature]', e);
      setError(FAILED);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">確認者（必須）</span>
        <TextInput value={by} maxLength={100} placeholder="例：施主 〇〇様" onChange={setBy} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">メモ（500文字まで）</span>
        <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} py-2`} />
      </label>
      <SignaturePad handleRef={pad} disabled={sending} onChange={() => setError(null)} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => pad.current?.clear()}
          disabled={sending}
          className={`${buttonBase} flex-1 border border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400`}
        >
          書き直す
        </button>
        <button type="button" onClick={() => void save()} disabled={sending} className={`${buttonBase} flex-1 bg-blue-700 text-white`}>
          {sending ? '保存中…' : 'サインを保存'}
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">保存すると、確認者・日時・メモと一緒に残ります。{SIGNATURE_NOTE}</p>
      {error && <ErrorBox message={error} />}
      <button type="button" onClick={onClose} disabled={sending} className="min-h-11 text-sm font-medium text-blue-700 underline dark:text-blue-400">
        やめる
      </button>
    </div>
  );
}

/** 管理者の「サインを取り消す」（理由必須・確認あり）。 */
function RevokeButton({ reportId, expected, onChanged }: { reportId: string; expected: string | null; onChanged: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke() {
    const checked = revokeReasonSchema.safeParse(reason);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? '取り消しの理由を入力してください');
      return;
    }
    if (!window.confirm('お客様のサインを取り消します。サインした時点の PDF は「取り消し」として残ります。よろしいですか？')) return;
    setError(null);
    startTransition(async () => {
      let res: ClientConfirmationResult;
      try {
        res = await revokeClientSignature(reportId, checked.data, expected);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.stale ? STALE_CONFIRMATION_MESSAGE : res.error);
        return;
      }
      setOpen(false);
      onChanged(res.updatedAt);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-700 px-3 text-sm font-medium text-red-700 dark:border-red-400 dark:text-red-400"
      >
        サインを取り消す
      </button>
      <EditDialog open={open} title="サインを取り消す" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            間違えてもらったサインを取り消します（管理者だけ）。取り消した記録とサインした時点の PDF は残ります。
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">取り消しの理由（必須・500文字まで）</span>
            <textarea value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} className={`${fieldClass} py-2`} />
          </label>
          {error && <ErrorBox message={error} />}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${buttonBase} border border-gray-400 font-medium dark:border-gray-600`}>
              キャンセル
            </button>
            <button type="button" onClick={revoke} disabled={pending} className={`${buttonBase} bg-red-700 text-white`}>
              {pending ? '取り消し中…' : '取り消す'}
            </button>
          </div>
        </div>
      </EditDialog>
    </>
  );
}

/** 「お客様のサイン」の欄（日報を保存した後に出す）。 */
export function ClientSignatureSection(props: Props) {
  const { reportId, signature, isAdmin, expected, onChanged } = props;
  const [signing, setSigning] = useState(false);
  if (reportId === null) return null;
  const current = signature.current;

  return (
    <section aria-labelledby="client-signature-heading" className="mb-4 rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <h2 id="client-signature-heading" className="mb-2 text-base font-bold">
        お客様のサイン
      </h2>
      {current ? (
        <div className="space-y-2">
          <p className="break-words">
            確認者：<span className="font-bold">{current.confirmedBy}</span>
            <span className="ml-3 text-sm text-gray-600 dark:text-gray-400">{jpDateTime(current.signedAt)}</span>
          </p>
          {current.note && <p className="text-sm whitespace-pre-wrap break-words">メモ：{current.note}</p>}
          {current.imageUrl ? (
            // 署名付き URL の画像（next/image の最適化は通さない）
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.imageUrl} alt={`${current.confirmedBy}のサイン`} className="max-h-48 w-full rounded border border-gray-300 bg-white object-contain" />
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">サインの画像を読み込めませんでした。</p>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">{SIGNATURE_NOTE}</p>
          <div className="flex flex-wrap gap-2">
            {current.hasPdf && (
              <a
                href={signedPdfHref(reportId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-700 px-3 text-sm font-medium text-blue-700 dark:border-blue-400 dark:text-blue-400"
              >
                サインした時点の PDF を開く
              </a>
            )}
            {canRevokeSignature({ isAdmin, signed: true }) && <RevokeButton reportId={reportId} expected={expected} onChanged={onChanged} />}
          </div>
        </div>
      ) : signing ? (
        <SignForm {...props} reportId={reportId} onClose={() => setSigning(false)} />
      ) : (
        canSign({ reportId, signed: false }) && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">お客様に確認してもらい、その場で指でサインをもらいます。{SIGNATURE_NOTE}</p>
            <button type="button" onClick={() => setSigning(true)} className={`${buttonBase} w-full bg-blue-700 text-white sm:w-auto`}>
              サインをもらう
            </button>
          </div>
        )
      )}
      {signature.history.length > 0 && (
        <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-800">
          <p className="text-xs font-bold text-gray-600 dark:text-gray-400">取り消したサイン</p>
          <ul className="space-y-1">
            {signature.history.map((h) => (
              <li key={h.index} className="flex flex-wrap items-center gap-x-2 text-xs text-gray-600 dark:text-gray-400">
                <span>
                  取り消し済み：{h.confirmedBy || '（確認者なし）'}
                  {h.signedAt ? ` ${jpDateTime(h.signedAt)}` : ''}・理由：{h.reason}
                  {h.revokedAt ? `（${jpDateTime(h.revokedAt)} 取り消し）` : ''}
                </span>
                {h.pdfPath && (
                  <a
                    href={signedPdfHref(reportId, h.index)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center font-medium text-blue-700 underline dark:text-blue-400"
                  >
                    PDF を開く
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
