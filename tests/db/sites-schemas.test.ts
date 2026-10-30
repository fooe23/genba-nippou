import { describe, expect, it } from 'vitest';
import { carryoverSchema, memberSchema, siteInputSchema } from '@/lib/db/sites-schemas';

const base = {
  name: '村山一彦様邸 母屋修繕工事',
  clientName: null,
  projectName: null,
  projectNo: null,
  overview: null,
  contractAmount: null,
  startDate: null,
  endDate: null,
  contractType: null,
};

describe('siteInputSchema', () => {
  it('必須項目だけで通り、status は省略のまま', () => {
    const r = siteInputSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBeUndefined();
  });
  it('空文字の任意項目は null になり、前後の空白は除く', () => {
    const r = siteInputSchema.parse({ ...base, clientName: '  ', projectNo: ' A-1 ' });
    expect(r.clientName).toBeNull();
    expect(r.projectNo).toBe('A-1');
  });
  it('現場名が空・101文字は不可', () => {
    expect(siteInputSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, name: 'あ'.repeat(101) }).success).toBe(false);
  });
  it('金額は0以上の有限数のみ', () => {
    expect(siteInputSchema.safeParse({ ...base, contractAmount: 0 }).success).toBe(true);
    expect(siteInputSchema.safeParse({ ...base, contractAmount: -1 }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, contractAmount: NaN }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, contractAmount: Infinity }).success).toBe(false);
  });
  it('日付と請負の種類を検証する', () => {
    expect(siteInputSchema.safeParse({ ...base, startDate: '2026-10-01', contractType: '元請け' }).success).toBe(true);
    expect(siteInputSchema.safeParse({ ...base, startDate: '2026-02-30' }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, contractType: '孫請け' }).success).toBe(false);
  });
  it('200文字を超える任意項目は不可', () => {
    expect(siteInputSchema.safeParse({ ...base, overview: 'あ'.repeat(201) }).success).toBe(false);
  });
});

describe('carryoverSchema', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('正しい値は通る', () => {
    expect(carryoverSchema.safeParse({ workerId: id, manDays: 12.5, laborCost: 225000, beforeDate: '2026-10-01' }).success).toBe(true);
  });
  it('負数・NaN・不正な日付は不可', () => {
    expect(carryoverSchema.safeParse({ workerId: id, manDays: -1, laborCost: 0, beforeDate: '2026-10-01' }).success).toBe(false);
    expect(carryoverSchema.safeParse({ workerId: id, manDays: NaN, laborCost: 0, beforeDate: '2026-10-01' }).success).toBe(false);
    expect(carryoverSchema.safeParse({ workerId: id, manDays: 1, laborCost: 0, beforeDate: '2026/10/01' }).success).toBe(false);
  });
});

describe('memberSchema', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('役割は3種か null（削除）のみ', () => {
    expect(memberSchema.safeParse({ siteId: id, userId: id, role: 'approver' }).success).toBe(true);
    expect(memberSchema.safeParse({ siteId: id, userId: id, role: null }).success).toBe(true);
    expect(memberSchema.safeParse({ siteId: id, userId: id, role: 'admin' }).success).toBe(false);
  });
});
