'use client';

import { useMemo, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { diffImport, planTradeSaves, toBudgetLineInputs, toContractItemInputs } from '@/lib/budget/import-diff';
import type { ParsedBudgetWorkbook } from '@/lib/budget/parse-template';
import type { ContractMode } from '@/lib/budget/schemas';
import type { BudgetData } from '@/lib/budget/types';
import { replaceBudgetLines, replaceContractItems, saveTrades } from '@/lib/db/budget-actions';
import { ErrorText, Field, primaryButtonClass, secondaryButtonClass } from '@/components/masters/common';
import { cardClass, sectionHeadingClass } from './common';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const linkClass =
  'flex min-h-11 flex-1 items-center justify-center rounded-lg border border-blue-700 px-3 text-center text-base font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400';

function NameList({ title, names, tone }: { title: string; names: string[]; tone?: 'warn' }) {
  if (names.length === 0) return null;
  return (
    <div>
      <p className={`text-sm font-bold ${tone === 'warn' ? 'text-amber-800 dark:text-amber-300' : ''}`}>{title}</p>
      <p className="text-sm">{names.map((n) => `「${n}」`).join('　')}</p>
    </div>
  );
}

/**
 * Excel 雛形の書き出しと取り込み：ファイルを選ぶ → 差分と誤りを見る → 取り込む。
 * 取り込みは画面の直接入力と同じ Action（saveTrades → replaceBudgetLines → replaceContractItems → 消す工種があれば
 * saveTrades をもう一度）を順に呼ぶ。工種は名前で突き合わせ、使われている工種は Excel に無くても残す。
 */
export function ImportDialog({
  siteId,
  current,
  usedTradeIds,
  partners,
  dailyRate,
  readOnly,
}: {
  siteId: string;
  current: BudgetData;
  /** 日報の作業内容の行から使われている工種の id。 */
  usedTradeIds: string[];
  /** 協力会社の印のある会社（施工者の名前の突き合わせ）。 */
  partners: { id: string; name: string }[];
  dailyRate: number | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedBudgetWorkbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [mode, setMode] = useState<ContractMode>('replace');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const used = useMemo(() => new Set(usedTradeIds), [usedTradeIds]);
  const diff = useMemo(() => (parsed ? diffImport(current, parsed, mode, used) : null), [parsed, current, mode, used]);
  const nothing = diff !== null && diff.budgetLinesCount === 0 && diff.contractItemsCount === 0 && diff.addTrades.length === 0 && diff.removeTrades.length === 0;

  function reset() {
    setParsed(null);
    setFileName('');
    setError(null);
    setInputKey((k) => k + 1);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParsed(null);
    setError(null);
    setDone(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setError('ファイルが大きすぎます（10MB まで）');
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Excel（.xlsx）のファイルを選んでください。');
      return;
    }
    setReading(true);
    try {
      // SheetJS は取り込みでだけ使うので遅延読み込み
      const { parseBudgetWorkbook } = await import('@/lib/budget/parse-template');
      setParsed(parseBudgetWorkbook(await file.arrayBuffer(), { partners, dailyRate }));
    } catch (err) {
      console.error('[budget import] read', err);
      setError('ファイルを読み取れませんでした。アプリから書き出した Excel か確認してください。');
    } finally {
      setReading(false);
    }
  }

  function submit() {
    if (!parsed || !diff || parsed.errors.length > 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const plan = planTradeSaves(current, parsed, diff);
        const first = await saveTrades(siteId, plan.first);
        if (!first.ok) {
          setError(`工種を保存できませんでした：${first.error}`);
          return;
        }
        const ids = new Map(first.trades.map((t) => [t.name, t.id]));
        if (diff.budgetLinesCount > 0) {
          const res = await replaceBudgetLines(siteId, toBudgetLineInputs(parsed, ids));
          if (!res.ok) {
            setError(`実行予算を取り込めませんでした（工種は保存済み）：${res.error}`);
            router.refresh();
            return;
          }
        }
        if (diff.contractItemsCount > 0) {
          const res = await replaceContractItems(siteId, toContractItemInputs(parsed, ids), mode);
          if (!res.ok) {
            setError(`受注の内訳を取り込めませんでした（工種${diff.budgetLinesCount > 0 ? '・実行予算' : ''}は取り込み済み）：${res.error}`);
            router.refresh();
            return;
          }
        }
        let note = '';
        if (plan.final) {
          // 消す工種は、予算・内訳を入れ替えた後で消す（使われていれば DB が断るので、そのときは残して知らせる）
          const final = await saveTrades(siteId, plan.final.map((t) => ({ id: t.id ?? ids.get(t.name) ?? null, name: t.name })));
          if (!final.ok) note = `（Excel に無い工種は消せなかったので残しました：${final.error}）`;
        }
        setDone(`取り込みました。${note}`);
        setParsed(null);
        setInputKey((k) => k + 1);
        router.refresh();
      } catch {
        setError('取り込みに失敗しました。通信状況を確認してもう一度お試しください。');
        router.refresh();
      }
    });
  }

  const enc = encodeURIComponent(siteId);
  return (
    <section aria-labelledby="budget-excel" className="space-y-3">
      <h2 id="budget-excel" className={sectionHeadingClass}>
        Excel で入れる・書き出す
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        書き出した Excel（シート「実行予算」「受注の内訳」「選択肢」）を直して取り込むと、画面で入れたのと同じ中身になります。工種・施工者・項目はプルダウンから選べます。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a href={`/api/budget/template?site=${enc}&mode=current`} className={linkClass}>
          いまの予算・内訳を書き出す
        </a>
        <a href={`/api/budget/template?site=${enc}&mode=empty`} className={linkClass}>
          空の雛形を書き出す
        </a>
      </div>
      {!readOnly && (
        <Field label="取り込む Excel（.xlsx）">
          <input
            key={inputKey}
            type="file"
            accept=".xlsx"
            onChange={onFile}
            disabled={reading || pending}
            className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-gray-400 file:bg-background file:px-4 file:text-base file:font-medium dark:file:border-gray-600"
          />
        </Field>
      )}
      {reading && (
        <p role="status" className="text-sm font-medium">
          読み取り中…
        </p>
      )}
      {done && (
        <p role="status" className="text-sm font-medium text-green-800 dark:text-green-300">
          {done}
        </p>
      )}
      <ErrorText message={error} />

      {parsed && diff && (
        <div className={`${cardClass} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold">取り込む内容の確認</h3>
            <span className="truncate text-sm text-gray-600 dark:text-gray-400">{fileName}</span>
          </div>
          {parsed.errors.length > 0 && (
            <div role="alert" className="space-y-1 rounded-lg border border-red-600 p-2 dark:border-red-500">
              <p className="text-sm font-bold text-red-700 dark:text-red-400">
                直す必要のある行が {parsed.errors.length} 件あります。Excel を直してから、もう一度選んでください。
              </p>
              <ul className="space-y-1 text-sm">
                {parsed.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>
                    {e.sheet}
                    {e.row > 0 ? `の${e.row}行目` : ''}：{e.message}
                  </li>
                ))}
                {parsed.errors.length > 50 && <li>ほか {parsed.errors.length - 50} 件</li>}
              </ul>
            </div>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="space-y-1 text-sm font-medium text-amber-800 dark:text-amber-300">
              {parsed.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <NameList title="足す工種" names={diff.addTrades} />
          <NameList title="消す工種（Excel に無く、どこでも使われていない）" names={diff.removeTrades} />
          <NameList title="Excel に無い工種（使用中のため残します）" names={diff.keptMissingTrades} tone="warn" />
          {diff.addTrades.length > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400">工種は名前で突き合わせます。Excel で名前を変えると別の工種として足されます（名前の変更はこの画面の「工種」で）。</p>
          )}
          <p className="text-sm">
            <span className="font-bold">実行予算：</span>
            {diff.budgetLinesCount > 0 ? `${diff.budgetLinesCount} 行で全部入れ替えます。` : '行が無いので、いまの実行予算は変えません。'}
          </p>
          <div className="space-y-2">
            <p className="text-sm">
              <span className="font-bold">受注の内訳：</span>
              {diff.contractItemsCount > 0 ? `${diff.contractItemsCount} 行を入れます。` : '行が無いので、いまの内訳は変えません。'}
            </p>
            {diff.contractItemsCount > 0 && (
              <fieldset className="space-y-1">
                <legend className="sr-only">受注の内訳の取り込み方</legend>
                {(
                  [
                    ['replace', '全部入れ替える（新しい注文書が届いたとき）'],
                    ['appendChange', '変更の行として足す（変更の内訳だけ届いたとき。区分は「変更」になります）'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex min-h-11 items-center gap-3">
                    <input type="radio" name="contract-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-5 w-5" />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          {mode === 'appendChange' && diff.contractItemsCount > 0 && parsed.contractItems.some((i) => i.section === 'initial') && (
            <p role="alert" className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Excel の受注の内訳に区分「当初」の行が {parsed.contractItems.filter((i) => i.section === 'initial').length} 行あります。「変更の行として足す」では、それらも「変更」として足されます。「いまの予算・内訳を書き出す」で出した Excel なら、当初の行が二重になります。変更の行だけを残すか、「全部入れ替える」を選んでください。
            </p>
          )}
          {nothing && <p className="text-sm font-medium">取り込む行がありません。</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={submit}
              disabled={pending || parsed.errors.length > 0 || nothing}
              className={`${primaryButtonClass} sm:flex-1`}
            >
              {pending ? '取り込み中…' : '取り込む'}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={secondaryButtonClass}>
              やり直す
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
