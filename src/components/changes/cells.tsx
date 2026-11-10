import type { ReactNode } from 'react';
import { decimal, money } from '@/components/report/form-state';
import { affiliationManDaysText } from '@/lib/reports/affiliation-breakdown';
import type { ChangesRow } from '@/lib/reports/changes-page';
import { MISSING_AMOUNT_NOTE, MISSING_AMOUNT_WARNING, breakdownParts, ratePercent } from '@/lib/reports/settlement-breakdown';
import type { ChangeRates, SettlementBreakdown } from '@/lib/reports/types';

// 「追加・変更の一覧」の行の部品（サーバー・クライアントの両方から使う。'use client' を付けない）。
// 2xl（1536px）以上は 1 行 14 列の表、2xl 未満は件ごとのカード（2 列。見出しを各欄の上に出す）。
// 表は 2xl のページ幅（max-w-[96rem]＝1536px から左右の余白・縦スクロールバーを引いた約 93rem）に収まる幅にする
// （列の固定幅の合計 86.5rem ＋ 列の間 13 × 0.375rem ≒ 91.4rem）。1280〜1535px で表にすると左右の列が見切れたため。

/** 列の幅（見出し・件の行・件なしの行・合計の行で共通）。 */
export const CHANGES_GRID =
  '2xl:grid-cols-[5rem_5.5rem_minmax(10rem,1fr)_6rem_6rem_6rem_7rem_8.5rem_3rem_4rem_6.5rem_6.5rem_7.5rem_5rem]';
/** 表の最小幅（2xl 以上。列の幅の合計。ページ幅に収まるので普段は横スクロールしない）。 */
export const CHANGES_MIN_WIDTH = '2xl:min-w-[91.5rem]';
/** 1 件の行（カード）の外枠。 */
export const CHANGES_ROW =
  'grid grid-cols-2 items-start gap-2 rounded-lg border border-gray-300 p-3 2xl:items-center 2xl:gap-x-1.5 2xl:rounded-none 2xl:border-0 2xl:border-b 2xl:px-0 2xl:py-2 dark:border-gray-700';

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

const captionClass = 'mb-0.5 block text-xs text-gray-600 2xl:sr-only dark:text-gray-400';

/** 見出しつきの欄。2xl 未満は見出しを上に出し、2xl 以上は見出しを読み上げ用だけにする。wide は 2xl 未満で 2 列ぶん。 */
export function Cell({ label, wide = false, num = false, children }: { label: string; wide?: boolean; num?: boolean; children: ReactNode }) {
  return (
    <div className={`${wide ? 'col-span-2 2xl:col-span-1' : ''} ${num ? '2xl:text-right tabular-nums' : ''}`}>
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

/**
 * 人工の所属別の内訳「所属別の人工：自社 2.0／〇〇工業 1.5」（その日の労務の行の所属別の人工比で按分）。
 * 人工の欄は狭いので、2xl 以上は行の幅いっぱいの 2 段目（右寄せ）、未満はカードの中に出す。紐づく行が無ければ出さない。
 */
export function AffiliationNote({ row }: { row: ChangesRow }) {
  const text = affiliationManDaysText(row.affiliationManDays);
  if (!text) return null;
  return (
    <p className="col-span-2 break-words text-sm text-gray-700 2xl:col-span-full 2xl:text-right dark:text-gray-300">
      <span className="font-bold">所属別の人工：</span>
      {text}
    </p>
  );
}

/**
 * 件の精算の内訳（社内用）：「精算の内訳：労務（施工金額） ¥25,000 法定福利費 15.1%・材料 ¥25,000 材料経費 12%（諸経費 8%）」。
 * 根拠にその件を選んだ行だけ。項目が無ければ出さない。375px では折り返す。
 */
export function BreakdownNote({ breakdown, rates }: { breakdown: SettlementBreakdown; rates: ChangeRates }) {
  const parts = breakdownParts(breakdown, rates);
  if (parts.length === 0) return null;
  return (
    <p className="col-span-2 break-words text-sm text-gray-700 2xl:col-span-full 2xl:text-right dark:text-gray-300">
      <span className="font-bold">精算の内訳：</span>
      {parts.map((p, i) => (
        <span key={p.label} className="inline-block">
          {i > 0 && <span aria-hidden="true">・</span>}
          {p.label} {money(p.amount)}
          <span className="text-xs text-gray-600 dark:text-gray-400">（{p.rate}）</span>
        </span>
      ))}
      <span className="inline-block text-xs text-gray-600 dark:text-gray-400">　諸経費 {ratePercent(rates.overheadProfitRate)}%（外注を除く）</span>
    </p>
  );
}

/** 施工金額（施工単価）の無い追加・増・変更の行がある知らせ（count 行）。0 なら出さない。 */
export function MissingAmountNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <p role="note" className="col-span-2 flex items-start gap-1.5 text-sm font-bold text-amber-800 2xl:col-span-full 2xl:justify-end dark:text-amber-300">
      <span aria-hidden="true">⚠</span>
      <span>
        {MISSING_AMOUNT_WARNING}（{count}行）。<span className="font-normal">{MISSING_AMOUNT_NOTE}</span>
      </span>
    </p>
  );
}
