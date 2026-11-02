'use client';

import { useMemo, useState, useTransition, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { jpDate, jpDateTime } from '@/lib/calc/format';
import type { ImportLogEntry } from '@/lib/db/import';
import { importMasters } from '@/lib/db/import-actions';
import { dateSchema, firstError } from '@/lib/db/masters-schemas';
import { diffMasters } from '@/lib/import/diff';
import { csvToRows, decodeCsv, parseCsvText } from '@/lib/import/parse-csv';
import { parseMasterSheet } from '@/lib/import/parse-sheet';
import { toPayload } from '@/lib/import/payload';
import {
  IMPORT_KINDS, KIND_LABELS,
  type CurrentMasters, type FieldChange, type ImportCounts, type ImportKind, type ParseResult, type PreviewRow, type RowError,
} from '@/lib/import/types';
import { ErrorText, Field, inputClass, primaryButtonClass, secondaryButtonClass } from './common';

/** 読み取るファイルの上限（端末のメモリを守るため）。 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 画面にそのまま出してよい読み取りエラー。 */
class ReadError extends Error {}

async function readMasterFile(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) throw new ReadError('ファイルが大きすぎます（10MB まで）');
  const lower = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (lower.endsWith('.csv')) {
    let parsed: ReturnType<typeof parseCsvText>;
    try {
      parsed = parseCsvText(decodeCsv(buf));
    } catch (e) {
      throw new ReadError(e instanceof Error ? e.message : 'CSV を読み取れませんでした。');
    }
    return csvToRows(parsed.kind, parsed.grid);
  }

  if (lower.endsWith('.xlsm') || lower.endsWith('.xlsx')) {
    // SheetJS は取り込み画面でだけ使うので、ここで遅延読み込みする。
    const XLSX = await import('xlsx');
    const opts = { type: 'array' as const, cellFormula: false, cellHTML: false };
    // 雛形はシートが多いので、まず「マスター」シートだけを読む。無ければ先頭のシート。
    let wb = XLSX.read(buf, { ...opts, sheets: 'マスター' });
    let ws = wb.Sheets['マスター'];
    if (!ws) {
      wb = XLSX.read(buf, { ...opts, sheets: 0 });
      ws = wb.Sheets[wb.SheetNames[0]];
    }
    if (!ws) throw new ReadError('シートが見つかりません。');
    // grid[0] が Excel の 1 行目になるよう、使用範囲の始まりを A1 にそろえる。
    const ref = ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : undefined;
    if (range) range.s = { r: 0, c: 0 };
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, range });
    const result = parseMasterSheet(grid);
    if (result.detected.length === 0) {
      throw new ReadError('マスターの見出し（作業員名・取引先名・車両名／ナンバー・品目名）が見つかりません。雛形の「マスター」シートか確認してください。');
    }
    return result;
  }

  throw new ReadError('Excel（.xlsm／.xlsx）か CSV（.csv）のファイルを選んでください。');
}

type AnyRow = PreviewRow<unknown>;

export function ImportPanel({
  today,
  current,
  importLog,
}: {
  today: string;
  current: CurrentMasters;
  importLog: ImportLogEntry[];
}) {
  const router = useRouter();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [reading, setReading] = useState(false);
  // チェックを外した行（既定はすべて ON）。
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportCounts | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const dateError = firstError(dateSchema, effectiveFrom);
  // 適用開始日が不正な間は、単価の比較に今日を使う（送信はできない）。
  const preview = useMemo(
    () => (parsed ? diffMasters(parsed.rows, current, dateError ? today : effectiveFrom) : null),
    [parsed, current, effectiveFrom, dateError, today],
  );

  const selectedKeys = useMemo(() => {
    if (!preview) return new Set<string>();
    const keys = IMPORT_KINDS.flatMap((k) => (preview[k] as AnyRow[]).filter((r) => r.status !== 'unchanged').map((r) => r.key));
    return new Set(keys.filter((k) => !unchecked.has(k)));
  }, [preview, unchecked]);

  const selectedCounts = useMemo(() => {
    let inserted = 0;
    let updated = 0;
    if (preview) {
      for (const k of IMPORT_KINDS) {
        for (const r of preview[k] as AnyRow[]) {
          if (!selectedKeys.has(r.key)) continue;
          if (r.status === 'new') inserted++;
          else if (r.status === 'updated') updated++;
        }
      }
    }
    return { inserted, updated };
  }, [preview, selectedKeys]);

  function reset() {
    setParsed(null);
    setFileName('');
    setUnchecked(new Set());
    setError(null);
    setResult(null);
    setInputKey((k) => k + 1);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParsed(null);
    setResult(null);
    setError(null);
    setUnchecked(new Set());
    if (!file) return;
    setFileName(file.name);
    setReading(true);
    try {
      setParsed(await readMasterFile(file));
    } catch (err) {
      console.error('[import] read', err);
      setError(err instanceof ReadError ? err.message : 'ファイルを読み取れませんでした。雛形の Excel か CSV か確認してください。');
    } finally {
      setReading(false);
    }
  }

  function toggle(key: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    if (!preview) return;
    if (dateError) {
      setError(dateError);
      return;
    }
    const payload = toPayload(preview, selectedKeys);
    setError(null);
    startTransition(async () => {
      try {
        const res = await importMasters({ fileName, effectiveFrom, payload });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setResult(res.counts);
        setParsed(null);
        setUnchecked(new Set());
        setInputKey((k) => k + 1);
        router.refresh();
      } catch {
        setError('取り込みに失敗しました。通信状況を確認してもう一度お試しください。');
      }
    });
  }

  const kindsShown = parsed
    ? IMPORT_KINDS.filter((k) => parsed.detected.includes(k) || parsed.errors.some((e) => e.kind === k))
    : [];
  const total = selectedCounts.inserted + selectedCounts.updated;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-bold">Excel／CSV から取り込む</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Excel 日報（V33／V34）の『マスター』シート、または同じ列並びの CSV を取り込みます。名前が同じ行は更新、無い行は追加します。アプリにあって Excel に無い行は消しません。
        </p>
        <Field label="ファイル（.xlsm／.xlsx／.csv）">
          <input
            key={inputKey}
            type="file"
            accept=".xlsm,.xlsx,.csv"
            onChange={onFile}
            disabled={reading || pending}
            className="block min-h-11 w-full text-base file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-gray-400 file:bg-background file:px-4 file:text-base file:font-medium dark:file:border-gray-600"
          />
        </Field>
        <div>
          <Field label="単価の適用開始日">
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={inputClass} />
          </Field>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">日当・リース単価が今と違う行は、この日付から新しい単価になります（履歴に追加）。</p>
        </div>
        {reading && (
          <p role="status" className="text-sm font-medium">
            読み取り中…
          </p>
        )}
        <ErrorText message={error} />
        {result && <ResultBox counts={result} />}
      </section>

      {parsed && preview && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">取り込む内容の確認</h2>
            <span className="truncate text-sm text-gray-600 dark:text-gray-400">{fileName}</span>
          </div>
          {kindsShown.map((kind) => (
            <KindSection
              key={kind}
              kind={kind}
              rows={preview[kind] as AnyRow[]}
              errors={parsed.errors.filter((e) => e.kind === kind)}
              selected={selectedKeys}
              onToggle={toggle}
            />
          ))}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={submit} disabled={pending || total === 0 || dateError !== null} className={`${primaryButtonClass} flex-1`}>
              {pending ? '取り込み中…' : `取り込む（新規 ${selectedCounts.inserted} 件・更新 ${selectedCounts.updated} 件）`}
            </button>
            <button type="button" onClick={reset} disabled={pending} className={secondaryButtonClass}>
              やり直す
            </button>
          </div>
        </section>
      )}

      <ImportHistory log={importLog} />
    </div>
  );
}

function CountBadge({ label, n, tone }: { label: string; n: number; tone: 'blue' | 'amber' | 'gray' | 'red' }) {
  const color = {
    blue: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
    amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
    gray: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
    red: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${color}`}>{`${label} ${n}`}</span>;
}

function ChangeLine({ change, isNew }: { change: FieldChange; isNew: boolean }) {
  return (
    <span className="block text-sm text-gray-700 dark:text-gray-300">
      {isNew ? `${change.label}：${change.after}` : `${change.label}：${change.before} → ${change.after}`}
    </span>
  );
}

function KindSection({
  kind,
  rows,
  errors,
  selected,
  onToggle,
}: {
  kind: ImportKind;
  rows: AnyRow[];
  errors: RowError[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const changed = rows.filter((r) => r.status !== 'unchanged');
  const unchanged = rows.filter((r) => r.status === 'unchanged');
  const nNew = rows.filter((r) => r.status === 'new').length;
  const nUpd = changed.length - nNew;

  return (
    <div className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-1 font-bold">{KIND_LABELS[kind]}</h3>
        <CountBadge label="新規" n={nNew} tone="blue" />
        <CountBadge label="更新" n={nUpd} tone="amber" />
        <CountBadge label="変更なし" n={unchanged.length} tone="gray" />
        <CountBadge label="エラー" n={errors.length} tone="red" />
      </div>
      {rows.length === 0 && errors.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">取り込む行はありません。</p>}
      {changed.length > 0 && (
        <ul>
          {changed.map((r) => (
            <li key={r.key} className="border-b border-gray-200 last:border-b-0 dark:border-gray-800">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                <input type="checkbox" checked={selected.has(r.key)} onChange={() => onToggle(r.key)} className="mt-1 size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.name}</span>
                    <StatusTag status={r.status} />
                    {r.inactive && <span className="text-xs text-gray-600 dark:text-gray-400">（無効のまま）</span>}
                  </span>
                  {r.changes.map((c) => (
                    <ChangeLine key={c.label} change={c} isNew={r.status === 'new'} />
                  ))}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1">
          {errors.map((e) => (
            <li key={`${e.rowNo}:${e.name}`} className="text-sm text-red-700 dark:text-red-400">
              {`${e.rowNo} 行目${e.name ? `「${e.name}」` : ''}：${e.message}（取り込みません）`}
            </li>
          ))}
        </ul>
      )}
      {unchanged.length > 0 && (
        <details className="mt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">変更なし {unchanged.length} 件</summary>
          <ul className="text-sm text-gray-700 dark:text-gray-300">
            {unchanged.map((r) => (
              <li key={r.key} className="py-1">
                {r.name}
                {r.inactive && <span className="text-xs text-gray-600 dark:text-gray-400">（無効）</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: AnyRow['status'] }) {
  if (status === 'new') return <span className="rounded bg-blue-100 px-1.5 text-xs font-bold text-blue-900 dark:bg-blue-900 dark:text-blue-100">新規</span>;
  return <span className="rounded bg-amber-100 px-1.5 text-xs font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-100">更新</span>;
}

function countsLine(counts: ImportCounts, withUnchanged: boolean): string {
  const parts = IMPORT_KINDS.flatMap((k) => {
    const c = counts[k];
    if (c.inserted + c.updated + (withUnchanged ? c.unchanged : 0) === 0) return [];
    const unchanged = withUnchanged && c.unchanged > 0 ? `／変更なし ${c.unchanged}` : '';
    return [`${KIND_LABELS[k]} 新規 ${c.inserted}／更新 ${c.updated}${unchanged}`];
  });
  return parts.length > 0 ? parts.join('、') : '変更はありませんでした';
}

function ResultBox({ counts }: { counts: ImportCounts }) {
  return (
    <div role="status" className="rounded-lg border border-green-600 bg-green-50 p-3 text-sm text-green-900 dark:border-green-500 dark:bg-green-950 dark:text-green-100">
      <p className="font-bold">取り込みました</p>
      <p>{countsLine(counts, true)}</p>
    </div>
  );
}

function ImportHistory({ log }: { log: ImportLogEntry[] }) {
  return (
    <section className="space-y-3 border-t border-gray-300 pt-4 dark:border-gray-700">
      <h2 className="text-lg font-bold">取り込み履歴</h2>
      {log.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">取り込みの履歴はまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {log.map((l) => (
            <li key={l.id} className="rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-700">
              <p className="font-bold">
                {jpDateTime(l.createdAt)} {l.actorName || l.actorEmail || ''}
              </p>
              <p className="break-all text-gray-700 dark:text-gray-300">{l.fileName ?? '（ファイル名なし）'}</p>
              {l.effectiveFrom && <p className="text-gray-700 dark:text-gray-300">単価の適用開始 {jpDate(l.effectiveFrom)}</p>}
              <p>{countsLine(l.counts, false)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
