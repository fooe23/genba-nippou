'use client';

import type { ReactNode } from 'react';
import { taggedCostNote } from '@/lib/report/contract-work';
import type { IssueOption } from '@/lib/report/issue-options';
import { Select } from '../inputs';

/**
 * 根拠の件の選択（作業内容の行と、燃料・リース・現金・買掛の行で同じ選択肢・文言）。空欄は「なし」＝根拠なし（通常の工事の分）。
 * options は issueOptions(issues)（呼び出し側で 1 回だけ作る）。いまの候補に無い件は「（一覧に無い件）」で残す。
 */
export function IssuePicker({ value, options, onChange }: { value: string | null; options: IssueOption[]; onChange: (id: string | null) => void }) {
  return (
    <Select
      value={value ?? ''}
      options={options}
      placeholder="なし"
      missingLabel="（一覧に無い件）"
      onChange={(v) => onChange(v === '' ? null : v)}
    />
  );
}

/** 行の下の追加の欄（項目名つき）。 */
export function ExtraField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-gray-600 dark:text-gray-400">{label}</span>
      {children}
    </label>
  );
}

/** 「精算が必要」の印（作業内容の契約外の行と、根拠の件を選んだ費用の行で同じ見た目）。 */
export function SettlementPill() {
  return (
    <span className="rounded-full border border-amber-600 bg-amber-100 px-2.5 py-0.5 font-bold text-amber-900 dark:border-amber-400 dark:bg-amber-900 dark:text-amber-50">
      精算が必要
    </span>
  );
}

/**
 * 根拠の件を選んだ燃料・リース・現金・買掛の行の「精算が必要」と「契約外（増）の費用です。」（2026-11-11 利用者）。
 * 根拠なし・減・やり直しの件は出さない（taggedCostNote）。種別は選択肢（issueOptions）から。
 */
export function TaggedCostNote({ issueId, options }: { issueId: string | null; options: IssueOption[] }) {
  const note = taggedCostNote(issueId, new Map(options.map((o) => [o.value, o.kind])));
  if (note === null) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <SettlementPill />
      <span className="text-gray-700 dark:text-gray-300">{note}</span>
    </p>
  );
}
