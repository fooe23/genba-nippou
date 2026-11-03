import { describe, expect, it } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import { issueExtraSchema } from '@/lib/db/issue-schemas';

// 重要事項の件の種別・指示者・指示方法・金額見込み（addIssue の追加の項目）。

describe('issueExtraSchema', () => {
  it('省略すると種別「その他」・指示なし・金額見込みなし', () => {
    expect(issueExtraSchema.parse({})).toEqual({ kind: 'other', instructedBy: null, instructionMethod: null, amountEstimate: null });
  });
  it('種別・指示者・指示方法・金額見込みを受け付ける（空欄は null、金額 0 は可）', () => {
    expect(issueExtraSchema.parse({ kind: 'client_delay', instructedBy: ' 元請 佐藤 ', instructionMethod: 'phone', amountEstimate: 0 })).toEqual({
      kind: 'client_delay', instructedBy: '元請 佐藤', instructionMethod: 'phone', amountEstimate: 0,
    });
    expect(issueExtraSchema.parse({ kind: 'extra', instructedBy: '  ', instructionMethod: '', amountEstimate: '' })).toEqual({
      kind: 'extra', instructedBy: null, instructionMethod: null, amountEstimate: null,
    });
    for (const kind of ['extra', 'increase', 'change', 'minus', 'client_delay', 'rework', 'other']) {
      expect(issueExtraSchema.safeParse({ kind }).success).toBe(true);
    }
  });
  it('正しくない値は日本語の文言で弾く', () => {
    expect(firstError(issueExtraSchema, { kind: 'plus' })).toBe('件の種別が正しくありません');
    expect(firstError(issueExtraSchema, { instructionMethod: 'fax' })).toBe('指示方法は口頭・電話・メール・書面・その他から選んでください');
    expect(firstError(issueExtraSchema, { amountEstimate: -1 })).toBe('金額見込みは0以上の数値で入力してください');
    expect(firstError(issueExtraSchema, { amountEstimate: 'abc' })).toBe('金額見込みは0以上の数値で入力してください');
    expect(firstError(issueExtraSchema, { instructedBy: 'あ'.repeat(101) })).toBe('指示者は100文字以内で入力してください');
  });
});
