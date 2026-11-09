'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { jpDate } from '@/lib/calc/format';
import { DAY_LAYOUT, isDaySheetWorkbook, parseDaySheet, type DaySheetParse } from '@/lib/import/day-sheet';
import { toSaveInput } from '@/lib/import/day-sheet-to-input';
import { APPROVED_LOCKED_MESSAGE, SITE_CLOSED_MESSAGE } from '@/lib/report/rows';
import { KIND_LABEL, type ReportLineInput, type SaveInput } from '@/lib/report/schema';
import type { LineKind } from '@/lib/types';
import type { DayStatus } from '@/components/site/status';
import type { ReportMasters } from './form-state';

// 日報画面の「Excel から取り込む」。1 日分の雛形を端末で読み、確認画面を出してからフォームに流し込む。
// 保存はしない（利用者が内容を見直して、いつもの「下書き保存」で保存する。権限・規則は保存と同じ）。

/** 読み取るファイルの上限（端末のメモリを守るため）。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

/** 画面にそのまま出してよい読み取りエラー。 */
class ReadError extends Error {}

function isEmpty(p: DaySheetParse): boolean {
  const lines = p.labor.length + p.fuel.length + p.lease.length + p.cash.length + p.credit.length + p.work.length;
  const c = p.common;
  return (
    lines === 0 &&
    p.date === null && p.weather === null && p.supervisor === null &&
    c.start === null && c.end === null && c.breakMin === null && c.gapMin === null &&
    p.issuesText === '' && p.notesText === ''
  );
}

async function readDayFile(file: File): Promise<DaySheetParse> {
  if (file.size > MAX_FILE_BYTES) throw new ReadError('ファイルが大きすぎます（10MB まで）');
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsm') && !lower.endsWith('.xlsx')) throw new ReadError('Excel（.xlsm／.xlsx）のファイルを選んでください。');
  const buf = await file.arrayBuffer();
  // SheetJS は取り込むときだけ使うので、ここで遅延読み込みする。「1回目」シートだけを読む。
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, sheets: DAY_LAYOUT.sheet });
  const ws = wb.Sheets[DAY_LAYOUT.sheet];
  if (!isDaySheetWorkbook(wb.SheetNames) || !ws) {
    throw new ReadError('「1回目」シートが見つかりません。1 日分の雛形（現場管理日報_1日追加用_雛形.xlsm）か確認してください。');
  }
  // grid[0] が Excel の 1 行目になるよう、使用範囲の始まりを A1 にそろえる。
  const ref = ws['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : undefined;
  if (range) range.s = { r: 0, c: 0 };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, range });
  const parsed = parseDaySheet(grid);
  if (isEmpty(parsed)) throw new ReadError('「1回目」シートに入力がありません。');
  return parsed;
}

const KINDS: LineKind[] = ['labor', 'fuel', 'lease', 'cash', 'credit', 'work'];

function lineName(l: ReportLineInput): { name: string; manual: boolean } {
  switch (l.kind) {
    case 'labor': return { name: l.workerName, manual: l.workerId === null };
    case 'fuel': return { name: l.vehicleName, manual: l.vehicleId === null };
    case 'lease': return { name: l.itemName, manual: l.itemId === null };
    case 'cash': return { name: l.itemName, manual: false };
    case 'credit': return { name: l.itemName, manual: false };
    case 'work': return { name: l.description || l.trade, manual: false };
  }
}

function commonText(c: SaveInput['common']): string {
  const parts = [
    c.start || c.end ? `${c.start ?? '—'}〜${c.end ?? '—'}` : null,
    c.breakMin !== null ? `休憩 ${c.breakMin} 分` : null,
    c.gapMin !== null ? `中抜 ${c.gapMin} 分` : null,
  ].filter((x) => x !== null);
  return parts.length > 0 ? parts.join('・') : '空欄（画面の値のまま）';
}

function short(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (one === '') return 'なし';
  return one.length > 40 ? `${one.slice(0, 40)}…` : one;
}

function Summary({ input }: { input: SaveInput }) {
  const head: [string, string][] = [
    ['日付', jpDate(input.date)],
    ['天候', input.weather ?? '—'],
    ['作業責任者', input.supervisor ?? '—'],
    ['共通時間', commonText(input.common)],
    ['重要事項', short(input.issuesText)],
    ['連絡事項', short(input.notesText)],
  ];
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-700">
        {head.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-gray-600 dark:text-gray-400">{k}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-300 dark:divide-gray-800 dark:border-gray-700">
        {KINDS.map((kind) => {
          const items = input.lines.filter((l) => l.kind === kind).map(lineName);
          const shown = items.slice(0, 5);
          return (
            <li key={kind} className="px-3 py-2 text-sm">
              <span className="mr-2 font-bold">{KIND_LABEL[kind]}</span>
              <span className="inline-block rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-800 dark:bg-gray-700 dark:text-gray-100">{`${items.length} 行`}</span>
              {shown.length > 0 && (
                <span className="mt-1 block text-gray-700 [overflow-wrap:anywhere] dark:text-gray-300">
                  {shown.map((x, i) => (
                    <span key={i}>
                      {i > 0 && '、'}
                      {x.name}
                      {x.manual && <span className="text-xs text-amber-800 dark:text-amber-300">（手入力）</span>}
                    </span>
                  ))}
                  {items.length > shown.length && ` ほか ${items.length - shown.length} 行`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ImportDaySheet({
  masters,
  siteId,
  date,
  hasExisting,
  status,
  siteClosed = false,
  onApply,
}: {
  masters: ReportMasters;
  siteId: string;
  date: string;
  /** この日の日報がすでに保存されている（取り込むと置き換えになるので「上書きする」を選ばせる）。 */
  hasExisting: boolean;
  status: DayStatus;
  siteClosed?: boolean;
  /** 取り込んだ内容をフォームに流し込む（保存はしない）。 */
  onApply: (input: SaveInput) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ input: SaveInput; notes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [applied, setApplied] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  // 承認済み・完了現場は取り込めない（保存でも DB が拒否する。文言は保存のエラーと同じ）。
  const locked = siteClosed ? SITE_CLOSED_MESSAGE : status === 'approved' ? APPROVED_LOCKED_MESSAGE : null;
  if (locked) {
    return (
      <p role="status" className="mb-6 rounded-lg border border-gray-400 p-3 text-sm dark:border-gray-600">
        Excel から取り込めません：{locked}
      </p>
    );
  }

  function reset() {
    setResult(null);
    setFileName('');
    setError(null);
    setOverwrite(false);
    setInputKey((k) => k + 1);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    setError(null);
    setOverwrite(false);
    setApplied(false);
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    try {
      const budget = { trades: masters.siteTrades ?? [], aliases: masters.tradeAliases ?? [] };
      setResult(toSaveInput(await readDayFile(file), siteId, date, masters, budget));
    } catch (err) {
      console.error('[import-day] read', err);
      setError(err instanceof ReadError ? err.message : 'ファイルを読み取れませんでした。1 日分の雛形の Excel か確認してください。');
    } finally {
      setReading(false);
      // 成功・失敗どちらでも選択を空にする（直した同じファイルを選び直しても change が起き、読み直せるように）。
      setInputKey((k) => k + 1);
    }
  }

  function apply() {
    if (!result || (hasExisting && !overwrite)) return;
    onApply(result.input);
    reset();
    setApplied(true);
  }

  return (
    <section aria-label="Excel から取り込む" className="mb-6">
      <input key={inputKey} ref={fileRef} type="file" accept=".xlsm,.xlsx" onChange={onFile} tabIndex={-1} aria-hidden="true" className="sr-only" />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={reading}
        className={`${buttonBase} w-full border border-blue-700 text-blue-700 sm:w-auto dark:border-blue-400 dark:text-blue-400`}
      >
        {reading ? '読み取り中…' : 'Excel から取り込む'}
      </button>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">1 日分の雛形（.xlsm）の「1回目」シートを読み、確認してからフォームに入れます。</p>

      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
      {applied && (
        <p role="status" className="mt-2 rounded-lg border border-blue-400 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          内容を確認して「下書き保存」を押してください
        </p>
      )}

      {result && (
        <div className="mt-3 space-y-3 rounded-lg border border-blue-400 p-3 dark:border-blue-600">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">取り込む内容の確認</h2>
            <span className="truncate text-sm text-gray-600 dark:text-gray-400">{fileName}</span>
          </div>
          <Summary input={result.input} />
          {result.notes.length > 0 && (
            <div role="status" className="rounded-lg border border-yellow-400 bg-yellow-50 p-3 text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50">
              <p className="font-bold">確認してください</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm [overflow-wrap:anywhere]">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {hasExisting ? (
            <div role="alert" className="rounded-lg border-2 border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
              <p className="font-bold">この日の日報はすでにあります。取り込むと画面の内容が置き換わります（保存するまで DB は変わりません）</p>
              <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 font-bold">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="size-5 shrink-0" />
                上書きする
              </label>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">「フォームに反映」を押すと、画面の入力がこの内容に置き換わります（保存するまで DB は変わりません）。</p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={apply} disabled={hasExisting && !overwrite} className={`${buttonBase} flex-1 bg-blue-700 text-white`}>
              フォームに反映
            </button>
            <button type="button" onClick={reset} className={`${buttonBase} border border-gray-400 font-medium dark:border-gray-600`}>
              やめる
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
