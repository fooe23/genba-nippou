'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { firstError } from '@/lib/db/masters-schemas';
import { archiveSite } from '@/lib/db/sites-actions';
import { archiveSiteSchema } from '@/lib/db/sites-schemas';
import { ErrorText, Field, inputClass, secondaryButtonClass, useRunner } from '@/components/masters/common';
import { EditDialog } from '@/components/masters/EditDialog';

const dangerButtonClass =
  'min-h-11 rounded-lg bg-red-700 px-4 text-base font-bold text-white disabled:opacity-50';

/**
 * 「この現場を削除」ボタンと確認ダイアログ。ログイン中の管理者本人のメールアドレスとパスワードを再入力させ、
 * サーバーで照合してから削除する。パスワードは送信したらすぐ（成功・失敗にかかわらず）入力欄から消す。
 */
export function DeleteSiteButton({ siteId, siteName }: { siteId: string; siteName: string }) {
  const router = useRouter();
  const { pending, error, setError, runResult } = useRunner();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Esc や背景のタップでもネイティブの dialog は閉じるので、送信中でも閉じた状態に合わせる。
  function close() {
    setOpen(false);
    setPassword('');
    setError(null);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = { siteId, email, password, reason };
    // パスワードは送る前に state から消す（成功・失敗にかかわらず残さない）。
    setPassword('');
    const message = firstError(archiveSiteSchema, input);
    if (message) {
      setError(message);
      return;
    }
    runResult(
      () => archiveSite(input),
      () => {
        setOpen(false);
        router.push('/admin/sites?status=deleted');
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={`${dangerButtonClass} w-full sm:w-auto`}
      >
        この現場を削除
      </button>
      <EditDialog open={open} title="現場を削除" onClose={close}>
        <form onSubmit={submit} className="space-y-3">
          <p className="break-words text-lg font-bold">{siteName}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            削除すると、この現場と日報は全員の画面から消えます（データは残り、管理者が復元できます）。
          </p>
          <Field label="理由（任意・200文字まで）">
            <textarea
              name="reason"
              value={reason}
              maxLength={200}
              rows={2}
              onChange={(e) => setReason(e.target.value)}
              className={`${inputClass} py-2`}
            />
          </Field>
          <Field label="メールアドレス">
            <input
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              maxLength={200}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="パスワード">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              maxLength={72}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </Field>
          <p className="text-sm font-medium">ご自分（ログイン中の管理者）のメールアドレスとパスワードを入力してください。</p>
          <ErrorText message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={dangerButtonClass}>
              {pending ? '削除中…' : '削除する'}
            </button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>
              キャンセル
            </button>
          </div>
        </form>
      </EditDialog>
    </>
  );
}
