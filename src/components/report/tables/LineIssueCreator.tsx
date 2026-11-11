'use client';

import { useState, useTransition } from 'react';
import { addIssue } from '@/lib/db/reports-actions';
import { INSTRUCTION_METHODS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS, isInstructionMethod } from '@/lib/report/change-labels';
import { LINE_ISSUE_KINDS, lineIssuePrefill, type LineIssueKind } from '@/lib/report/line-issue';
import { ESTIMATE_REQUIREMENT_LABELS, ESTIMATE_REQUIREMENTS, isEstimateRequirement, newIssueFormDefaults } from '@/lib/report/estimate-requirement';
import type { EstimateRequirement, InstructionMethod, WorkLine } from '@/lib/types';
import { fieldClass, Select, TextInput } from '../inputs';

const FAILED = '件を作れませんでした。通信状況を確認してもう一度お試しください。';
const methodOptions = INSTRUCTION_METHODS.map((m) => ({ value: m, label: INSTRUCTION_METHOD_LABELS[m] }));

/**
 * 作業内容の行の「＋ この行の件を作る」。行の区分・工種／施工内容・指示から初期値を入れた小さな入力欄を開き、
 * 件を作ったらこの行の根拠の件にする（画面の入力だけ。行の保存は「下書き保存」）。日報が未保存なら作れない。
 * 見積書（2026-11-20）：社員・管理者は選べる（既定は現場の設定と種別）。協力会社は DB が決める（表示だけ）。
 * 要（先に出す）の件は見積中で作られる。行の件は工事が済んでいることが多いので「後出し」を案内する。
 */
export function LineIssueCreator({
  line,
  rowNumber,
  reportId,
  onCreated,
  estimate,
}: {
  line: WorkLine;
  rowNumber: number;
  /** 保存済みの日報の id（未保存なら null）。 */
  reportId: string | null;
  /** 件を作った（id をこの行の根拠の件にし、件の候補を読み直す）。 */
  onCreated: (issueId: string) => void;
  /** 見積書の欄（DB に列があるか・社員か・現場の必須の設定）。省略は出さない。 */
  estimate?: { ready: boolean; isStaff: boolean; siteRequired: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LineIssueKind>('extra');
  const [body, setBody] = useState('');
  const [instructedBy, setInstructedBy] = useState('');
  const [method, setMethod] = useState<InstructionMethod | null>(null);
  const [chosenEstimate, setChosenEstimate] = useState<EstimateRequirement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const estimateForm = newIssueFormDefaults({
    ready: estimate?.ready ?? false,
    isStaff: estimate?.isStaff ?? false,
    siteRequired: estimate?.siteRequired ?? false,
    kind,
    chosen: chosenEstimate,
  });

  function start() {
    const p = lineIssuePrefill(line);
    setKind(p.kind);
    setBody(p.body);
    setInstructedBy(p.instructedBy);
    setMethod(p.instructionMethod);
    setChosenEstimate(null);
    setError(null);
    setOpen(true);
  }

  function create() {
    if (!reportId) return;
    const text = body.trim();
    if (text === '') {
      setError('件の内容を入力してください');
      return;
    }
    setError(null);
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof addIssue>>;
      try {
        res = await addIssue(reportId, text, {
          kind,
          instructedBy,
          instructionMethod: method,
          ...(estimateForm.mode === 'select' ? { estimateRequirement: estimateForm.requirement } : {}),
        });
      } catch {
        res = { ok: false, error: FAILED };
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      onCreated(res.id);
    });
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={start}
          disabled={!reportId}
          className="min-h-11 rounded-lg border border-blue-700 px-3 text-sm font-bold text-blue-700 disabled:opacity-50 dark:border-blue-400 dark:text-blue-400"
        >
          ＋ この行の件を作る
        </button>
        {!reportId && <span className="text-sm text-gray-600 dark:text-gray-400">先に下書き保存してください</span>}
      </div>
    );
  }

  return (
    <fieldset
      disabled={pending}
      aria-label={`${rowNumber}行目の件を作る`}
      className="mt-2 min-w-0 space-y-2 rounded-lg border border-blue-700 bg-background p-2 dark:border-blue-400"
    >
      <legend className="px-1 text-sm font-bold">この行の件を作る</legend>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">種別</span>
          <select
            value={kind}
            onChange={(e) => setKind((LINE_ISSUE_KINDS as readonly string[]).includes(e.target.value) ? (e.target.value as LineIssueKind) : 'extra')}
            className={fieldClass}
          >
            {LINE_ISSUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ISSUE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">指示者</span>
          <TextInput value={instructedBy} maxLength={100} onChange={setInstructedBy} />
        </label>
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">指示方法</span>
          <Select value={method ?? ''} options={methodOptions} placeholder="—" onChange={(v) => setMethod(isInstructionMethod(v) ? v : null)} />
        </label>
      </div>
      <label className="block min-w-0">
        <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">件の内容（500文字まで）</span>
        <textarea value={body} maxLength={500} rows={2} onChange={(e) => setBody(e.target.value)} className={`${fieldClass} py-2`} />
      </label>
      {estimateForm.mode === 'select' && (
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">見積書</span>
          <select
            value={estimateForm.requirement}
            onChange={(e) => setChosenEstimate(isEstimateRequirement(e.target.value) ? e.target.value : null)}
            className={fieldClass}
          >
            {ESTIMATE_REQUIREMENTS.map((r) => (
              <option key={r} value={r}>
                {ESTIMATE_REQUIREMENT_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      )}
      {estimateForm.mode === 'display' && (
        <p className="text-sm text-gray-700 dark:text-gray-300">見積書：{ESTIMATE_REQUIREMENT_LABELS[estimateForm.requirement]}（現場の設定）</p>
      )}
      {estimateForm.mode !== 'hidden' && estimateForm.requirement === 'before' && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {estimateForm.mode === 'select'
            ? '先に工事をした件なら、見積書を「後出し」にしてください（「要（先に出す）」の件は見積中で作ります）。'
            : '見積中で作ります。社員が見積提出を記録するまで、対応中・完了にはできません。'}
        </p>
      )}
      {kind === 'site_judgment' && (
        <p className="text-sm text-gray-700 dark:text-gray-300">現場の状況でやった理由を書き、あとで件に写真を付けてください。精算はあとで協議します。</p>
      )}
      {error && (
        <p role="alert" className="text-sm font-bold text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={create} className="min-h-11 rounded-lg bg-blue-700 px-4 text-base font-bold text-white disabled:opacity-50">
          件を作ってこの行に付ける
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-lg border border-gray-500 px-4 text-base font-bold disabled:opacity-50"
        >
          やめる
        </button>
      </div>
    </fieldset>
  );
}
