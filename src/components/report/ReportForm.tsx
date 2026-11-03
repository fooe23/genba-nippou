'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition, type ReactNode } from 'react';
import { jpDate } from '@/lib/calc/format';
import { changeTotals } from '@/lib/calc/change';
import { commonHours, reportTotals } from '@/lib/calc/report';
import {
  addIssue,
  copyPreviousReport,
  deleteReport,
  saveReport,
  setIssueDone,
  submitReport,
  type ReportStateResult,
  type SaveReportResult,
} from '@/lib/db/reports-actions';
import type { Issue } from '@/lib/db/reports';
import { APPROVED_LOCKED_MESSAGE } from '@/lib/report/rows';
import { reportWarnings, validateReport, type SaveInput } from '@/lib/report/schema';
import { INSTRUCTION_METHODS, INSTRUCTION_METHOD_LABELS, ISSUE_KINDS, ISSUE_KIND_LABELS, isInstructionMethod, isIssueKind } from '@/lib/report/change-labels';
import type { DailyClientConfirmation } from '@/lib/reports/types';
import type { InstructionMethod, IssueKind, LaborRule, TimeSpec } from '@/lib/types';
import { STATUS_COLOR, STATUS_LABEL, type DayStatus } from '@/components/site/status';
import { calcLines, decimal, fillMissingRates, fromInput, refreshFromMasters, toInput, toRows, type FormState, type ReportMasters, type Rows } from './form-state';
import { ClientConfirmationButton, ClientConfirmationStatus } from './ClientConfirmation';
import { ImportDaySheet } from './ImportDaySheet';
import { fieldClass, NumInput, Select, TextInput, TimeInput } from './inputs';
import { IssueBanner, IssueKindTag } from './IssueBanner';
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
  /** 差戻し理由（status が rejected のときに赤帯で表示）。 */
  rejectedReason: string | null;
  readOnly: boolean;
  /** 閲覧のみの理由（完了現場など）。readOnly のときに青い帯で表示する。 */
  readOnlyNotice?: string;
  /** 現場が完了している（DB が日報・明細・重要事項の変更を拒否する）。件の追加・切替と日報の削除も出さない。 */
  siteClosed?: boolean;
  /** 承認画面での閲覧用。保存バーと前日・翌日の移動を隠し、戻り先を承認一覧にする。 */
  review?: boolean;
  siteStartDate: string | null;
  contractAmount: number | null;
  /** 契約が未確定の現場（集計に「総請負金額（未確定）」と概算金額を出す）。 */
  contractTentative: boolean;
  /** 未確定の現場の概算金額（確定の現場は null）。 */
  estimatedAmount: number | null;
  /** この日より前の日報の出来高合計（進捗率の累計に使う）。 */
  outputBefore: number;
  hasPrevious: boolean;
  initial: SaveInput;
  masters: ReportMasters;
  /** 人工・残業の計算設定（gn_settings）。画面のプレビューに使う（保存値は DB のトリガーが同じ式で計算する）。 */
  rule: LaborRule;
  /** 保存済みの日報のID。未保存なら null（件の追加は保存後）。 */
  reportId: string | null;
  /** この日報の重要事項の件（対応中・完了とも）。 */
  issues: Issue[];
  /** 現場の対応中の件（バナー用。この日報の件も含む）。 */
  openIssues: Issue[];
  /** 保存済みの日報の updated_at（楽観ロック用）。未保存なら null。 */
  updatedAt: string | null;
  /** 日報の作成者（削除できるかの判定用）。未保存なら null。 */
  createdBy: string | null;
  currentUserId: string;
  isAdmin: boolean;
  /** 帳票（PDF・CSV）のダウンロード先。保存済みの日報で、出力できる人（社員・管理者）だけに渡す。閲覧専用でも出す。 */
  exportLinks?: { pdf: string; csv: string };
  /** 客先確認の記録（無ければ null）。保存済みの日報なら、状態・閲覧専用・完了現場に関係なく記録・取り消しできる。 */
  clientConfirmation: DailyClientConfirmation | null;
}

const SUBMIT_FAILED = '提出に失敗しました。通信状況を確認してもう一度お試しください。';
const SAVE_FAILED = '保存に失敗しました。通信状況を確認してもう一度お試しください。';
const DELETE_FAILED = '削除に失敗しました。通信状況を確認してもう一度お試しください。';
const buttonBase = 'min-h-11 rounded-lg px-4 text-base font-bold disabled:opacity-50';

function Labeled({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function Band({ id, tone, title, items, action }: { id?: string; tone: 'warn' | 'error'; title: string; items: string[]; action?: ReactNode }) {
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
      {action}
    </div>
  );
}


const ISSUE_FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';

/** その日報の重要事項の件。状態の切替と追加は日報の保存とは別に即時反映する。 */
function IssueList({
  reportId,
  issues,
  onChanged,
  locked = false,
}: {
  reportId: string | null;
  issues: Issue[];
  onChanged: () => void;
  /** 完了現場など、件を変更できないとき。一覧だけ表示する。 */
  locked?: boolean;
}) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<IssueKind>('other');
  const [instructedBy, setInstructedBy] = useState('');
  const [method, setMethod] = useState<InstructionMethod | null>(null);
  const [amountEstimate, setAmountEstimate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    setError(null);
    const text = body.trim();
    if (!reportId || !text) return;
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof addIssue>>;
      try {
        res = await addIssue(reportId, text, { kind, instructedBy, instructionMethod: method, amountEstimate });
      } catch {
        res = { ok: false, error: ISSUE_FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody('');
      setKind('other');
      setInstructedBy('');
      setMethod(null);
      setAmountEstimate(null);
      onChanged();
    });
  }

  function toggle(issue: Issue) {
    setError(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await setIssueDone(issue.id, issue.status === 'open');
      } catch {
        res = { ok: false, error: ISSUE_FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <section aria-label="重要事項（件）" className="mb-6">
      <h2 className="mb-2 border-b border-gray-300 pb-1 text-lg font-bold dark:border-gray-700">重要事項（件）</h2>
      {issues.length === 0 ? (
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">この日報の件はまだありません。</p>
      ) : (
        <ul className="mb-3 divide-y divide-gray-300 rounded-lg border border-gray-300 dark:divide-gray-700 dark:border-gray-700">
          {issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0 flex-1 basis-48">
                <p className={`whitespace-pre-wrap break-words ${i.status === 'done' ? 'text-gray-600 line-through dark:text-gray-400' : ''}`}>
                  <IssueKindTag issue={i} />
                  {i.body}
                </p>
                {i.status === 'done' && i.doneAt && <p className="text-sm text-gray-600 dark:text-gray-400">完了 {jpDate(i.doneAt)}</p>}
              </div>
              <button
                type="button"
                onClick={() => toggle(i)}
                disabled={pending || locked}
                aria-label={`${i.body}：${i.status === 'open' ? '完了にする' : '対応中に戻す'}`}
                className={`${buttonBase} shrink-0 border ${
                  i.status === 'open'
                    ? 'border-yellow-500 bg-yellow-50 text-yellow-950 dark:bg-yellow-950 dark:text-yellow-50'
                    : 'border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-50'
                }`}
              >
                {i.status === 'open' ? '対応中' : '完了'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!locked && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Labeled label="件の内容（500文字まで）">
              <textarea
                value={body}
                maxLength={500}
                rows={2}
                disabled={!reportId || pending}
                onChange={(e) => setBody(e.target.value)}
                className={`${fieldClass} py-2`}
              />
            </Labeled>
            <fieldset disabled={!reportId || pending} className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
              <Labeled label="種別">
                <select value={kind} onChange={(e) => setKind(isIssueKind(e.target.value) ? e.target.value : 'other')} className={fieldClass}>
                  {ISSUE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ISSUE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="指示者">
                <TextInput value={instructedBy} maxLength={100} onChange={setInstructedBy} />
              </Labeled>
              <Labeled label="指示方法">
                <Select
                  value={method ?? ''}
                  options={INSTRUCTION_METHODS.map((m) => ({ value: m, label: INSTRUCTION_METHOD_LABELS[m] }))}
                  placeholder="—"
                  onChange={(v) => setMethod(isInstructionMethod(v) ? v : null)}
                />
              </Labeled>
              <Labeled label="金額見込み（円）">
                <NumInput value={amountEstimate} integer onChange={setAmountEstimate} />
              </Labeled>
            </fieldset>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={!reportId || pending || body.trim() === ''}
            className={`${buttonBase} border border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400`}
          >
            件を追加
          </button>
        </div>
      )}
      {!reportId && !locked && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">先に下書き保存してください。</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * 日報入力フォーム。
 * 自分の保存・提出で変わった updatedAt は覚えておき、それ以外の版（他の端末の保存・削除）が画面の再読み込みで
 * 届いたら、入力欄を作り直してサーバーの内容を表示する。未保存の入力は作り直す前に端末の下書きに残るので、
 * 作り直した後の復元帯（「サーバーの内容がこの下書きより新しいです」）から戻せる。
 */
export function ReportForm(p: ReportFormProps) {
  const [own, setOwn] = useState<string[]>([]);
  const [seen, setSeen] = useState(p.updatedAt);
  const [generation, setGeneration] = useState(0);
  if (p.updatedAt !== seen) {
    setSeen(p.updatedAt);
    if (p.updatedAt === null || !own.includes(p.updatedAt)) setGeneration((g) => g + 1);
  }
  const onOwnVersion = useCallback((v: string) => setOwn((o) => [...o, v]), []);
  return <ReportFormBody key={generation} {...p} onOwnVersion={onOwnVersion} />;
}

function initialFormState(initial: SaveInput, masters: ReportMasters, readOnly: boolean): { state: FormState; filled: number } {
  if (readOnly) return { state: fromInput(initial), filled: 0 };
  const { lines, filled } = fillMissingRates(initial.lines, masters, initial.date);
  return { state: fromInput({ ...initial, lines }), filled };
}

/** 上から 見出し → 基本情報 → 前回コピー → 共通時間 → 6表 → 集計 → 重要事項・連絡事項 → 警告 → 保存。 */
function ReportFormBody({ onOwnVersion, ...p }: ReportFormProps & { onOwnVersion: (v: string) => void }) {
  const router = useRouter();
  // 楽観ロック：いまの入力のもとになったサーバーの版。自分が保存・提出するたびに新しい版に進める。
  const [expected, setExpected] = useState(p.updatedAt);
  const [stale, setStale] = useState(false);
  // 開いたとき、未設定の日当・リース単価・燃費を最新のマスターで補う（編集できる画面のみ）。補った値は初期状態に含める。
  const [initialState] = useState(() => initialFormState(p.initial, p.masters, p.readOnly));
  const [state, setState] = useState<FormState>(initialState.state);
  const [baseline, setBaseline] = useState(() => JSON.stringify(toInput(p.siteId, p.date, initialState.state)));
  const filledCount = initialState.filled;
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const input = useMemo(() => toInput(p.siteId, p.date, state), [p.siteId, p.date, state]);
  const json = useMemo(() => JSON.stringify(input), [input]);
  // 読み取り専用の画面は、保存済みの労務行を DB の計算値（保存時の設定）で表示する（集計と一致させる）。
  // 編集できる画面は今の設定で計算し直す（保存すると DB も同じ値になる）。
  const totals = useMemo(
    () =>
      p.readOnly
        ? reportTotals([...state.rows.labor.map((r) => r.line), ...calcLines(input.lines.filter((l) => l.kind !== 'labor'))], input.common, p.rule, {
            preferSaved: true,
          })
        : reportTotals(calcLines(input.lines), input.common, p.rule),
    [input, state.rows.labor, p.readOnly, p.rule],
  );
  const warnings = useMemo(
    () => reportWarnings(input, { siteStartDate: p.siteStartDate, today: p.today }),
    [input, p.siteStartDate, p.today],
  );
  const dirty = json !== baseline;
  const changes = useMemo(() => changeTotals(state.rows.work.map((r) => r.line)), [state.rows.work]);
  // 作業内容の根拠の件の候補：この日報の件と、現場の対応中の件（重複は WorkTable で除く）。
  const issueCandidates = useMemo(() => [...p.issues, ...p.openIssues], [p.issues, p.openIssues]);

  const draft = useReportDraft({
    siteId: p.siteId,
    date: p.date,
    json,
    baseline,
    normalize: (d) => JSON.stringify(toInput(p.siteId, p.date, initialFormState(d, p.masters, p.readOnly).state)),
    enabled: !p.readOnly,
    serverUpdatedAt: expected,
  });

  function showErrors(list: string[], isStale = false) {
    setErrors(list);
    setStale(isStale);
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

  /** Excel（1 日分の雛形）から取り込んだ内容でフォームを置き換える（保存はしない）。共通時間の空欄の項目は画面の値のまま。 */
  function applyImport(imported: SaveInput) {
    setErrors([]);
    setStale(false);
    setMessage(null);
    setState((s) => {
      const c = imported.common;
      return {
        ...fromInput(imported),
        common: {
          start: c.start ?? s.common.start,
          end: c.end ?? s.common.end,
          breakMin: c.breakMin ?? s.common.breakMin,
          gapMin: c.gapMin ?? s.common.gapMin,
        },
      };
    });
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

  function recordVersion(v: string | null | undefined) {
    if (v === undefined) return;
    setExpected(v);
    if (v !== null) onOwnVersion(v);
  }

  function save() {
    setMessage(null);
    const checked = validateReport(input);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    setErrors([]);
    setStale(false);
    const sent = json;
    startTransition(async () => {
      let res: SaveReportResult;
      try {
        res = await saveReport(input, expected);
      } catch {
        res = { ok: false, error: SAVE_FAILED };
      }
      if (!res.ok) {
        showErrors([res.error], res.stale === true);
        return;
      }
      recordVersion(res.updatedAt);
      draft.discard(sent);
      setBaseline(sent);
      setMessage('下書き保存しました。');
      router.refresh();
    });
  }

  function submit() {
    setMessage(null);
    const checked = validateReport(input);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    if (
      !input.lines.some((l) => l.kind === 'labor') &&
      !window.confirm('作業員が入力されていません。休工日として提出しますか？')
    ) {
      return;
    }
    setErrors([]);
    setStale(false);
    const sent = json;
    startTransition(async () => {
      // 提出内容が最新になるよう、先に保存してから提出する。
      let saved: SaveReportResult;
      try {
        saved = await saveReport(input, expected);
      } catch {
        saved = { ok: false, error: SAVE_FAILED };
      }
      if (!saved.ok) {
        showErrors([saved.error], saved.stale === true);
        return;
      }
      recordVersion(saved.updatedAt);
      draft.discard(sent);
      setBaseline(sent);
      let res: ReportStateResult;
      try {
        res = await submitReport(saved.id);
      } catch {
        res = { ok: false, error: SUBMIT_FAILED };
      }
      if (!res.ok) {
        showErrors([`保存しましたが提出できませんでした：${res.error}`]);
        router.refresh();
        return;
      }
      recordVersion(res.updatedAt);
      setMessage('提出しました（承認待ち）');
      router.refresh();
    });
  }

  /** 客先確認の記録・取り消しのあと。日報の本文は変わらないので、入力中の内容はそのまま版だけ進める。 */
  function onClientConfirmation(v: string | null) {
    recordVersion(v);
    router.refresh();
  }

  function reload() {
    // 他の端末の版が届けば ReportForm が入力欄を作り直す（未保存の入力は下書きに残り、復元を選べる）。
    startTransition(() => router.refresh());
  }

  const reportId = p.reportId;
  const canDelete =
    reportId !== null &&
    !p.review &&
    !p.siteClosed &&
    (p.isAdmin || (p.createdBy !== null && p.createdBy === p.currentUserId && (p.status === 'draft' || p.status === 'rejected')));

  function remove() {
    if (reportId === null) return;
    if (!window.confirm('この日報を削除します。明細と重要事項も消えます。よろしいですか？')) return;
    setMessage(null);
    setErrors([]);
    setStale(false);
    const current = json;
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await deleteReport(reportId);
      } catch {
        res = { ok: false, error: DELETE_FAILED };
      }
      if (!res.ok) {
        showErrors([res.error]);
        return;
      }
      // 端末の下書きも消し、画面を離れる時の自動保存で書き戻さないようにする。
      draft.discard(current);
      router.push(`/sites/${p.siteId}`);
    });
  }

  const weatherOptions = p.masters.weather.map((w) => ({ value: w, label: w }));
  const statusNote = pending
    ? '処理中…'
    : errors.length > 0
      ? `保存できません（${errors.length}件）`
      : dirty
        ? '保存していない変更があります'
        : p.status === 'none'
          ? '未保存'
          : p.status === 'submitted'
            ? '提出済み（承認待ち）'
            : '保存済み';

  return (
    <div className="pb-28">
      {!p.review && <IssueBanner issues={p.openIssues} currentReportId={p.reportId} readOnly={p.siteClosed} />}
      <Link
        href={p.review ? '/approvals' : `/sites/${p.siteId}`}
        className="mb-1 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400"
      >
        ← {p.review ? '承認待ち一覧' : p.siteName}
      </Link>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">{p.heading}</h1>
        <span className={`rounded border px-2 py-0.5 text-sm font-bold ${STATUS_COLOR[p.status]}`}>{STATUS_LABEL[p.status]}</span>
        {(p.exportLinks || reportId !== null) && (
          <span className="ml-auto flex flex-wrap justify-end gap-2">
            {reportId !== null && (
              <ClientConfirmationButton reportId={reportId} current={p.clientConfirmation} expected={expected} onChanged={onClientConfirmation} />
            )}
            {(p.exportLinks ? [['PDF', p.exportLinks.pdf], ['CSV', p.exportLinks.csv]] : []).map(([label, href]) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm font-medium dark:border-gray-600"
              >
                {label}
              </a>
            ))}
          </span>
        )}
      </div>

      {p.review && <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">{p.siteName}</p>}

      {reportId !== null && (
        <ClientConfirmationStatus reportId={reportId} current={p.clientConfirmation} expected={expected} onChanged={onClientConfirmation} />
      )}

      {p.status === 'rejected' && !p.review && (
        <p role="alert" className="mb-4 rounded-lg border border-red-500 bg-red-50 p-3 font-bold text-red-900 dark:bg-red-950 dark:text-red-50">
          差戻し：{p.rejectedReason || '（理由なし）'}
        </p>
      )}
      {p.status === 'rejected' && p.review && p.rejectedReason && (
        <p role="status" className="mb-4 rounded-lg border border-red-500 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-50">
          差戻し中：{p.rejectedReason}
        </p>
      )}

      {p.readOnly && p.status === 'approved' && (
        <p role="status" className="mb-4 rounded-lg border border-green-500 bg-green-50 p-3 font-bold text-green-900 dark:bg-green-950 dark:text-green-50">
          {APPROVED_LOCKED_MESSAGE}
        </p>
      )}
      {p.readOnly && p.readOnlyNotice && (
        <p role="status" className="mb-4 rounded-lg border border-blue-500 bg-blue-50 p-3 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-50">
          {p.readOnlyNotice}
        </p>
      )}

      {draft.pending && (
        <div role="alert" className="mb-4 rounded-lg border border-blue-500 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          <p className="font-bold">
            {draft.pendingNewer
              ? 'サーバーの内容がこの下書きより新しいです。復元すると上書きされます。'
              : '保存していない入力があります。復元しますか？'}
          </p>
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
              {!p.review && (
                <Link href={`/sites/${p.siteId}/reports/${p.prevDate}`} aria-label="前日の日報" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 dark:border-gray-600">
                  ◀
                </Link>
              )}
              <span className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-gray-100 px-2 font-bold dark:bg-gray-800">{p.dateLabel}</span>
              {!p.review && (
                <Link href={`/sites/${p.siteId}/reports/${p.nextDate}`} aria-label="翌日の日報" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-400 dark:border-gray-600">
                  ▶
                </Link>
              )}
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

        {!p.readOnly && !p.siteClosed && (
          <ImportDaySheet
            masters={p.masters}
            siteId={p.siteId}
            date={p.date}
            hasExisting={p.reportId !== null}
            status={p.status}
            siteClosed={p.siteClosed}
            onApply={applyImport}
          />
        )}

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

        <LaborTable
          rows={state.rows.labor}
          onChange={setRows('labor')}
          common={state.common}
          rule={p.rule}
          preferSaved={p.readOnly}
          date={p.date}
          workers={p.masters.workers}
        />
        <FuelTable rows={state.rows.fuel} onChange={setRows('fuel')} vehicles={p.masters.vehicles} />
        <LeaseTable rows={state.rows.lease} onChange={setRows('lease')} date={p.date} items={p.masters.leaseItems} units={p.masters.units} />
        <CashTable rows={state.rows.cash} onChange={setRows('cash')} units={p.masters.units} />
        <CreditTable rows={state.rows.credit} onChange={setRows('credit')} units={p.masters.units} suppliers={p.masters.suppliers} />
        <WorkTable rows={state.rows.work} onChange={setRows('work')} units={p.masters.units} issues={issueCandidates} />

        <ReportSummary
          totals={totals}
          changes={changes}
          outputBefore={p.outputBefore}
          contractAmount={p.contractAmount}
          tentative={p.contractTentative}
          estimatedAmount={p.estimatedAmount}
        />

        <section aria-label="重要事項・連絡事項" className="mb-6 grid gap-4 md:grid-cols-2">
          <Labeled label="重要事項">
            <textarea value={state.issuesText} maxLength={2000} rows={4} onChange={(e) => set('issuesText', e.target.value)} className={`${fieldClass} py-2`} />
          </Labeled>
          <Labeled label="連絡事項">
            <textarea value={state.notesText} maxLength={2000} rows={4} onChange={(e) => set('notesText', e.target.value)} className={`${fieldClass} py-2`} />
          </Labeled>
        </section>
      </fieldset>

      <IssueList reportId={p.reportId} issues={p.issues} onChanged={() => router.refresh()} locked={p.siteClosed} />

      {!p.readOnly && !p.review && <Band tone="warn" title="確認してください（保存はできます）" items={warnings} />}
      <Band
        id="report-errors"
        tone="error"
        title="保存・提出できません"
        items={errors}
        action={
          stale ? (
            <button type="button" onClick={reload} disabled={pending} className={`${buttonBase} mt-2 bg-red-700 text-white`}>
              再読み込み
            </button>
          ) : undefined
        }
      />
      {filledCount > 0 && !p.readOnly && (
        <p role="status" className="mb-4 rounded-lg border border-blue-400 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          日当を最新の履歴から補いました。保存すると反映されます。
        </p>
      )}
      {message && (
        <p role="status" className="mb-4 rounded-lg border border-blue-400 bg-blue-50 p-3 text-blue-950 dark:bg-blue-950 dark:text-blue-50">
          {message}
        </p>
      )}

      {canDelete && (
        <div className="mb-6 mt-10 border-t border-gray-300 pt-4 dark:border-gray-700">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={`${buttonBase} w-full border border-red-600 text-red-700 sm:w-auto dark:border-red-500 dark:text-red-400`}
          >
            この日報を削除
          </button>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {p.isAdmin ? '管理者はどの状態の日報も削除できます。' : '下書き・差戻しの日報は、作成した人が削除できます。'}
          </p>
        </div>
      )}

      {!p.readOnly && !p.review && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t border-gray-300 bg-background/95 px-4 py-2 backdrop-blur dark:border-gray-700">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm" aria-live="polite">
              {statusNote}
            </span>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={save} disabled={pending} className={`${buttonBase} bg-blue-700 text-white`}>
                下書き保存
              </button>
              <button type="button" onClick={submit} disabled={pending} className={`${buttonBase} border border-gray-400 dark:border-gray-600`}>
                {p.status === 'submitted' || p.status === 'rejected' ? '再提出' : '提出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
