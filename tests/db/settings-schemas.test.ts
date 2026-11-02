import { describe, expect, it } from 'vitest';
import { firstError, workerInputSchema, workerWithRateSchema } from '@/lib/db/masters-schemas';
import { settingsInputSchema } from '@/lib/db/settings-schemas';

const ok = {
  shoteiHours: 7.5,
  fixedOvertimeLimit: 8,
  overtimeMultiplier: 1.25,
  overtimeBaseHours: 8,
  defaultCommonStart: '08:00',
  defaultCommonEnd: '17:30',
  defaultCommonBreakMin: 90,
  defaultCommonGapMin: 0,
};

describe('settingsInputSchema（労務の設定）', () => {
  it('既定値は通る', () => {
    expect(settingsInputSchema.parse(ok)).toEqual(ok);
  });
  it('範囲の端は通る（割増率 0・固定残業の上限 0 も可）', () => {
    expect(settingsInputSchema.safeParse({ ...ok, shoteiHours: 0.5, overtimeBaseHours: 24, fixedOvertimeLimit: 0, overtimeMultiplier: 0 }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ ...ok, overtimeMultiplier: 5, fixedOvertimeLimit: 24 }).success).toBe(true);
  });
  it('範囲外は日本語の文言で弾く', () => {
    expect(firstError(settingsInputSchema, { ...ok, shoteiHours: 0 })).toBe('1人工の基準時間（所定）は0.5〜24の数値で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, shoteiHours: 25 })).toBe('1人工の基準時間（所定）は0.5〜24の数値で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, fixedOvertimeLimit: -1 })).toBe('固定残業の上限時間は0〜24の数値で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, overtimeMultiplier: 5.1 })).toBe('残業の割増率は0〜5の数値で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, overtimeBaseHours: 0.4 })).toBe('残業単価の基準時間は0.5〜24の数値で入力してください');
    expect(settingsInputSchema.safeParse({ ...ok, shoteiHours: NaN }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...ok, shoteiHours: null }).success).toBe(false);
  });
  it('共通時間：空文字は null、不正な時刻・範囲外の分・小数の分は不可', () => {
    const r = settingsInputSchema.parse({ ...ok, defaultCommonStart: '', defaultCommonEnd: ' ', defaultCommonBreakMin: '', defaultCommonGapMin: null });
    expect(r).toMatchObject({ defaultCommonStart: null, defaultCommonEnd: null, defaultCommonBreakMin: null, defaultCommonGapMin: null });
    expect(firstError(settingsInputSchema, { ...ok, defaultCommonStart: '24:00' })).toBe('時刻は HH:MM 形式で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, defaultCommonEnd: '8:00' })).toBe('時刻は HH:MM 形式で入力してください');
    expect(firstError(settingsInputSchema, { ...ok, defaultCommonBreakMin: 601 })).toBe('休憩・中抜は0〜600の整数（分）で入力してください');
    expect(settingsInputSchema.safeParse({ ...ok, defaultCommonGapMin: -1 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...ok, defaultCommonBreakMin: 1.5 }).success).toBe(false);
  });
});

describe('workerInputSchema（残業単価）', () => {
  const w = { name: '田中' };
  it('省略は undefined（変更しない）、空文字・null は null（標準の計算式）', () => {
    expect(workerInputSchema.parse(w).overtimeRate).toBeUndefined();
    expect(workerInputSchema.parse({ ...w, overtimeRate: '' }).overtimeRate).toBeNull();
    expect(workerInputSchema.parse({ ...w, overtimeRate: null }).overtimeRate).toBeNull();
    expect(workerInputSchema.parse({ ...w, overtimeRate: 3000 }).overtimeRate).toBe(3000);
    expect(workerInputSchema.parse({ ...w, overtimeRate: 0 }).overtimeRate).toBe(0);
  });
  it('負の数・数値でない入力は不可', () => {
    expect(firstError(workerInputSchema, { ...w, overtimeRate: -1 })).toBe('残業単価は0以上の数値で入力してください');
    expect(firstError(workerInputSchema, { ...w, overtimeRate: NaN })).toBe('残業単価は0以上の数値で入力してください');
  });
  it('新規＋最初の日当でも残業単価を受け取る', () => {
    const r = workerWithRateSchema.parse({ ...w, overtimeRate: 2500, amount: 18000, effectiveFrom: '2026-11-01' });
    expect(r.overtimeRate).toBe(2500);
  });
});
