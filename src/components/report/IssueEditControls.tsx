'use client';

import { useState, useTransition } from 'react';
import type { Issue } from '@/lib/db/reports';
import { deleteIssue, updateIssue, type ReportStateResult } from '@/lib/db/reports-actions';
import { INSTRUCTION_METHODS, INSTRUCTION_METHOD_LABELS, ISSUE_KINDS, ISSUE_KIND_LABELS, isInstructionMethod, isIssueKind } from '@/lib/report/change-labels';
import type { InstructionMethod, IssueKind } from '@/lib/types';
import { fieldClass, NumInput, Select, TextInput } from './inputs';

const FAILED = '処理に失敗しました。通信状況を確認してもう一度お試しください。';
const methodOptions = INSTRUCTION_METHODS.map((m) => ({ value: m, label: INSTRUCTION_METHOD_LABELS[m] }));
const small = 'min-h-11 rounded-lg px-3 text-sm font-bold disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

/**
 * この日報の件の「直す」「消す」（日報が下書き・差戻しのあいだだけ出す。最終判定は DB）。
 * 直すは内容・種別・指示者・指示方法・金額見込みの入力欄を開く。消すは確認してから消す（作業内容の行が使っている件・添付のある件は DB が断る）。
 */
export function IssueEditControls({ issue, label, onChanged }: { issue: Issue; label: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(issue.body);
  const [kind, setKind] = useState<IssueKind>(issue.kind);
  const [instructedBy, setInstructedBy] = useState(issue.instructedBy ?? '');
  const [method, setMethod] = useState<InstructionMethod | null>(issue.instructionMethod);
  const [amountEstimate, setAmountEstimate] = useState<number | null>(issue.amountEstimate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setBody(issue.body);
    setKind(issue.kind);
    setInstructedBy(issue.instructedBy ?? '');
    setMethod(issue.instructionMethod);
    setAmountEstimate(issue.amountEstimate);
    setError(null);
    setEditing(true);
  }

  function run(action: () => Promise<ReportStateResult>, after: () => void) {
    setError(null);
    startTransition(async () => {
      let res: ReportStateResult;
      try {
        res = await action();
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      after();
      onChanged();
    });
  }

  function save() {
    if (body.trim() === '') {
      setError('件の内容を入力してください');
      return;
    }
    run(() => updateIssue(issue.id, body, { kind, instructedBy, instructionMethod: method, amountEstimate }), () => setEditing(false));
  }

  function remove() {
    if (!window.confirm(`件「${label}」を消します。同じ日の後の件の番号は繰り上がります。よろしいですか？`)) return;
    run(() => deleteIssue(issue.id), () => undefined);
  }

  return (
    <div className="w-full">
      {!editing ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={open} disabled={pending} aria-label={`件「${label}」を直す`} className={`${small} border border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400`}>
            直す
          </button>
          <button type="button" onClick={remove} disabled={pending} aria-label={`件「${label}」を消す`} className={`${small} border border-red-600 text-red-700 dark:border-red-500 dark:text-red-400`}>
            消す
          </button>
        </div>
      ) : (
        <fieldset disabled={pending} aria-label={`件「${label}」を直す`} className="min-w-0 space-y-2 rounded-lg border border-blue-700 p-2 dark:border-blue-400">
          <Field label="件の内容（500文字まで）">
            <textarea value={body} maxLength={500} rows={2} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} py-2`} />
          </Field>
          <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="種別">
              <select value={kind} onChange={(e) => setKind(isIssueKind(e.target.value) ? e.target.value : 'other')} className={fieldClass}>
                {ISSUE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ISSUE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="指示者">
              <TextInput value={instructedBy} maxLength={100} onChange={setInstructedBy} />
            </Field>
            <Field label="指示方法">
              <Select value={method ?? ''} options={methodOptions} placeholder="—" onChange={(v) => setMethod(isInstructionMethod(v) ? v : null)} />
            </Field>
            <Field label="金額見込み（円）">
              <NumInput value={amountEstimate} integer onChange={setAmountEstimate} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} className={`${small} bg-blue-700 px-4 text-base text-white`}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`${small} border border-gray-500 px-4 text-base`}>
              やめる
            </button>
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500 bg-red-50 p-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-50">
          {error}
        </p>
      )}
    </div>
  );
}
