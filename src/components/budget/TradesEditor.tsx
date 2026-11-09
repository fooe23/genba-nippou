'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TRADE_NAME_MAX, firstIssueMessage, tradesInputSchema } from '@/lib/budget/schemas';
import type { SiteTrade } from '@/lib/budget/types';
import { saveTrades } from '@/lib/db/budget-actions';
import { EmptyText, ErrorText, inputClass, primaryButtonClass, secondaryButtonClass, useRunner } from '@/components/masters/common';
import { DirtyNote, cardClass, dangerSmallButtonClass, rowKey, sectionHeadingClass, smallButtonClass } from './common';

interface Row {
  key: string;
  id: string | null;
  name: string;
}

function toRows(trades: SiteTrade[]): Row[] {
  return [...trades].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => ({ key: t.id, id: t.id, name: t.name }));
}

/**
 * 現場の工種（実行予算の工種）の一覧：足す・名前を変える・並べ替える・消す。保存すると一覧の全部を saveTrades に送る。
 * 日報・読み替え表・実行予算・内訳・進み具合で使われている工種は DB が消させない（文言を出す）。
 */
export function TradesEditor({ siteId, trades, readOnly }: { siteId: string; trades: SiteTrade[]; readOnly: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useRunner();
  const [rows, setRows] = useState<Row[]>(() => toRows(trades));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function change(next: Row[]) {
    setRows(next);
    setDirty(true);
    setSaved(false);
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  }

  function save() {
    const input = rows.map((r) => ({ id: r.id, name: r.name }));
    const parsed = tradesInputSchema.safeParse(input);
    if (!parsed.success) {
      setLocalError(firstIssueMessage(parsed.error, '工種の'));
      return;
    }
    setLocalError(null);
    run(
      async () => {
        const res = await saveTrades(siteId, input);
        if (res.ok) setRows(toRows(res.trades));
        return res;
      },
      () => {
        setDirty(false);
        setSaved(true);
        router.refresh();
      },
    );
  }

  return (
    <section aria-labelledby="budget-trades" className="space-y-3">
      <h2 id="budget-trades" className={sectionHeadingClass}>
        工種（{rows.length}）
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        実行予算と元請けの内訳を分ける工種です（協力会社のアカウントにも名前だけ見えます）。日報の作業内容の行でこの工種から選ぶ機能は次の段階で追加します。実行予算・内訳などで使っている工種は消せません。
      </p>
      {rows.length === 0 ? (
        <EmptyText>工種はまだありません。</EmptyText>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className={`${cardClass} flex items-center gap-2`}>
              <input
                aria-label={`工種 ${i + 1} の名前`}
                value={r.name}
                maxLength={TRADE_NAME_MAX}
                disabled={readOnly || pending}
                onChange={(e) => change(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
                className={`${inputClass} min-w-0 flex-1`}
              />
              {!readOnly && (
                <>
                  <button type="button" aria-label="上へ" onClick={() => move(i, -1)} disabled={pending || i === 0} className={smallButtonClass}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="下へ"
                    onClick={() => move(i, 1)}
                    disabled={pending || i === rows.length - 1}
                    className={smallButtonClass}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`工種「${r.name}」を消す`}
                    onClick={() => change(rows.filter((x) => x.key !== r.key))}
                    disabled={pending}
                    className={dangerSmallButtonClass}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => change([...rows, { key: rowKey(), id: null, name: '' }])}
            disabled={pending}
            className={secondaryButtonClass}
          >
            ＋ 工種を追加
          </button>
          <button type="button" onClick={save} disabled={pending || !dirty} className={`${primaryButtonClass} sm:flex-1`}>
            {pending ? '保存中…' : '工種を保存'}
          </button>
        </div>
      )}
      <DirtyNote dirty={dirty} />
      {saved && (
        <p role="status" className="text-sm font-medium text-green-800 dark:text-green-300">
          工種を保存しました。
        </p>
      )}
      <ErrorText message={localError ?? error} />
    </section>
  );
}
