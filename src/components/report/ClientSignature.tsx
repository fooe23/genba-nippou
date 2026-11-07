'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { jpDateTime } from '@/lib/calc/format';
import { downloadHref, pdfViewerHref } from '@/lib/pdf-viewer';
import { revokeClientSignature, type ClientConfirmationResult } from '@/lib/db/reports-actions';
import { clientConfirmHref } from '@/lib/report/client-confirm';
import { canRevokeSignature, canSign, revokeReasonSchema, SIGNATURE_NOTE, type ClientSignatureView } from '@/lib/report/client-signature';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';
import { EditDialog } from '@/components/masters/EditDialog';
import { fieldClass } from './inputs';

// 日報画面の「お客様のサイン」。サインが無ければ「サインをもらう（お客様用の画面へ）」（お客様用の確認画面
// /sites/[siteId]/reports/[date]/client に移る。2026-11-13。その場のサインの欄はやめた）。
// 保存すると確認者・日時・メモ・サインが固定され、その時点のお客様用日報 PDF が残る。取り消しは管理者だけ（理由必須）。
// どの状態の日報でも・完了現場でも、現場メンバーならサインをもらえる（最終判定は DB）。日報が未保存のあいだは出さない。

const FAILED = '保存できませんでした。通信状況を確認してもう一度お試しください。';
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

interface Props {
  reportId: string | null;
  siteId: string;
  /** 日報の日付（お客様用の確認画面の URL に使う）。 */
  date: string;
  signature: ClientSignatureView;
  /** 日報に保存していない変更がある（お客様用の確認画面には保存した内容が出る）。 */
  unsavedChanges?: boolean;
  isAdmin: boolean;
  expected: string | null;
  onChanged: (updatedAt: string | null) => void;
}

function signedPdfHref(reportId: string, history?: number): string {
  return `/api/reports/signed?report=${encodeURIComponent(reportId)}${history === undefined ? '' : `&history=${history}`}`;
}

/** サインした時点の PDF の「開く」（アプリの中の PDF ビューアー。戻るとこの画面）と「保存」（ダウンロード）。 */
function signedPdfLinks(reportId: string, back: string, date: string, history?: number): { open: string; save: string } {
  const src = signedPdfHref(reportId, history);
  const title = `サインした時点の日報 ${date}${history === undefined ? '' : '（取り消し）'}`;
  return { open: pdfViewerHref({ src, title, back }) ?? src, save: downloadHref(src) ?? src };
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
      {message}
    </p>
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
  const { reportId, siteId, date, signature, isAdmin, expected, onChanged, unsavedChanges } = props;
  // PDF ビューアーの「戻る」で戻る先（日報の画面・承認の画面）
  const pathname = usePathname();
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
              <>
                <Link
                  href={signedPdfLinks(reportId, pathname, date).open}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-700 px-3 text-sm font-medium text-blue-700 dark:border-blue-400 dark:text-blue-400"
                >
                  サインした時点の PDF を開く
                </Link>
                <a
                  href={signedPdfLinks(reportId, pathname, date).save}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm font-medium dark:border-gray-600"
                >
                  保存
                </a>
              </>
            )}
            {canRevokeSignature({ isAdmin, signed: true }) && <RevokeButton reportId={reportId} expected={expected} onChanged={onChanged} />}
          </div>
        </div>
      ) : (
        canSign({ reportId, signed: false }) && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              お客様用の確認画面（社内の情報を出さない画面）に切り替えて、端末をお客様に渡します。確認していただく件を選び、指でサインをもらいます。
              社内の画面に戻るには「社内の画面に戻る」を長押しします。{SIGNATURE_NOTE}
            </p>
            {unsavedChanges && (
              <p role="note" className="text-sm font-bold text-amber-800 dark:text-amber-300">
                保存していない変更は、お客様用の確認画面に出ません。先に保存してください。
              </p>
            )}
            <Link
              href={clientConfirmHref(siteId, date)}
              className={`${buttonBase} inline-flex w-full items-center justify-center bg-blue-700 text-white sm:w-auto`}
            >
              サインをもらう（お客様用の画面へ）
            </Link>
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
                  <>
                    <Link
                      href={signedPdfLinks(reportId, pathname, date, h.index).open}
                      className="inline-flex min-h-11 items-center font-medium text-blue-700 underline dark:text-blue-400"
                    >
                      PDF を開く
                    </Link>
                    <a
                      href={signedPdfLinks(reportId, pathname, date, h.index).save}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-blue-700 underline dark:text-blue-400"
                    >
                      保存
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
