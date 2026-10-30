'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { jpDate } from '@/lib/calc/format';
import { commonHours, reportTotals } from '@/lib/calc/report';
import { copyPreviousReport, saveReport, type SaveReportResult } from '@/lib/db/reports-actions';
import { reportWarnings, validateReport, type SaveInput } from '@/lib/report/schema';
import type { TimeSpec } from '@/lib/types';
import { STATUS_COLOR, STATUS_LABEL, type DayStatus } from '@/components/site/status';
import { calcLines, decimal, fromInput, refreshFromMasters, toInput, toRows, type FormState, type ReportMasters, type Rows } from './form-state';
import { fieldClass, NumInput, Select, TimeInput } from './inputs';
import { ReportSummary } from './ReportSummary';
import { FuelTable } from './tables/FuelTable';
import { LaborTable } from './tables/LaborTable';
import { LeaseTable } from './tables/LeaseTable';
import { CashTable, CreditTable } from './tables/PurchaseTable';
import { WorkTable } from './tables/WorkTable';
import { useReportDraft } from './useReportDraft';

export interface ReportFormProps {
  siteId: string;
  siteName: string;
  date: string;
  today: string;
  heading: string;
  dateLabel: string;
  prevDate: string;
  nextDate: string;
  status: DayStatus;
  readOnly: boolean;
  siteStartDate: string | null;
  contractAmount: number | null;
  /** この日より前の日報の出来高合計（進捗率の累計に使う）。 */
  outputBefore: number;
  hasPrevious: boolean;
  initial: SaveInput;
  masters: ReportMasters;
}

const SAVE_FAILED = '保存に失敗しました。通信状況を確認してもう一度お試しください。';
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

function Labeled({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Band({ id, tone, title, items }: { id?: string; tone: 'warn' | 'error'; title: string; items: string[] }) {
  if (items.length === 0) return null;
  const cls =
    tone === 'warn'
      ? 'border-yellow-400 bg-yellow-50 text-yellow-950 dark:border-yellow-600 dark:bg-yellow-950 dark:text-yellow-50'
      : 'border-red-500 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950 dark:text-red-50';
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-lg border p-3 ${cls}`}>
      <p className="font-bold">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

/** 日報入力フォーム。上から 見出し → 基本情報 → 前回コピー → 共通時間 → 6表 → 集計 → 重要事項・連絡事項 → 警告 → 保存。 */
export function ReportForm(p: ReportFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => fromInput(p.initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toInput(p.siteId, p.date, fromInput(p.initial))));
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const input = useMemo(() => toInput(p.siteId, p.date, state), [p.siteId, p.date, state]);
  const json = useMemo(() => JSON.stringify(input), [input]);
  const totals = useMemo(() => reportTotals(calcLines(input.lines), input.common), [input]);
  const warnings = useMemo(
    () => reportWarnings(input, { siteStartDate: p.siteStartDate, today: p.today }),
    [input, p.siteStartDate, p.today],
  );
  const dirty = json !== baseline;

  const draft = useReportDraft({
    siteId: p.siteId,
    date: p.date,
    json,
    baseline,
    normalize: (d) => JSON.stringify(toInput(p.siteId, p.date, fromInput(d))),
    enabled: !p.readOnly,
  });

  function showErrors(list: string[]) {
    setErrors(list);
    window.requestAnimationFrame(() => document.getElementById('report-errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const setCommon = (patch: Partial<TimeSpec>) => setState((s) => ({ ...s, common: { ...s.common, ...patch } }));
  const setRows =
    <K extends keyof Rows>(key: K) =>
    (update: (rows: Rows[K]) => Rows[K]) =>
      setState((s) => ({ ...s, rows: { ...s.rows, [key]: update(s.rows[key]) } }));

  function restoreDraft() {
    const d = draft.takePending();
    if (!d) return;
    try {
      setState(fromInput(d));
      setMessage('保存していない入力を復元しました。「下書き保存」で保存してください。');
    } catch {
      draft.discard();
      setMessage('保存していない入力を読み込めなかったため破棄しました。');
    }
  }

  function copyPrevious() {
    const r = state.rows;
    if (r.labor.length + r.fuel.length + r.lease.length > 0 && !window.confirm('作業員・車両・リースの入力を前回の日報の内容で置き換えます。よろしいですか？')) {
      return;
    }
    setErrors([]);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await copyPreviousReport(p.siteId, p.date);
        if (!res.ok) {
          showErrors([res.error]);
          return;
        }
        const copied = toRows(refreshFromMasters(res.lines, p.masters, p.date));
        setState((s) => ({ ...s, rows: { ...s.rows, labor: copied.labor, fuel: copied.fuel, lease: copied.lease } }));
        setMessage(
          `${jpDate(res.date)} の日報から作業員${copied.labor.length}人・車両${copied.fuel.length}台・リース${copied.lease.length}件をコピーしました（作業員の個別時間と車両の走行距離は空欄です）。`,
        );
      } catch {
        showErrors(['前回の日報を読み込めませんでした。通信状況を確認してもう一度お試しください。']);
      }
    });
  }

  function save() {
    setMessage(null);
    const checked = validateReport(input);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    setErrors([]);
    const sent = json;
    startTransition(async () => {
      let res: SaveReportResult;
      try {
        res = await saveReport(input);
      } catch {
        res = { ok: false, error: SAVE_FAILED };
      }
      if (!res.ok) {
        showErrors([res.error]);
        return;
      }
      draft.discard(sent);
      setBaseline(sent);
      setMessage('下書き保存しました。');
      router.refresh();
    });
  }

  const weatherOptions = p.masters.weather.map((w) => ({ value: w, label: w }));
  const statusNote = pending
    ? '処理中…'
    : errors.length > 0
      ? `保存できません（${errors.length}件）`
      : dirty ? '保存していない変更があります' : p.status === 'none' ? '未保存' : '保存済み';

  return (
    <div className="pb-28">
      <Link href={`/sites/${p.siteId}`} className="mb-1 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {p.siteName}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">{p.heading}</h1>
        <span className={`rounded border px-2 py-0.5 text-sm font-bold ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      </div>

      {p.readOnly && (
        <p role="status" className="mb-4 rounded-lg border border-green-500 bg-green-50 p-3 font-bold text-green-900 dark:bg-green-950 dark:text-green-50">
          承認済みのため編集できません
        </p>
      )}

      {draft.pending && (
        <div role="alert" className="mb-4 rounded-lg border border-blue-500 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          <p className="font-bold">保存していない入力があります。復元しますか？</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={restoreDraft} className={`${buttonBase} bg-blue-700 text-white`}>
              復元
            </button>
            <button
              type="button"
              onClick={() => draft.discard()}
              className={`${buttonBase} border border-gray-400 font-medium dark:border-gray-600`}
            >
              破棄
            </button>
          </div>
        </div>
      )}

      <fieldset disabled={p.readOnly || pending} className="min-w-0">
        <section aria-label="基本情報" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <span className="mb-1 block text-sm font-medium">日付</span>
            <div className="flex items-center gap-1">
              <Link href={`/sites/${p.siteId}/reports/${p.prevDate}`} aria-label="前日の日報" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 dark:border-gray-600">
                ◀
              </Link>
              <span className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-gray-100 px-2 font-bold dark:bg-gray-800">{p.dateLabel}</span>
              <Link href={`/sites/${p.siteId}/reports/${p.nextDate}`} aria-label="翌日の日報" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 dark:border-gray-600">
                ▶
              </Link>
            </div>
          </div>
          <Labeled label="天候">
            <Select value={state.weather} options={weatherOptions} placeholder="—" onChange={(v) => set('weather', v)} />
          </Labeled>
          <Labeled label="作業責任者">
            <input value={state.supervisor} maxLength={100} onChange={(e) => set('supervisor', e.target.value)} className={fieldClass} />
          </Labeled>
        </section>

        <div className="mb-6">
          <button
            type="button"
            onClick={copyPrevious}
            disabled={!p.hasPrevious}
            className={`${buttonBase} w-full border border-blue-700 text-blue-700 sm:w-auto dark:border-blue-400 dark:text-blue-400`}
          >
            前回をコピー
          </button>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {p.hasPrevious ? '前回の日報の作業員・車両・リースを入れます。' : 'この日より前の日報がありません。'}
          </p>
        </div>

        <section aria-label="共通時間" className="mb-8">
          <h2 className="mb-2 border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">共通時間</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Labeled label="開始">
              <TimeInput value={state.common.start} onChange={(v) => setCommon({ start: v })} />
            </Labeled>
            <Labeled label="終了">
              <TimeInput value={state.common.end} onChange={(v) => setCommon({ end: v })} />
            </Labeled>
            <Labeled label="休憩（分）">
              <NumInput integer value={state.common.breakMin} onChange={(v) => setCommon({ breakMin: v })} />
            </Labeled>
            <Labeled label="中抜（分）">
              <NumInput integer value={state.common.gapMin} onChange={(v) => setCommon({ gapMin: v })} />
            </Labeled>
            <div className="col-span-2 sm:col-span-1">
              <span className="mb-1 block text-sm font-medium">共通実働</span>
              <span className="flex min-h-11 items-center text-lg font-bold tabular-nums">{decimal(commonHours(state.common))} H</span>
            </div>
          </div>
        </section>

        <LaborTable rows={state.rows.labor} onChange={setRows('labor')} common={state.common} date={p.date} workers={p.masters.workers} />
        <FuelTable rows={state.rows.fuel} onChange={setRows('fuel')} vehicles={p.masters.vehicles} />
        <LeaseTable rows={state.rows.lease} onChange={setRows('lease')} date={p.date} items={p.masters.leaseItems} units={p.masters.units} />
        <CashTable rows={state.rows.cash} onChange={setRows('cash')} units={p.masters.units} />
        <CreditTable rows={state.rows.credit} onChange={setRows('credit')} units={p.masters.units} suppliers={p.masters.suppliers} />
        <WorkTable rows={state.rows.work} onChange={setRows('work')} units={p.masters.units} />

        <ReportSummary totals={totals} outputBefore={p.outputBefore} contractAmount={p.contractAmount} />

        <section aria-label="重要事項・連絡事項" className="mb-6 grid gap-4 md:grid-cols-2">
          <Labeled label="重要事項">
            <textarea value={state.issuesText} maxLength={2000} rows={4} onChange={(e) => set('issuesText', e.target.value)} className={`${fieldClass} py-2`} />
          </Labeled>
          <Labeled label="連絡事項">
            <textarea value={state.notesText} maxLength={2000} rows={4} onChange={(e) => set('notesText', e.target.value)} className={`${fieldClass} py-2`} />
          </Labeled>
        </section>
      </fieldset>

      {!p.readOnly && <Band tone="warn" title="確認してください（保存はできます）" items={warnings} />}
      <Band id="report-errors" tone="error" title="保存できません" items={errors} />
      {message && (
        <p role="status" className="mb-4 rounded-lg border border-blue-400 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          {message}
        </p>
      )}

      {!p.readOnly && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-gray-300 bg-background/95 px-4 py-2 backdrop-blur dark:border-gray-700">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm" aria-live="polite">
              {statusNote}
            </span>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={save} disabled={pending} className={`${buttonBase} bg-blue-700 text-white`}>
                下書き保存
              </button>
              <span title="次の作業で有効になります">
                <button type="button" disabled aria-describedby="submit-note" className={`${buttonBase} border border-gray-400 dark:border-gray-600`}>
                  提出
                </button>
                <span id="submit-note" className="sr-only">
                  次の作業で有効になります
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
