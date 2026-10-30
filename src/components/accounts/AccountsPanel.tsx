'use client';

import { useState, type FormEvent } from 'react';
import {
  createPartnerAccount,
  resetPartnerPassword,
  updateAccountType,
} from '@/lib/db/accounts-actions';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  firstIssue,
  partnerAccountSchema,
  passwordSchema,
} from '@/lib/db/accounts-schemas';
import type { Account } from '@/lib/db/accounts';
import type { AccountType } from '@/lib/db/profile';
import { EditDialog } from '@/components/masters/EditDialog';
import {
  EmptyText, ErrorText, Field, inputClass, primaryButtonClass, secondaryButtonClass, useRunner,
} from '@/components/masters/common';

function isAccountType(v: string): v is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(v);
}

function TypeBadge({ type }: { type: AccountType }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${
        type === 'partner'
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
          : 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100'
      }`}
    >
      {ACCOUNT_TYPE_LABELS[type]}
    </span>
  );
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'password'; account: Account }
  | { kind: 'type'; account: Account }
  | null;

/** アカウント一覧と、協力会社の追加・パスワード再設定・区分変更。 */
export function AccountsPanel({ accounts }: { accounts: Account[] }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setDialog(null);
  const open = (d: Dialog) => {
    setNotice(null);
    setDialog(d);
  };

  return (
    <div>
      <p className="mb-3 rounded-lg bg-gray-100 p-3 text-sm dark:bg-gray-900">
        社員のアカウント追加は業務日報アプリの『社員・権限管理』から行います。
      </p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">アカウント一覧</h2>
        <button type="button" onClick={() => open({ kind: 'create' })} className={primaryButtonClass}>
          ＋ 協力会社アカウントを追加
        </button>
      </div>
      {notice ? (
        <p role="status" className="mb-3 rounded-lg border border-green-600 bg-green-50 p-3 text-sm text-green-950 dark:bg-green-950 dark:text-green-50">
          {notice}
        </p>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyText>アカウントがありません。</EmptyText>
      ) : (
        <ul>
          {accounts.map((a) => (
            <li key={a.id} className="border-b border-gray-300 py-3 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words font-bold">{a.name || '（名前未設定）'}</span>
                <TypeBadge type={a.accountType} />
                {a.isAdmin ? (
                  <span className="inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                    管理者
                  </span>
                ) : null}
              </div>
              <p className="mt-1 break-all text-sm text-gray-600 dark:text-gray-400">{a.email}</p>
              {a.accountType === 'partner' ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">会社名：{a.companyName || '（未設定）'}</p>
              ) : null}
              {a.accountType === 'partner' || !a.isAdmin ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.accountType === 'partner' ? (
                    <button type="button" onClick={() => open({ kind: 'password', account: a })} className={secondaryButtonClass}>
                      パスワード再設定
                    </button>
                  ) : null}
                  <button type="button" onClick={() => open({ kind: 'type', account: a })} className={secondaryButtonClass}>
                    区分を変更
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <EditDialog open={dialog?.kind === 'create'} title="協力会社アカウントを追加" onClose={close}>
        <CreateForm
          onDone={(message) => {
            setNotice(message);
            close();
          }}
          onCancel={close}
        />
      </EditDialog>
      <EditDialog open={dialog?.kind === 'password'} title="パスワード再設定" onClose={close}>
        {dialog?.kind === 'password' ? (
          <PasswordForm
            account={dialog.account}
            onDone={() => {
              setNotice(`${dialog.account.name || dialog.account.email} のパスワードを再設定しました。新しいパスワードを本人に伝えてください。`);
              close();
            }}
            onCancel={close}
          />
        ) : null}
      </EditDialog>
      <EditDialog open={dialog?.kind === 'type'} title="区分を変更" onClose={close}>
        {dialog?.kind === 'type' ? <TypeForm account={dialog.account} onDone={close} onCancel={close} /> : null}
      </EditDialog>
    </div>
  );
}

function CreateForm({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const { pending, error, setError, runResult } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      companyName: String(fd.get('companyName') ?? ''),
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      password: String(fd.get('password') ?? ''),
    };
    const invalid = firstIssue(partnerAccountSchema, input);
    if (invalid) {
      setError(invalid);
      return;
    }
    runResult(
      () => createPartnerAccount(input),
      () => onDone(`${input.name.trim()}（${input.email.trim()}）の協力会社アカウントを作成しました。現場日報のURLと初期パスワードを本人に伝えてください。`),
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="会社名">
        <input name="companyName" maxLength={100} required className={inputClass} />
      </Field>
      <Field label="氏名">
        <input name="name" maxLength={100} required autoComplete="off" className={inputClass} />
      </Field>
      <Field label="メールアドレス">
        <input name="email" type="email" required autoComplete="off" inputMode="email" className={inputClass} />
      </Field>
      <Field label="初期パスワード（8文字以上）">
        <input name="password" type="text" minLength={8} maxLength={72} required autoComplete="off" className={inputClass} />
      </Field>
      <p className="rounded-lg bg-gray-100 p-3 text-sm dark:bg-gray-900">
        業務日報アプリにはログインできません。現場日報のURLと初期パスワードを本人に伝えてください。
      </p>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} flex-1`}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} flex-1`}>
          {pending ? '作成中…' : '作成'}
        </button>
      </div>
    </form>
  );
}

function PasswordForm({ account, onDone, onCancel }: { account: Account; onDone: () => void; onCancel: () => void }) {
  const { pending, error, setError, runResult } = useRunner();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') ?? '');
    const invalid = firstIssue(passwordSchema, password);
    if (invalid) {
      setError(invalid);
      return;
    }
    runResult(() => resetPartnerPassword(account.id, password), onDone);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm">
        {account.name || account.email}
        {account.companyName ? `（${account.companyName}）` : ''} の新しいパスワードを入力してください。
      </p>
      <Field label="新しいパスワード（8文字以上）">
        <input name="password" type="text" minLength={8} maxLength={72} required autoComplete="off" className={inputClass} />
      </Field>
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} flex-1`}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={`${primaryButtonClass} flex-1`}>
          {pending ? '処理中…' : '再設定'}
        </button>
      </div>
    </form>
  );
}

function TypeForm({ account, onDone, onCancel }: { account: Account; onDone: () => void; onCancel: () => void }) {
  const { pending, error, setError, runResult } = useRunner();
  const [type, setType] = useState<AccountType>(account.accountType);
  const [company, setCompany] = useState(account.companyName ?? '');

  function save() {
    if (type === 'partner' && company.trim() === '') {
      setError('協力会社の会社名を入力してください');
      return;
    }
    runResult(() => updateAccountType(account.id, type, type === 'partner' ? company : null), onDone);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">{account.name || account.email}</p>
      <Field label="区分">
        <select
          value={type}
          onChange={(e) => {
            if (isAccountType(e.target.value)) setType(e.target.value);
          }}
          className={inputClass}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      {type === 'partner' ? (
        <>
          <Field label="会社名">
            <input value={company} maxLength={100} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
          </Field>
          <p className="rounded-lg bg-gray-100 p-3 text-sm dark:bg-gray-900">
            協力会社にすると、業務日報アプリにはログインできなくなります。
          </p>
        </>
      ) : null}
      <ErrorText message={error} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} flex-1`}>
          キャンセル
        </button>
        <button type="button" disabled={pending} onClick={save} className={`${primaryButtonClass} flex-1`}>
          {pending ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
