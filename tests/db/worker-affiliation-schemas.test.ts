import { describe, expect, it } from 'vitest';
import {
  firstError,
  MSG_PARTNER_SUPPLIER,
  partnerCompanyChanged,
  WORKER_IN_USE_MESSAGE,
  workerDeleteError,
  workerInputSchema,
  workerWithRateSchema,
} from '@/lib/db/masters-schemas';

const S = '22222222-2222-4222-8222-222222222222';

describe('作業員の所属（workerInputSchema・workerWithRateSchema）', () => {
  it('省略は undefined（変更しない）', () => {
    const r = workerInputSchema.parse({ name: '田中' });
    expect(r.affiliation).toBeUndefined();
    expect(r.supplierId).toBeUndefined();
  });
  it('自社は取引先なしでよい。協力会社は取引先つきで通る', () => {
    expect(workerInputSchema.parse({ name: '田中', affiliation: 'own' }).affiliation).toBe('own');
    expect(workerInputSchema.parse({ name: '佐藤', affiliation: 'partner', supplierId: S })).toMatchObject({ affiliation: 'partner', supplierId: S });
  });
  it('協力会社で取引先が無い（省略・空欄・null）とエラー', () => {
    expect(firstError(workerInputSchema, { name: '佐藤', affiliation: 'partner' })).toBe(MSG_PARTNER_SUPPLIER);
    expect(firstError(workerInputSchema, { name: '佐藤', affiliation: 'partner', supplierId: '' })).toBe(MSG_PARTNER_SUPPLIER);
    expect(firstError(workerInputSchema, { name: '佐藤', affiliation: 'partner', supplierId: null })).toBe(MSG_PARTNER_SUPPLIER);
    expect(MSG_PARTNER_SUPPLIER).toBe('協力会社の作業員は、所属する協力会社（取引先）を選んでください');
  });
  it('新規＋最初の日当でも同じ検証', () => {
    const base = { name: '佐藤', amount: 18000, effectiveFrom: '2026-11-01' };
    expect(firstError(workerWithRateSchema, { ...base, affiliation: 'partner' })).toBe(MSG_PARTNER_SUPPLIER);
    expect(workerWithRateSchema.parse({ ...base, affiliation: 'partner', supplierId: S })).toMatchObject({ affiliation: 'partner', supplierId: S });
  });
  it('知らない所属はエラー', () => {
    expect(firstError(workerInputSchema, { name: '田中', affiliation: 'second' })).toBe('所属は自社か協力会社から選んでください');
  });
});

describe('作業員の削除の可否（workerDeleteError）', () => {
  it('日報の作業員の行・繰越のどちらにも使っていなければ削除できる', () => {
    expect(workerDeleteError({ reportLines: 0, carryovers: 0 })).toBeNull();
  });
  it('どちらかで使っていれば削除できない（無効にするよう案内する）', () => {
    expect(workerDeleteError({ reportLines: 1, carryovers: 0 })).toBe(WORKER_IN_USE_MESSAGE);
    expect(workerDeleteError({ reportLines: 0, carryovers: 2 })).toBe(WORKER_IN_USE_MESSAGE);
    expect(WORKER_IN_USE_MESSAGE).toBe('日報や繰越で使っているため削除できません。無効にしてください');
  });
});

describe('partnerCompanyChanged（会社を変えたら現場の登録を外す）', () => {
  const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const S2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  it('協力会社 → 自社・別の会社は true', () => {
    expect(partnerCompanyChanged({ affiliation: 'partner', supplier_id: S1 }, { affiliation: 'own', supplierId: null })).toBe(true);
    expect(partnerCompanyChanged({ affiliation: 'partner', supplier_id: S1 }, { affiliation: 'partner', supplierId: S2 })).toBe(true);
  });
  it('同じ会社・所属を省略・前が自社は false', () => {
    expect(partnerCompanyChanged({ affiliation: 'partner', supplier_id: S1 }, { affiliation: 'partner', supplierId: S1 })).toBe(false);
    expect(partnerCompanyChanged({ affiliation: 'partner', supplier_id: S1 }, {})).toBe(false);
    expect(partnerCompanyChanged({ affiliation: 'own', supplier_id: null }, { affiliation: 'partner', supplierId: S1 })).toBe(false);
  });
});
