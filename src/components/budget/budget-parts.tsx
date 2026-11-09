import type { TradeRow } from '@/lib/budget/budget-model';
import { TAG_TONE_CLASS, percentText, progressBar, type TagTone } from '@/lib/budget/budget-view';

// 予算と実績の画面（表とカード）で共通の小物。

export const smallTextClass = 'block text-xs text-gray-600 dark:text-gray-400';

/** 判定などの札。 */
export function Tag({ label, tone }: { label: string; tone: TagTone }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${TAG_TONE_CLASS[tone]}`}>{label}</span>
  );
}

/** 進み具合の棒（青＝使っている %、赤い線＝数量から）。読み上げは隣の文字に任せる。 */
export function ProgressBar({ progress }: { progress: TradeRow['progress'] }) {
  const bar = progressBar(progress);
  return (
    <span aria-hidden="true" className="relative inline-block h-2 w-[70px] shrink-0 rounded bg-gray-200 align-middle dark:bg-gray-700">
      {bar.used !== null && <i className="absolute inset-y-0 left-0 rounded bg-blue-600" style={{ width: `${bar.used}%` }} />}
      {bar.qtyMark !== null && (
        <b className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-red-600" style={{ left: `calc(${bar.qtyMark}% - 1px)` }} />
      )}
    </span>
  );
}

/** 進み具合の欄：棒・使っている %・「数量から X%」・数量からが 100% を超えたときの注意。 */
export function ProgressCell({ progress }: { progress: TradeRow['progress'] }) {
  const bar = progressBar(progress);
  return (
    <span className="inline-block text-right">
      <span className="inline-flex items-center gap-1.5">
        <ProgressBar progress={progress} />
        <span>{percentText(progress.used)}</span>
      </span>
      {progress.override !== null && <span className={smallTextClass}>上書き</span>}
      {progress.fromQty !== null && <span className={smallTextClass}>数量から {percentText(progress.fromQty)}</span>}
      {bar.overQty && (
        <span className="block text-xs font-medium text-amber-800 dark:text-amber-300">内訳の数量より多く施工しています</span>
      )}
    </span>
  );
}
