'use client';

import type { ReactNode } from 'react';
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
