import { describe, expect, it } from 'vitest';
import { archiveSiteSchema, carryoverSchema, memberSchema, siteInputSchema, siteStatusSchema } from '@/lib/db/sites-schemas';
import { firstError } from '@/lib/db/masters-schemas';

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
  it('共通時間の既定：省略は undefined（変更しない）、空文字は null、不正な時刻・分は不可', () => {
    const r = siteInputSchema.parse(base);
    expect(r.commonStart).toBeUndefined();
    const filled = siteInputSchema.parse({ ...base, commonStart: '07:30', commonEnd: '17:00', commonBreakMin: 60, commonGapMin: 0 });
    expect(filled).toMatchObject({ commonStart: '07:30', commonEnd: '17:00', commonBreakMin: 60, commonGapMin: 0 });
    const cleared = siteInputSchema.parse({ ...base, commonStart: '', commonEnd: null, commonBreakMin: '', commonGapMin: null });
    expect(cleared).toMatchObject({ commonStart: null, commonEnd: null, commonBreakMin: null, commonGapMin: null });
    expect(siteInputSchema.safeParse({ ...base, commonStart: '25:00' }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, commonBreakMin: 601 }).success).toBe(false);
    expect(siteInputSchema.safeParse({ ...base, commonGapMin: 1.5 }).success).toBe(false);
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

describe('partnerRoleError', () => {
  it('協力会社は担当以外を拒否、社員・外す操作は通す', async () => {
    const { partnerRoleError, PARTNER_ROLE_ERROR } = await import('@/lib/db/sites-schemas');
    expect(PARTNER_ROLE_ERROR).toBe('協力会社は担当のみ割り当てできます');
    expect(partnerRoleError('partner', 'reviewer')).toBe(PARTNER_ROLE_ERROR);
    expect(partnerRoleError('partner', 'approver')).toBe(PARTNER_ROLE_ERROR);
    expect(partnerRoleError('partner', 'staff')).toBeNull();
    expect(partnerRoleError('partner', null)).toBeNull();
    expect(partnerRoleError('employee', 'approver')).toBeNull();
  });
});

describe('archiveSiteSchema', () => {
  const ok = {
    siteId: '11111111-1111-4111-8111-111111111111',
    email: ' admin@example.com ',
    password: 'secret-pass',
    reason: '  誤って登録した現場  ',
  };
  it('正しい入力は通り、メールと理由の前後の空白は除く', () => {
    const r = archiveSiteSchema.parse(ok);
    expect(r.email).toBe('admin@example.com');
    expect(r.reason).toBe('誤って登録した現場');
    expect(r.password).toBe('secret-pass');
  });
  it('空の理由（空白だけを含む）は null になる', () => {
    expect(archiveSiteSchema.parse({ ...ok, reason: '' }).reason).toBeNull();
    expect(archiveSiteSchema.parse({ ...ok, reason: '   ' }).reason).toBeNull();
    expect(archiveSiteSchema.parse({ ...ok, reason: null }).reason).toBeNull();
  });
  it('空のパスワードは不可', () => {
    const r = archiveSiteSchema.safeParse({ ...ok, password: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('パスワードを入力してください');
  });
  it('空のメールアドレス（空白だけを含む）は不可', () => {
    const r = archiveSiteSchema.safeParse({ ...ok, email: '  ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('メールアドレスを入力してください');
  });
  it('理由は200文字まで（201文字は不可）', () => {
    expect(archiveSiteSchema.safeParse({ ...ok, reason: 'あ'.repeat(200) }).success).toBe(true);
    const r = archiveSiteSchema.safeParse({ ...ok, reason: 'あ'.repeat(201) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('理由は200文字以内で入力してください');
  });
  it('パスワードは72文字まで、現場IDは UUID のみ', () => {
    expect(archiveSiteSchema.safeParse({ ...ok, password: 'a'.repeat(72) }).success).toBe(true);
    expect(archiveSiteSchema.safeParse({ ...ok, password: 'a'.repeat(73) }).success).toBe(false);
    expect(archiveSiteSchema.safeParse({ ...ok, siteId: 'log' }).success).toBe(false);
  });
});

describe('siteStatusSchema', () => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  it('進行中と完了だけを受け付ける', () => {
    expect(siteStatusSchema.safeParse({ siteId, status: 'active' }).success).toBe(true);
    expect(siteStatusSchema.safeParse({ siteId, status: 'done' }).success).toBe(true);
    expect(siteStatusSchema.safeParse({ siteId, status: 'deleted' }).success).toBe(false);
  });
  it('現場IDは UUID のみ', () => {
    expect(siteStatusSchema.safeParse({ siteId: 'x', status: 'done' }).success).toBe(false);
  });
});

describe('siteInputSchema（契約の状態・概算金額）', () => {
  it('省略は undefined（変更しない）', () => {
    const r = siteInputSchema.parse(base);
    expect(r.contractStatus).toBeUndefined();
    expect(r.estimatedAmount).toBeUndefined();
  });
  it('確定・未確定と、0以上の概算金額（null でクリア）を受け付ける', () => {
    expect(siteInputSchema.parse({ ...base, contractStatus: 'tentative', estimatedAmount: 1200000 })).toMatchObject({
      contractStatus: 'tentative', estimatedAmount: 1200000,
    });
    expect(siteInputSchema.parse({ ...base, contractStatus: 'fixed', estimatedAmount: null })).toMatchObject({
      contractStatus: 'fixed', estimatedAmount: null,
    });
    expect(siteInputSchema.parse({ ...base, estimatedAmount: 0 }).estimatedAmount).toBe(0);
  });
  it('正しくない値は日本語の文言で弾く', () => {
    expect(firstError(siteInputSchema, { ...base, contractStatus: 'draft' })).toBe('契約の状態が正しくありません');
    expect(firstError(siteInputSchema, { ...base, estimatedAmount: -1 })).toBe('概算金額は0以上の数値で入力してください');
    expect(firstError(siteInputSchema, { ...base, estimatedAmount: NaN })).toBe('概算金額は0以上の数値で入力してください');
  });
});

describe('siteInputSchema（常用単価の既定）', () => {
  it('省略は undefined（変更しない）、null でクリア、0以上の数値を受け付ける', () => {
    expect(siteInputSchema.parse(base).defaultDailyRate).toBeUndefined();
    expect(siteInputSchema.parse({ ...base, defaultDailyRate: null }).defaultDailyRate).toBeNull();
    expect(siteInputSchema.parse({ ...base, defaultDailyRate: 0 }).defaultDailyRate).toBe(0);
    expect(siteInputSchema.parse({ ...base, defaultDailyRate: 30000 }).defaultDailyRate).toBe(30000);
  });
  it('負の数・数値でない値は日本語の文言で弾く', () => {
    expect(firstError(siteInputSchema, { ...base, defaultDailyRate: -1 })).toBe('常用単価の既定は0以上の数値で入力してください');
    expect(firstError(siteInputSchema, { ...base, defaultDailyRate: NaN })).toBe('常用単価の既定は0以上の数値で入力してください');
    expect(firstError(siteInputSchema, { ...base, defaultDailyRate: 30000.5 })).toBe('常用単価の既定は円単位の整数で入力してください');
  });
});
