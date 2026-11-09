'use client';

import { useMemo, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { yen } from '@/lib/calc/format';
import {
  COLUMN_ROLES,
  COLUMN_ROLE_LABEL,
  buildCandidates,
  extractTable,
  hasNoText,
  squash,
  type CandidateKind,
  type ColumnRole,
  type PdfCandidate,
  type PdfTable,
  type PdfTextItem,
} from '@/lib/budget/pdf-table';
import { contractItemInputSchema, lineAmount, type ContractItemInput, type ContractMode } from '@/lib/budget/schemas';
import { CONTRACT_SECTIONS, CONTRACT_SECTION_LABEL, type ContractCategory, type ContractSection, type SiteTrade } from '@/lib/budget/types';
import { replaceContractItems } from '@/lib/db/budget-actions';
import { ErrorText, Field, inputClass, primaryButtonClass, secondaryButtonClass } from '@/components/masters/common';
import { cardClass, numText, parseNum, rowKey } from './common';

// 元請けの内訳を文字 PDF から読み取る：PDF を選ぶ → ブラウザで pdf.js が文字と位置を取り出す → 表の行と列を推定（pdf-table.ts）
// → 列の割り当て・行の取り込む／取り込まない・区分・工種（識別）を直す → replaceContractItems（全部入れ替える／変更の行として足す）。
// 画像だけの PDF（スキャン）は文字が取れないので対象外（Excel に貼り付けて取り込む）。

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;
const EXPENSE = 'expense';
const REDUCTION = 'reduction';

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** pdf.js を読み込む（1 回だけ。PdfViewer と同じく legacy 版、worker は同じサイトから配る）。 */
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then((pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
        return pdfjs;
      })
      .catch((e: unknown) => {
        pdfjsPromise = null;
        throw e;
      });
  }
  return pdfjsPromise;
}

/** PDF の各ページの文字と位置（左上を原点、y は下へ）。 */
async function readTextItems(data: Uint8Array): Promise<{ pages: PdfTextItem[][]; truncated: boolean }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: PdfTextItem[][] = [];
    const n = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of content.items) {
        if (!('str' in it) || it.str.trim() === '') continue;
        const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        const height = it.height || Math.hypot(it.transform[2], it.transform[3]);
        items.push({ str: it.str, x, y, width: it.width, height });
      }
      pages.push(items);
      page.cleanup();
    }
    return { pages, truncated: doc.numPages > MAX_PAGES };
  } finally {
    void doc.destroy();
  }
}

interface Row {
  key: string;
  include: boolean;
  kind: CandidateKind;
  page: number;
  cells: string[];
  section: ContractSection;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  unitPrice: string;
  /** PDF に書かれた金額（確かめ用）。 */
  pdfAmount: number | null;
  tag: string;
}

const KIND_LABEL: Record<CandidateKind, string> = { item: '明細', heading: '見出し', subtotal: '小計', total: '合計', blank: '空' };

/** 名称・規格・直前の見出しに工種の名前が入っていれば、その工種（長い名前を優先）。 */
function guessTag(c: PdfCandidate, trades: SiteTrade[]): string {
  if (c.category === 'expense') return EXPENSE;
  if (c.category === 'reduction') return REDUCTION;
  const own = squash(`${c.guess.name}${c.guess.spec}`);
  const heading = squash(c.heading ?? '');
  const byLength = [...trades].sort((a, b) => squash(b.name).length - squash(a.name).length);
  const hit = byLength.find((t) => own.includes(squash(t.name))) ?? byLength.find((t) => heading.includes(squash(t.name)));
  return hit?.id ?? '';
}

function toRows(candidates: PdfCandidate[], trades: SiteTrade[]): Row[] {
  return candidates.map((c) => ({
    key: rowKey(),
    include: c.include,
    kind: c.kind,
    page: c.page,
    cells: c.cells,
    section: c.section,
    name: c.guess.name || (c.kind === 'item' ? '' : c.cells.filter((s) => s !== '').join(' ')),
    spec: c.guess.spec,
    qty: numText(c.guess.qty),
    unit: c.guess.unit,
    unitPrice: numText(c.guess.unitPrice),
    pdfAmount: c.guess.amount,
    tag: c.kind === 'item' ? guessTag(c, trades) : '',
  }));
}

function toInput(r: Row): ContractItemInput {
  const category: ContractCategory = r.tag === EXPENSE ? 'expense' : r.tag === REDUCTION ? 'reduction' : 'trade';
  return {
    section: r.section,
    name: r.name,
    spec: r.spec,
    qty: parseNum(r.qty) ?? Number.NaN,
    unit: r.unit,
    unitPrice: parseNum(r.unitPrice) ?? Number.NaN,
    category,
    tradeId: category === 'trade' && r.tag !== '' ? r.tag : null,
  };
}

function rowAmount(r: Row): number | null {
  const q = parseNum(r.qty);
  const p = parseNum(r.unitPrice);
  if (q === null || p === null || Number.isNaN(q) || Number.isNaN(p)) return null;
  return lineAmount(q, p);
}

export function PdfImport({ siteId, trades, readOnly }: { siteId: string; trades: SiteTrade[]; readOnly: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<PdfTable | null>(null);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<ContractMode>('replace');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const sortedTrades = useMemo(() => [...trades].sort((a, b) => a.sortOrder - b.sortOrder), [trades]);

  const rowErrors = useMemo(() => {
    const out: string[] = [];
    rows.forEach((r, i) => {
      if (!r.include) return;
      const res = contractItemInputSchema.safeParse(toInput(r));
      if (!res.success) out.push(`${i + 1}行目：${res.error.issues[0]?.message ?? '入力が正しくありません'}`);
    });
    return out;
  }, [rows]);

  // 完了現場では取り込まない（ボタンも出さない）
  if (readOnly) return null;

  function reset() {
    setTable(null);
    setRows([]);
    setRoles([]);
    setFileName('');
    setError(null);
    setNote(null);
    setInputKey((k) => k + 1);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setTable(null);
    setRows([]);
    setError(null);
    setNote(null);
    setDone(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setError('ファイルが大きすぎます（20MB まで）');
      return;
    }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setError('PDF のファイルを選んでください。');
      return;
    }
    setReading(true);
    try {
      const { pages, truncated } = await readTextItems(new Uint8Array(await file.arrayBuffer()));
      if (hasNoText(pages)) {
        setError('文字を読み取れない PDF です（画像の PDF）。Excel に貼り付けて取り込んでください');
        return;
      }
      const t = extractTable(pages);
      const r = t.columns.map((c) => c.role);
      setTable(t);
      setRoles(r);
      setRows(toRows(buildCandidates(t, r), sortedTrades));
      const notes: string[] = [];
      if (!t.headerFound) notes.push('表の見出し（名称・数量・単価・金額など）が見つからなかったので、数の並びから列を推定しました。列の割り当てを確かめてください。');
      if (truncated) notes.push(`${MAX_PAGES} ページまで読み取りました。`);
      setNote(notes.length > 0 ? notes.join('') : null);
    } catch (err) {
      console.error('[budget pdf import] read', err);
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'PasswordException'
          ? 'パスワードのかかった PDF は読み取れません。'
          : 'PDF を読み取れませんでした。Excel に貼り付けて取り込んでください。',
      );
    } finally {
      setReading(false);
    }
  }

  function changeRole(i: number, role: ColumnRole) {
    if (!table) return;
    const next = roles.map((r, j) => (j === i ? role : r === role && role !== 'ignore' ? 'ignore' : r));
    setRoles(next);
    setRows(toRows(buildCandidates(table, next), sortedTrades));
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const included = rows.filter((r) => r.include);
  const total = included.reduce((s, r) => s + (rowAmount(r) ?? 0), 0);
  const mismatches = included.filter((r) => {
    const a = rowAmount(r);
    return r.pdfAmount !== null && a !== null && a !== r.pdfAmount;
  }).length;
  const untagged = included.filter((r) => r.tag === '').length;

  function submit() {
    if (included.length === 0 || rowErrors.length > 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await replaceContractItems(siteId, included.map(toInput), mode);
        if (!res.ok) {
          setError(`元請けの内訳を取り込めませんでした：${res.error}`);
          return;
        }
        setDone(`PDF から ${included.length} 行を取り込みました。`);
        reset();
        router.refresh();
      } catch {
        setError('取り込みに失敗しました。通信状況を確認してもう一度お試しください。');
      }
    });
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} w-full sm:w-auto`}>
          PDF から取り込む
        </button>
        {done && (
          <p role="status" className="text-sm font-medium text-green-800 dark:text-green-300">
            {done}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`${cardClass} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold">PDF から取り込む</h3>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          className={secondaryButtonClass}
        >
          閉じる
        </button>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        元請けの注文書・内訳書の PDF（文字を選べる PDF）から表を読み取ります。取り込む前に、列の割り当て・取り込む行・区分・工種（識別）を確かめて直せます。スキャンした画像の PDF は読み取れません。
      </p>
      <Field label="取り込む PDF">
        <input
          key={inputKey}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFile}
          disabled={reading || pending}
          className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-gray-400 file:bg-background file:px-4 file:text-base file:font-medium dark:file:border-gray-600"
        />
      </Field>
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

      {table && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold">読み取った表（{rows.length}行）</p>
            <span className="truncate text-sm text-gray-600 dark:text-gray-400">{fileName}</span>
          </div>
          {note && <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{note}</p>}

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold">列の割り当て</legend>
            <p className="text-sm text-gray-600 dark:text-gray-400">列を選び直すと、下の表は読み直しになります（手で直したところは消えます）。</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {table.columns.map((c, i) => {
                const sample = table.rows.map((r) => r.cells[i]).find((s) => s && s.trim() !== '') ?? '';
                return (
                  <li key={i} className="space-y-1">
                    <label className="block">
                      <span className="block truncate text-sm font-medium">
                        {c.label}
                        {sample && <span className="font-normal text-gray-600 dark:text-gray-400">（例：{sample}）</span>}
                      </span>
                      <select value={roles[i]} onChange={(e) => changeRole(i, e.target.value as ColumnRole)} disabled={pending} className={inputClass}>
                        {COLUMN_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {COLUMN_ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <p className="text-sm text-gray-700 dark:text-gray-300">
            見出し・小計・合計の行は初めから「取り込む」を外しています。2 行に分かれた明細や、読み違えた行は、ここで直してください。金額は数量 × 単価で計算し直します。
          </p>
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const label = `PDF の${i + 1}行目`;
              const amount = rowAmount(r);
              const mismatch = r.include && r.pdfAmount !== null && amount !== null && amount !== r.pdfAmount;
              return (
                <li key={r.key} className={`${cardClass} space-y-2 ${r.include ? '' : 'opacity-70'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={pending}
                        onChange={(e) => update(r.key, { include: e.target.checked })}
                        className="h-5 w-5"
                      />
                      <span className="text-sm font-medium">取り込む</span>
                    </label>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {i + 1}行目・{r.page}ページ・{KIND_LABEL[r.kind]}
                    </span>
                  </div>
                  {!r.include ? (
                    <p className="break-words text-sm">{r.cells.filter((s) => s !== '').join('　') || '（空）'}</p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <select
                          aria-label={`${label}の区分`}
                          value={r.section}
                          disabled={pending}
                          onChange={(e) => update(r.key, { section: e.target.value as ContractSection })}
                          className={`${inputClass} w-24 shrink-0`}
                        >
                          {CONTRACT_SECTIONS.map((s) => (
                            <option key={s} value={s}>
                              {CONTRACT_SECTION_LABEL[s]}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`${label}の工種（識別）`}
                          value={r.tag}
                          disabled={pending}
                          onChange={(e) => update(r.key, { tag: e.target.value })}
                          className={`${inputClass} min-w-0 flex-1 ${r.tag === '' ? 'border-amber-600 dark:border-amber-400' : ''}`}
                        >
                          <option value="">（工種を選ぶ）</option>
                          {sortedTrades.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                          <option value={EXPENSE}>経費</option>
                          <option value={REDUCTION}>減分</option>
                        </select>
                      </div>
                      <input
                        aria-label={`${label}の名称`}
                        placeholder="名称"
                        value={r.name}
                        maxLength={200}
                        disabled={pending}
                        onChange={(e) => update(r.key, { name: e.target.value })}
                        className={inputClass}
                      />
                      <input
                        aria-label={`${label}の規格・仕様`}
                        placeholder="規格・仕様"
                        value={r.spec}
                        maxLength={200}
                        disabled={pending}
                        onChange={(e) => update(r.key, { spec: e.target.value })}
                        className={inputClass}
                      />
                      <div className="grid grid-cols-[1fr_4.5rem_1fr] gap-2">
                        <input
                          aria-label={`${label}の数量`}
                          placeholder="数量"
                          inputMode="decimal"
                          value={r.qty}
                          disabled={pending}
                          onChange={(e) => update(r.key, { qty: e.target.value })}
                          className={`${inputClass} text-right`}
                        />
                        <input
                          aria-label={`${label}の単位`}
                          placeholder="単位"
                          value={r.unit}
                          maxLength={20}
                          disabled={pending}
                          onChange={(e) => update(r.key, { unit: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          aria-label={`${label}の単価`}
                          placeholder="単価"
                          inputMode="decimal"
                          value={r.unitPrice}
                          disabled={pending}
                          onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                          className={`${inputClass} text-right`}
                        />
                      </div>
                      <p className="text-right text-sm tabular-nums">
                        金額 {amount === null ? '—' : yen(amount)}
                        {mismatch && r.pdfAmount !== null && (
                          <span role="alert" className="block font-medium text-amber-800 dark:text-amber-300">
                            PDF の金額 {yen(r.pdfAmount)} と合いません（数量 × 単価を確かめてください）
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="space-y-2">
            <p className="text-base font-bold tabular-nums">
              取り込む行 {included.length} 行・金額の合計 {yen(total)}
            </p>
            {mismatches > 0 && (
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                PDF の金額と数量 × 単価が合わない行が {mismatches} 行あります。
              </p>
            )}
            {untagged > 0 && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                工種（識別）をまだ選んでいない行が {untagged} 行あります（取り込んだ後でも選べます）。
              </p>
            )}
            {rowErrors.length > 0 && (
              <div role="alert" className="space-y-1 rounded-lg border border-red-600 p-2 dark:border-red-500">
                <p className="text-sm font-bold text-red-700 dark:text-red-400">直す必要のある行が {rowErrors.length} 行あります。</p>
                <ul className="space-y-1 text-sm">
                  {rowErrors.slice(0, 20).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                  {rowErrors.length > 20 && <li>ほか {rowErrors.length - 20} 行</li>}
                </ul>
              </div>
            )}
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-bold">取り込み方</legend>
            {(
              [
                ['replace', '全部入れ替える（新しい注文書が届いたとき）'],
                ['appendChange', '変更の行として足す（変更の内訳だけ届いたとき。区分は「変更」になります）'],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className="flex min-h-11 items-center gap-3">
                <input type="radio" name="pdf-contract-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="h-5 w-5" />
                <span className="text-sm">{text}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={submit}
              disabled={pending || included.length === 0 || rowErrors.length > 0}
              className={`${primaryButtonClass} sm:flex-1`}
            >
              {pending ? '取り込み中…' : mode === 'replace' ? '元請けの内訳を全部入れ替える' : '変更の行として足す'}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={secondaryButtonClass}>
              やり直す
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
