'use client';

import type { ReactNode } from 'react';
import type { Row } from './form-state';

// 明細表の共通部品。スマホでは1行＝1枚のカード（項目名つき）、md 以上では表として並べる。
// 列の幅は表ごとに gridClass（md:grid-cols-[...]）で指定する。

export interface Column<L> {
  label: string;
  cell: (line: L, index: number, row: Row<L>) => ReactNode;
  /** スマホで横幅いっぱいに置く（名前など）。 */
  wide?: boolean;
  /** 入力欄なら label 要素で包む（計算値の表示は false）。 */
  input?: boolean;
}

export function LineTable<L>({
  title,
  rows,
  columns,
  gridClass,
  minWidthClass,
  onAdd,
  onRemove,
  subtotalLabel,
  subtotal,
  emptyText,
  hint,
  rowExtra,
  rowId,
  rowClass,
}: {
  title: string;
  rows: Row<L>[];
  columns: Column<L>[];
  gridClass: string;
  minWidthClass: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  subtotalLabel: string;
  subtotal: string;
  emptyText: string;
  /** 表の下に出す補足（プルダウンに無いときの案内など）。 */
  hint?: string;
  /** 行の下に横幅いっぱいで出す追加の欄（null なら出さない）。作業内容の区分の指示など。 */
  rowExtra?: (line: L, index: number, row: Row<L>) => ReactNode;
  /** 行の id（スクロール先にする）。 */
  rowId?: (index: number) => string;
  /** 行に足すクラス（強調の枠など）。 */
  rowClass?: (line: L, index: number) => string;
}) {
  return (
    <section aria-label={title} className="mb-8">
      <h2 className="mb-2 border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">
        {title}
        <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">{rows.length}行</span>
      </h2>

      {rows.length === 0 ? (
        <p className="py-3 text-sm text-gray-600 dark:text-gray-400">{emptyText}</p>
      ) : (
        <div className="relative md:overflow-x-auto">
          <div className={minWidthClass}>
            <div
              aria-hidden="true"
              className={`hidden gap-2 border-b border-gray-300 pb-1 text-sm font-bold text-gray-700 md:grid dark:border-gray-700 dark:text-gray-300 ${gridClass}`}
            >
              {columns.map((c) => (
                <span key={c.label}>{c.label}</span>
              ))}
              <span />
            </div>
            <ul className="space-y-3 md:space-y-0">
              {rows.map((row, i) => {
                const extra = rowExtra?.(row.line, i, row) ?? null;
                return (
                  <li
                    key={row.key}
                    id={rowId?.(i)}
                    className={`${rowClass?.(row.line, i) ?? ''} grid grid-cols-2 items-start gap-2 rounded-lg border border-gray-300 p-3 md:items-center md:rounded-none md:border-0 md:border-b md:px-0 md:py-2 dark:border-gray-700 ${gridClass}`}
                  >
                    <p className="col-span-2 text-sm font-bold text-gray-600 md:hidden dark:text-gray-400">
                      {i + 1}行目
                    </p>
                    {columns.map((c) => {
                      const span = c.wide ? 'col-span-2 md:col-span-1' : '';
                      const caption = <span className="mb-0.5 block text-xs text-gray-600 md:sr-only dark:text-gray-400">{c.label}</span>;
                      return c.input === false ? (
                        <div key={c.label} className={span}>
                          {caption}
                          {c.cell(row.line, i, row)}
                        </div>
                      ) : (
                        <label key={c.label} className={`block ${span}`}>
                          {caption}
                          {c.cell(row.line, i, row)}
                        </label>
                      );
                    })}
                    <div className="col-span-2 flex justify-end md:col-span-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`${title}の${i + 1}行目を削除しますか？`)) onRemove(i);
                        }}
                        aria-label={`${title}の${i + 1}行目を削除`}
                        className="min-h-11 min-w-11 rounded-lg border border-red-600 px-3 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-500 dark:text-red-400"
                      >
                        削除
                      </button>
                    </div>
                    {extra !== null && (
                      <div className="col-span-2 rounded-lg bg-gray-100 p-2 md:col-span-full md:mb-1 dark:bg-gray-900">{extra}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="min-h-11 rounded-lg border border-blue-700 px-4 text-base font-bold text-blue-700 disabled:opacity-50 dark:border-blue-400 dark:text-blue-400"
        >
          ＋追加
        </button>
        <p className="text-base">
          {subtotalLabel} <span className="font-bold tabular-nums">{subtotal}</span>
        </p>
      </div>
      {hint && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
    </section>
  );
}
