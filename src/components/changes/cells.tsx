import type { ReactNode } from 'react';
import { decimal, money } from '@/components/report/form-state';
import type { ChangesRow } from '@/lib/reports/changes-page';

// 「追加・変更の一覧」の行の部品（サーバー・クライアントの両方から使う。'use client' を付けない）。
// md 以上は 1 行 14 列の表（横にはみ出す分はスクロール）、md 未満は件ごとのカード（2 列。見出しを各欄の上に出す）。

/** 列の幅（見出し・件の行・件なしの行・合計の行で共通）。 */
export const CHANGES_GRID =
  'md:grid-cols-[5rem_6.5rem_minmax(12rem,1fr)_6.5rem_6.5rem_6.5rem_7.5rem_9rem_3rem_4rem_7rem_7rem_8rem_5rem]';
/** 表の最小幅（md 以上。これより狭い画面では横にスクロールする）。 */
export const CHANGES_MIN_WIDTH = 'md:min-w-[100rem]';
/** 1 件の行（カード）の外枠。 */
export const CHANGES_ROW =
  'grid grid-cols-2 items-start gap-2 rounded-lg border border-gray-300 p-3 md:items-center md:gap-x-2 md:rounded-none md:border-0 md:border-b md:px-0 md:py-2 dark:border-gray-700';

export const CHANGES_COLUMNS = [
  '日付',
  '種別',
  '本文',
  '指示者／方法',
  '見込み額',
  '精算方法',
  '確定額／常用単価',
  '確定日',
  '行数',
  '人工',
  '実績原価',
  '提案額',
  '精算額',
  '',
] as const;

const captionClass = 'mb-0.5 block text-xs text-gray-600 md:sr-only dark:text-gray-400';

/** 見出しつきの欄。md 未満は見出しを上に出し、md 以上は見出しを読み上げ用だけにする。wide は md 未満で 2 列ぶん。 */
export function Cell({ label, wide = false, num = false, children }: { label: string; wide?: boolean; num?: boolean; children: ReactNode }) {
  return (
    <div className={`${wide ? 'col-span-2 md:col-span-1' : ''} ${num ? 'md:text-right tabular-nums' : ''}`}>
      <span className={captionClass}>{label}</span>
      {children}
    </div>
  );
}

/** 入力つきの欄（見出しを入力のラベルにする）。 */
export function InputCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={captionClass}>{label}</span>
      {children}
    </label>
  );
}

export function KindTag({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-block rounded border px-1 text-xs font-bold ${
        muted ? 'border-gray-400 text-gray-600 dark:text-gray-400' : 'border-blue-700 text-blue-800 dark:border-blue-400 dark:text-blue-300'
      }`}
    >
      {children}
    </span>
  );
}

const BASIS_LABELS = { fixed: '確定額', daily_rate: '人工 × 常用単価', proposal: '提案額で仮に' } as const;

/** 行数・人工・実績原価・提案額・精算額の 5 欄（件の行と件なしの行で共通）。やり直しは「（参考）」を付ける。 */
export function ComputedCells({ row }: { row: ChangesRow }) {
  const basis = row.unlinked ? '提案額' : BASIS_LABELS[row.settledBasis];
  return (
    <>
      <Cell label="行数" num>
        {row.lineCount}
      </Cell>
      <Cell label="人工" num>
        {decimal(row.manDays)}
      </Cell>
      <Cell label="実績原価" num>
        {money(row.actualCost)}
      </Cell>
      <Cell label="提案額" num>
        {money(row.proposal)}
      </Cell>
      <Cell label="精算額" num>
        <span className="font-bold">
          {row.countsToward ? '' : '（参考）'}
          {money(row.settled)}
        </span>
        <span className="block text-xs text-gray-600 dark:text-gray-400">{basis}</span>
      </Cell>
    </>
  );
}
