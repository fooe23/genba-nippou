'use client';

import { useState, useTransition } from 'react';
import { jpDateTime } from '@/lib/calc/format';
import { clientConfirmationSchema, isoToJstLocal, jstLocalToIso } from '@/lib/db/client-confirmation-schemas';
import { clearClientConfirmation, recordClientConfirmation, type ClientConfirmationResult } from '@/lib/db/reports-actions';
import { STALE_CONFIRMATION_MESSAGE } from '@/lib/report/rows';
import type { DailyClientConfirmation } from '@/lib/reports/types';
import { EditDialog } from '@/components/masters/EditDialog';
import { fieldClass, TextInput } from './inputs';

// 日報画面の「客先確認を記録」。日報の保存とは別に、確認者名・日時・メモだけをすぐ記録する。
// 状態（提出後・承認後）や現場の完了に関係なく、日報を見られる人（現場メンバー）なら記録・取り消しできる。

const FAILED = '記録できませんでした。通信状況を確認してもう一度お試しください。';
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

interface Props {
  reportId: string;
  /** いまの記録（無ければ null）。 */
  current: DailyClientConfirmation | null;
  /** 楽観ロックの版（日報画面の expected）。 */
  expected: string | null;
  /** 記録・取り消しのあと。updatedAt は新しい版。 */
  onChanged: (updatedAt: string | null) => void;
}

/** 「客先確認：{名前} {YYYY/MM/DD HH:mm}」。 */
export function clientConfirmationLabel(c: DailyClientConfirmation): string {
  return `客先確認：${c.by} ${jpDateTime(c.at)}`;
}

function ConfirmationForm({ reportId, current, expected, onChanged, onClose }: Props & { onClose: () => void }) {
  const [by, setBy] = useState(current?.by ?? '');
  // 既定は今（日本時間）。記録し直すときは前の記録の値。
  const [at, setAt] = useState(() => isoToJstLocal(current?.at ?? new Date().toISOString()));
  const [note, setNote] = useState(current?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function record() {
    const input = { confirmedBy: by, confirmedAt: jstLocalToIso(at), note };
    const checked = clientConfirmationSchema.safeParse(input);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? '入力内容が正しくありません');
      return;
    }
    setError(null);
    startTransition(async () => {
      let res: ClientConfirmationResult;
      try {
        res = await recordClientConfirmation(reportId, checked.data, expected);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        // 他の端末で更新されていたら、保存ではなく「再読み込みしてからもう一度記録」を案内する。
        setError(res.stale ? STALE_CONFIRMATION_MESSAGE : res.error);
        return;
      }
      onChanged(res.updatedAt);
      onClose();
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        record();
      }}
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">客先が作業内容を確認したことを記録します。日報 PDF の「客先確認」欄に出ます。</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">確認者名（必須）</span>
        <TextInput value={by} maxLength={100} placeholder="例：施主 〇〇様" onChange={setBy} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">日時</span>
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={fieldClass} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">メモ（500文字まで）</span>
        <textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} className={`${fieldClass} py-2`} />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={`${buttonBase} border border-gray-400 font-medium dark:border-gray-600`}>
          キャンセル
        </button>
        <button type="submit" disabled={pending} className={`${buttonBase} bg-blue-700 text-white`}>
          {pending ? '記録中…' : '記録する'}
        </button>
      </div>
    </form>
  );
}

/** 「客先確認を記録」ボタンとダイアログ（PDF・CSV のリンクの横に置く）。記録済みなら前の値で開き、上書きする。 */
export function ClientConfirmationButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-blue-700 px-3 text-sm font-medium text-blue-700 dark:border-blue-400 dark:text-blue-400"
      >
        客先確認を記録
      </button>
      <EditDialog open={open} title="客先確認を記録" onClose={() => setOpen(false)}>
        <ConfirmationForm {...props} onClose={() => setOpen(false)} />
      </EditDialog>
    </>
  );
}

/** 記録済みの客先確認（名前・日時・メモ）と「取り消す」。記録が無ければ何も出さない。 */
export function ClientConfirmationStatus({ reportId, current, expected, onChanged }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!current) return null;

  function clear() {
    if (!window.confirm('客先確認の記録を取り消します。よろしいですか？')) return;
    setError(null);
    startTransition(async () => {
      let res: ClientConfirmationResult;
      try {
        res = await clearClientConfirmation(reportId, expected);
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        // 他の端末で更新されていたら、保存ではなく「再読み込みしてからもう一度記録」を案内する。
        setError(res.stale ? STALE_CONFIRMATION_MESSAGE : res.error);
        return;
      }
      onChanged(res.updatedAt);
    });
  }

  return (
    <div role="status" className="mb-4 rounded-lg border border-green-600 bg-green-50 px-3 py-1 text-green-950 dark:bg-green-950 dark:text-green-50">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="py-2 font-bold break-words">{clientConfirmationLabel(current)}</p>
        <button
          type="button"
          onClick={clear}
          disabled={pending}
          className="min-h-11 text-sm font-medium text-blue-700 underline disabled:opacity-50 dark:text-blue-400"
        >
          {pending ? '取り消し中…' : '取り消す'}
        </button>
      </div>
      {current.note && <p className="pb-2 text-sm whitespace-pre-wrap break-words">{current.note}</p>}
      {error && (
        <p role="alert" className="mb-2 rounded-lg border border-red-500 bg-red-50 p-2 text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
    </div>
  );
}
