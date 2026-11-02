import { describe, expect, it } from 'vitest';
import { IMPORT_ROWS_MAX, importInputSchema, importPayloadSchema } from '@/lib/db/import-schemas';
import { firstError } from '@/lib/db/masters-schemas';

const worker = { name: '山田 太郎', trade: '大工', note: null, daily_rate: 18000, overtime_rate: null };
const empty = { workers: [], suppliers: [], vehicles: [], lease_items: [] };
const ok = { fileName: '現場管理台帳_V34.xlsm', effectiveFrom: '2026-11-03', payload: { ...empty, workers: [worker] } };

describe('importInputSchema（マスター取り込み）', () => {
  it('正しい入力は通り、空文字は null にそろえる', () => {
    const r = importInputSchema.parse({ ...ok, payload: { ...empty, suppliers: [{ name: ' ○○建材 ', category: '', contact: ' 佐藤 ', note: null }] } });
    expect(r.payload.suppliers[0]).toEqual({ name: '○○建材', category: null, contact: '佐藤', note: null });
    expect(importInputSchema.safeParse(ok).success).toBe(true);
  });

  it('適用開始日は YYYY-MM-DD の実在する日付', () => {
    expect(firstError(importInputSchema, { ...ok, effectiveFrom: '2026/11/03' })).toBe('日付は YYYY-MM-DD 形式で入力してください');
    expect(importInputSchema.safeParse({ ...ok, effectiveFrom: '2026-02-30' }).success).toBe(false);
  });

  it('数値は 0 以上か null（負の数・NaN は不可）', () => {
    expect(firstError(importInputSchema, { ...ok, payload: { ...empty, workers: [{ ...worker, daily_rate: -1 }] } })).toBe('数値は0以上で入力してください');
    expect(importInputSchema.safeParse({ ...ok, payload: { ...empty, lease_items: [{ name: '足場', spec: null, note: null, unit_price: -0.5 }] } }).success).toBe(false);
    expect(importInputSchema.safeParse({ ...ok, payload: { ...empty, vehicles: [{ name: 'バン', kind: null, km_per_l: NaN, note: null }] } }).success).toBe(false);
    expect(importInputSchema.safeParse({ ...ok, payload: { ...empty, workers: [{ ...worker, daily_rate: 0, overtime_rate: null }] } }).success).toBe(true);
  });

  it('名前は 1〜200 文字、ファイル名は 200 文字まで', () => {
    expect(firstError(importInputSchema, { ...ok, payload: { ...empty, workers: [{ ...worker, name: '  ' }] } })).toBe('名前は1〜200文字で入力してください');
    expect(importInputSchema.safeParse({ ...ok, payload: { ...empty, workers: [{ ...worker, name: 'あ'.repeat(201) }] } }).success).toBe(false);
    expect(importInputSchema.safeParse({ ...ok, fileName: 'a'.repeat(201) }).success).toBe(false);
  });

  it(`種別ごとに ${IMPORT_ROWS_MAX} 件まで`, () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...worker, name: `作業員${i}` }));
    expect(importPayloadSchema.safeParse({ ...empty, workers: rows(IMPORT_ROWS_MAX) }).success).toBe(true);
    expect(firstError(importPayloadSchema, { ...empty, workers: rows(IMPORT_ROWS_MAX + 1) })).toBe('1回に取り込めるのは種別ごとに500件までです');
  });

  it('行が 1 つも無ければ不可', () => {
    expect(firstError(importInputSchema, { ...ok, payload: empty })).toBe('取り込む行がありません');
  });
});
