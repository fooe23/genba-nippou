'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { jpDateTime } from '@/lib/calc/format';

export const inputClass =
  'min-h-11 w-full rounded-lg border border-gray-400 bg-background px-3 text-base text-foreground dark:border-gray-600';
export const primaryButtonClass =
  'min-h-11 rounded-lg bg-blue-700 px-4 text-base font-bold text-white disabled:opacity-50';
export const secondaryButtonClass =
  'min-h-11 rounded-lg border border-gray-400 px-4 text-base font-medium disabled:opacity-50 dark:border-gray-600';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
      {message}
    </p>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${
        active
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
          : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
      }`}
    >
      {active ? '有効' : '無効'}
    </span>
  );
}

/** 一覧ヘッダー（見出しと「追加」ボタン）。 */
export function ListHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold">{title}</h2>
      <button type="button" onClick={onAdd} className={primaryButtonClass}>
        ＋ 追加
      </button>
    </div>
  );
}

/** 一覧の行（タップで編集）。 */
export function Row({
  title,
  sub,
  meta,
  right,
  dim,
  onClick,
}: {
  title: string;
  sub?: string | null;
  /** sub の下に小さく出す 1 行（例: 更新日時と更新者）。 */
  meta?: string | null;
  right?: ReactNode;
  dim?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-14 w-full items-center justify-between gap-3 border-b border-gray-300 px-1 py-2 text-left dark:border-gray-700 ${
          dim ? 'opacity-60' : ''
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-bold">{title}</span>
          {sub ? <span className="block truncate text-sm text-gray-600 dark:text-gray-400">{sub}</span> : null}
          {meta ? <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{meta}</span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-sm">{right}</span>
      </button>
    </li>
  );
}

/** 更新者の表示名（id → 氏名、無ければメール）。管理画面のページで profiles から作る。 */
export type Updaters = Record<string, string>;

/** 「更新 2026/11/03 09:15 山田 太郎」。日時が無ければ null、更新者の名前が引けなければ名前を省く。 */
export function updatedLabel(
  updatedAt: string | null | undefined,
  updatedBy: string | null | undefined,
  updaters: Updaters,
  prefix = '更新',
): string | null {
  if (!updatedAt) return null;
  const who = updatedBy ? updaters[updatedBy] : undefined;
  return `${prefix} ${jpDateTime(updatedAt)}${who ? ` ${who}` : ''}`;
}

/** 編集ダイアログの末尾などに出す更新日時と更新者の 1 行。 */
export function UpdatedText({
  updatedAt,
  updatedBy,
  updaters,
  prefix,
}: {
  updatedAt: string | null | undefined;
  updatedBy: string | null | undefined;
  updaters: Updaters;
  prefix?: string;
}) {
  const label = updatedLabel(updatedAt, updatedBy, updaters, prefix);
  if (!label) return null;
  return <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>;
}

export function EmptyText({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-600 dark:text-gray-400">{children}</p>;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Server Action 呼び出し用: 実行中フラグとエラー文言を管理する。 */
export function useRunner() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(task: () => Promise<void>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await task();
        onDone?.();
      } catch (e) {
        // 本番では Server Action のエラー文言が伏せられるため、検証は事前にクライアントで行う。
        const detail = process.env.NODE_ENV !== 'production' && e instanceof Error ? `（${e.message}）` : '';
        setError(`保存に失敗しました。もう一度お試しください。${detail}`);
      }
    });
  }

  /** 結果オブジェクト（{ ok } | { ok:false, error }）を返す Server Action 用。error はそのまま画面に出す。 */
  function runResult(task: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await task();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        onDone?.();
      } catch {
        setError('処理に失敗しました。通信状況を確認してもう一度お試しください。');
      }
    });
  }

  return { pending, error, setError, run, runResult };
}

/** FormData から文字列を取り出す（無ければ空文字）。 */
export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

/** 数値入力。空欄は null、数値にできなければ NaN。 */
export function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  return Number(t);
}

/** 「無効にする」/「有効に戻す」。削除はせず active を切り替える。 */
export function ActiveToggle({
  active,
  pending,
  onToggle,
}: {
  active: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!active || window.confirm('無効にします。日報の選択肢には表示されなくなります（データは残ります）。よろしいですか？')) {
          onToggle();
        }
      }}
      className={`min-h-11 w-full rounded-lg border px-4 text-base font-medium disabled:opacity-50 ${
        active
          ? 'border-red-600 text-red-700 dark:border-red-500 dark:text-red-400'
          : 'border-gray-400 dark:border-gray-600'
      }`}
    >
      {active ? '無効にする' : '有効に戻す'}
    </button>
  );
}
