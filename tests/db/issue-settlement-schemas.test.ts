import { describe, expect, it } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import { issueSettlementSchema } from '@/lib/db/issue-schemas';
import { ISSUE_KINDS, SETTLEMENT_METHOD_LABELS, SETTLEMENT_METHODS, settlementCategory } from '@/lib/report/change-labels';

// 重要事項の件の精算の項目（精算の方法・確定額・常用単価・確定日）と、種別から精算の区分への対応。

describe('issueSettlementSchema', () => {
  it('未定は金額なしで通る（空文字は null）', () => {
    expect(issueSettlementSchema.parse({ settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null })).toEqual({
      settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null,
    });
    expect(issueSettlementSchema.parse({ settlementMethod: 'undecided', fixedAmount: '', dailyRate: '', fixedOn: '' })).toEqual({
      settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null,
    });
  });
  it('省略すると未定・金額なし・確定日なし', () => {
    expect(issueSettlementSchema.parse({})).toEqual({ settlementMethod: 'undecided', fixedAmount: null, dailyRate: null, fixedOn: null });
  });
  it('一式は確定額、常用は常用単価があれば通る（0 も可）', () => {
    expect(issueSettlementSchema.parse({ settlementMethod: 'lump_sum', fixedAmount: 50000, dailyRate: null, fixedOn: '2026-11-05' })).toEqual({
      settlementMethod: 'lump_sum', fixedAmount: 50000, dailyRate: null, fixedOn: '2026-11-05',
    });
    expect(issueSettlementSchema.parse({ settlementMethod: 'daily_rate', fixedAmount: null, dailyRate: 0, fixedOn: null }).dailyRate).toBe(0);
  });
  it('見積は見積額があれば通る（0 も可）。見積額なしは不可', () => {
    expect(issueSettlementSchema.parse({ settlementMethod: 'estimate', fixedAmount: 120000, dailyRate: null, fixedOn: '2026-11-06' })).toEqual({
      settlementMethod: 'estimate', fixedAmount: 120000, dailyRate: null, fixedOn: '2026-11-06',
    });
    expect(issueSettlementSchema.parse({ settlementMethod: 'estimate', fixedAmount: 0 }).fixedAmount).toBe(0);
    expect(firstError(issueSettlementSchema, { settlementMethod: 'estimate', fixedAmount: null, dailyRate: null, fixedOn: null })).toBe(
      '見積のときは見積額を入力してください',
    );
    expect(firstError(issueSettlementSchema, { settlementMethod: 'estimate', fixedAmount: '', dailyRate: 30000, fixedOn: null })).toBe(
      '見積のときは見積額を入力してください',
    );
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'estimate', fixedAmount: 1000.5 }).success).toBe(false);
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'estimate', fixedAmount: -1 }).success).toBe(false);
  });
  it('一式で確定額なしは不可', () => {
    expect(firstError(issueSettlementSchema, { settlementMethod: 'lump_sum', fixedAmount: null, dailyRate: null, fixedOn: null })).toBe(
      '一式のときは確定額を入力してください',
    );
    expect(firstError(issueSettlementSchema, { settlementMethod: 'lump_sum', fixedAmount: '', dailyRate: 30000, fixedOn: null })).toBe(
      '一式のときは確定額を入力してください',
    );
  });
  it('常用で常用単価なしは不可', () => {
    expect(firstError(issueSettlementSchema, { settlementMethod: 'daily_rate', fixedAmount: 50000, dailyRate: null, fixedOn: null })).toBe(
      '常用のときは常用単価を入力してください',
    );
  });
  it('負の額・数値でない額は不可', () => {
    expect(firstError(issueSettlementSchema, { settlementMethod: 'lump_sum', fixedAmount: -1, dailyRate: null, fixedOn: null })).toBe(
      '確定額は0以上の数値で入力してください',
    );
    expect(firstError(issueSettlementSchema, { settlementMethod: 'daily_rate', fixedAmount: null, dailyRate: -1, fixedOn: null })).toBe(
      '常用単価は0以上の数値で入力してください',
    );
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'lump_sum', fixedAmount: NaN }).success).toBe(false);
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'lump_sum', fixedAmount: 'abc' }).success).toBe(false);
  });
  it('確定額・常用単価は円単位の整数（小数は不可）', () => {
    expect(firstError(issueSettlementSchema, { settlementMethod: 'lump_sum', fixedAmount: 1000.5, dailyRate: null, fixedOn: null })).toBe(
      '確定額は円単位の整数で入力してください',
    );
    expect(firstError(issueSettlementSchema, { settlementMethod: 'daily_rate', fixedAmount: null, dailyRate: 25000.1, fixedOn: null })).toBe(
      '常用単価は円単位の整数で入力してください',
    );
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'lump_sum', fixedAmount: 1000 }).success).toBe(true);
  });

  it('確定日は実在する YYYY-MM-DD のみ', () => {
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'undecided', fixedOn: '2026-02-30' }).success).toBe(false);
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'undecided', fixedOn: '2026/11/05' }).success).toBe(false);
    expect(issueSettlementSchema.safeParse({ settlementMethod: 'undecided', fixedOn: '2026-11-05' }).success).toBe(true);
  });
  it('精算の方法が正しくないと不可', () => {
    expect(firstError(issueSettlementSchema, { settlementMethod: 'monthly' })).toBe('精算の方法が正しくありません');
  });
});

describe('精算の方法の選択肢と表示名', () => {
  it('未定・一式・見積・常用（この順）', () => {
    expect(SETTLEMENT_METHODS).toEqual(['undecided', 'lump_sum', 'estimate', 'daily_rate']);
    expect(SETTLEMENT_METHOD_LABELS).toEqual({ undecided: '未定', lump_sum: '一式', estimate: '見積', daily_rate: '常用' });
    expect(SETTLEMENT_METHODS.map((m) => SETTLEMENT_METHOD_LABELS[m])).toEqual(['未定', '一式', '見積', '常用']);
  });
});

describe('settlementCategory（件の種別 → 精算の区分）', () => {
  it('7 種別の対応。やり直しは数えない（null）', () => {
    expect(settlementCategory('extra')).toBe('extra');
    expect(settlementCategory('increase')).toBe('increase');
    expect(settlementCategory('change')).toBe('change');
    expect(settlementCategory('minus')).toBe('minus');
    expect(settlementCategory('client_delay')).toBe('extra');
    expect(settlementCategory('other')).toBe('extra');
    expect(settlementCategory('rework')).toBeNull();
    expect(ISSUE_KINDS).toHaveLength(7);
  });
});
