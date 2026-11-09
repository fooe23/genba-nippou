'use client';

import { useRouter } from 'next/navigation';
import type { UnmappedTradeText } from '@/lib/budget/resolve-trade';
import type { SiteTrade, TradeAlias } from '@/lib/budget/types';
import { setTradeAlias } from '@/lib/db/budget-actions';
import { EmptyText, ErrorText, inputClass, useRunner } from '@/components/masters/common';
import { cardClass, dangerSmallButtonClass } from './common';

/** 人工の表示（小数は最大 2 桁、末尾の 0 は付けない）。 */
function manDaysText(n: number): string {
  return `${Number(n.toFixed(2))} 人工`;
}

/**
 * 日報の工種の読み替え表：まだ工種に決まらない日報の工種の文字を、実行予算の工種に割り当てる。
 * 割り当て済みの文字も一覧にして、割り当て先を変える・外すことができる。日報の行は書き換えない（集計で読み替える）。
 * 書き込みは setTradeAlias（社員・管理者だけ。完了現場は readOnly）。
 */
export function AliasMapper({
  siteId,
  trades,
  aliases,
  unmapped,
  readOnly,
}: {
  siteId: string;
  trades: SiteTrade[];
  aliases: TradeAlias[];
  unmapped: UnmappedTradeText[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, error, runResult } = useRunner();
  const disabled = readOnly || pending || trades.length === 0;
  const tradeName = new Map(trades.map((t) => [t.id, t.name]));

  function assign(text: string, tradeId: string | null) {
    runResult(() => setTradeAlias(siteId, text, tradeId), () => router.refresh());
  }

  const options = trades.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}
    </option>
  ));

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        日報の作業内容の行で工種を選んでいない行は、工種の文字で工種を決めます（ここで割り当てた文字は割り当てた工種、それ以外で工種の名前と同じ文字はその工種、どちらでもない文字は「予算外の作業」）。日報の行は書き換えません。
      </p>
      {trades.length === 0 && <EmptyText>先に工種を入れてください。</EmptyText>}
      <ErrorText message={error} />

      <div className="space-y-2">
        <h3 className="text-base font-bold">まだ割り当てていない工種の文字（{unmapped.length}）</h3>
        {unmapped.length === 0 ? (
          <EmptyText>割り当てていない工種の文字はありません。</EmptyText>
        ) : (
          <ul className="space-y-2">
            {unmapped.map((u) => (
              <li key={u.text} className={`${cardClass} grid gap-2 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center`}>
                <div className="min-w-0">
                  <p className="break-words font-medium">「{u.text}」</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {u.lineCount} 行・{manDaysText(u.manDays)}
                  </p>
                </div>
                <label className="block min-w-0">
                  <span className="sr-only">「{u.text}」を入れる工種</span>
                  <select
                    value=""
                    disabled={disabled}
                    onChange={(e) => {
                      if (e.target.value !== '') assign(u.text, e.target.value);
                    }}
                    className={inputClass}
                  >
                    <option value="">予算外のまま</option>
                    {options}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-base font-bold">割り当て済み（{aliases.length}）</h3>
        {aliases.length === 0 ? (
          <EmptyText>割り当て済みの工種の文字はありません。</EmptyText>
        ) : (
          <ul className="space-y-2">
            {aliases.map((a) => (
              <li key={a.tradeText} className={`${cardClass} grid gap-2 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-center`}>
                <p className="min-w-0 break-words font-medium">「{a.tradeText}」</p>
                <label className="block min-w-0">
                  <span className="sr-only">「{a.tradeText}」を入れる工種</span>
                  <select
                    value={a.tradeId}
                    disabled={disabled}
                    onChange={(e) => {
                      if (e.target.value !== '' && e.target.value !== a.tradeId) assign(a.tradeText, e.target.value);
                    }}
                    className={inputClass}
                  >
                    {!tradeName.has(a.tradeId) && <option value={a.tradeId}>（不明な工種）</option>}
                    {options}
                  </select>
                </label>
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={readOnly || pending}
                    onClick={() => {
                      if (window.confirm(`「${a.tradeText}」の割り当てを外しますか？`)) assign(a.tradeText, null);
                    }}
                    aria-label={`「${a.tradeText}」の割り当てを外す`}
                    className={dangerSmallButtonClass}
                  >
                    外す
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
