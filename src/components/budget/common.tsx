'use client';

import { useState } from 'react';

// 実行予算・元請けの内訳の画面で共通の小物。

export const smallButtonClass =
  'min-h-11 min-w-11 rounded-lg border border-gray-400 px-3 text-base font-medium disabled:opacity-40 dark:border-gray-600';
export const dangerSmallButtonClass =
  'min-h-11 min-w-11 rounded-lg border border-red-600 px-3 text-base font-medium text-red-700 disabled:opacity-40 dark:border-red-500 dark:text-red-400';
export const cardClass = 'rounded-lg border border-gray-300 p-3 dark:border-gray-700';
export const sectionHeadingClass = 'text-lg font-bold';

let seq = 0;
/** 画面の行の key（保存前の行にも付ける）。 */
export function rowKey(): string {
  seq += 1;
  return `row-${seq}`;
}

/** 数の入力の文字 → 数（空欄は null、読めなければ NaN）。カンマは除く。 */
export function parseNum(raw: string): number | null {
  const t = raw.normalize('NFKC').replace(/[,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** 数 → 入力欄の文字。 */
export function numText(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n);
}

/** 未保存の変更があるときの案内。 */
export function DirtyNote({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return (
    <p role="status" className="text-sm font-medium text-amber-800 dark:text-amber-300">
      保存していない変更があります。
    </p>
  );
}

/**
 * 保存・取り込みで元の中身（sig）が変わったら、編集中の状態を作り直す。
 * key で部品ごと作り直すと、画面の再読み込みのときに古い欄が残って二重に見えることがあったため、部品はそのまま状態だけ入れ替える。
 */
export function useResetOnChange(sig: string, reset: () => void) {
  const [prev, setPrev] = useState(sig);
  if (prev !== sig) {
    setPrev(sig);
    reset();
  }
}
