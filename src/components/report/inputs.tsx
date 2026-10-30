'use client';

import { useState } from 'react';

// 日報フォームの小さな入力部品。数値は文字のまま持ち、確定した数値（空欄は null）を親へ渡す。

export const fieldClass =
  'min-h-11 w-full min-w-0 rounded-lg border border-gray-400 bg-background px-2 text-base text-foreground disabled:opacity-70 dark:border-gray-600';

// 全角数字・小数点・マイナス・カンマに対応。空欄は null、数値にできなければ NaN（検証でエラーにする）。
export function parseNum(raw: string): number | null {
  const t = raw
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，]/g, '')
    .trim();
  if (t === '') return null;
  return Number(t);
}

function same(a: number | null, b: number | null): boolean {
  return a === b || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));
}

function show(v: number | null): string {
  return v === null || Number.isNaN(v) ? '' : String(v);
}

export function NumInput({
  value,
  onChange,
  integer = false,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  integer?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(show(value));
  const [prev, setPrev] = useState(value);
  // 外から値が変わった（マスター選択・前回コピー・復元など）ときだけ表示を合わせる。
  if (!same(prev, value)) {
    setPrev(value);
    if (!same(parseNum(text), value)) setText(show(value));
  }
  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNum(e.target.value);
        setPrev(n);
        onChange(n);
      }}
      className={`${fieldClass} text-right tabular-nums`}
    />
  );
}

export function TimeInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <input
      type="time"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={fieldClass}
    />
  );
}

export function TextInput({
  value,
  onChange,
  maxLength,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    />
  );
}

export interface SelectOption { value: string; label: string; }

/** 選択肢。現在値が選択肢に無い場合（無効化・現場から外れた等）も消さずに表示する。 */
export function Select({
  value,
  options,
  onChange,
  placeholder = '選択してください',
  missingLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  missingLabel?: string;
}) {
  const missing = value !== '' && !options.some((o) => o.value === value);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldClass}>
      <option value="">{placeholder}</option>
      {missing && <option value={value}>{missingLabel ?? value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 計算値の表示。 */
export function Computed({ children }: { children: React.ReactNode }) {
  return <span className="flex min-h-11 items-center justify-end font-bold tabular-nums">{children}</span>;
}
