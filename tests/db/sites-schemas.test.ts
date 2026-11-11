import { describe, expect, it } from 'vitest';
import {
  archiveSiteSchema,
  carryoverSchema,
  copySitePartnersMessage,
  copySitePartnersSchema,
  memberSchema,
  parseYenInput,
  partnerAmountError,
  planSitePartnerCopy,
  siteInputSchema,
  sitePartnerAddSchema,
  SITE_PARTNER_DUPLICATE_WORKER_MESSAGE,
  SITE_PARTNERS_CLOSED_MESSAGE,
  SITE_PARTNERS_FORBIDDEN_MESSAGE,
  sitePartnerUpdateSchema,
  sitePartnerWorkerAddSchema,
  sitePartnerWorkerRpcError,
  siteStatusSchema,
} from '@/lib/db/sites-schemas';
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

describe('現場の協力会社と作業員の登録（2026-11-07）', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  it('請負金額・メモは任意（空欄は null）。負の金額はエラー', () => {
    expect(sitePartnerAddSchema.parse({ siteId: A, supplierId: B })).toMatchObject({ amount: null, note: null });
    expect(sitePartnerAddSchema.parse({ siteId: A, supplierId: B, amount: '', note: '  ' })).toMatchObject({ amount: null, note: null });
    expect(sitePartnerUpdateSchema.parse({ id: A, amount: 500000, note: '内装一式' })).toMatchObject({ amount: 500000, note: '内装一式' });
    expect(sitePartnerAddSchema.safeParse({ siteId: A, supplierId: B, amount: -1 }).error?.issues[0].message).toBe('請負金額は0以上の数値で入力してください');
    expect(sitePartnerAddSchema.safeParse({ siteId: A, supplierId: '' }).error?.issues[0].message).toBe('協力会社（取引先）を選んでください');
  });
  it('同じ現場どうしは写せない', () => {
    expect(copySitePartnersSchema.safeParse({ fromSiteId: A, toSiteId: A }).error?.issues[0].message).toBe('写し元と写し先が同じ現場です');
    expect(copySitePartnersSchema.safeParse({ fromSiteId: A, toSiteId: B }).success).toBe(true);
  });
  it('planSitePartnerCopy：写し先に無い協力会社と有効な作業員だけを、写し元の順で写す', () => {
    const plan = planSitePartnerCopy(
      {
        supplierIds: ['s1', 's2'],
        workers: [
          { id: 'w1', supplierId: 's1', active: true },
          { id: 'w2', supplierId: 's1', active: false },
          { id: 'w3', supplierId: 's3', active: true },
          { id: 'w4', supplierId: 's2', active: true },
        ],
      },
      { supplierIds: ['s2'], workerIds: ['w4'] },
    );
    // s3 は写し元の協力会社に無いが、写す作業員 w3 の会社なので足す。w2 は無効、w4 は登録済み。
    expect(plan).toEqual({ supplierIds: ['s1', 's3'], workerIds: ['w1', 'w3'], skippedPartners: 0 });
  });
  it('planSitePartnerCopy：協力会社の印の無い会社とその作業員は写さず、数を返す', () => {
    const plan = planSitePartnerCopy(
      {
        supplierIds: ['s1', 'sx'],
        workers: [
          { id: 'w1', supplierId: 's1', active: true },
          { id: 'w2', supplierId: 'sx', active: true },
          { id: 'w3', supplierId: 'sy', active: true },
        ],
      },
      { supplierIds: [], workerIds: [] },
      (id) => id === 's1',
    );
    expect(plan).toEqual({ supplierIds: ['s1'], workerIds: ['w1'], skippedPartners: 2 });
    expect(copySitePartnersMessage({ partners: 1, workers: 1, skippedPartners: 2 })).toBe(
      '協力会社 1 社・作業員 1 人を写しました（協力会社の印の無い会社 2 社とその作業員は写していません）',
    );
    expect(copySitePartnersMessage({ partners: 0, workers: 0, skippedPartners: 1 })).toBe(
      '写す協力会社・作業員はありませんでした（協力会社の印の無い会社 1 社とその作業員は写していません）',
    );
  });
  it('写すものが無ければ空。文言は件数で変える', () => {
    expect(planSitePartnerCopy({ supplierIds: ['s1'], workers: [] }, { supplierIds: ['s1'], workerIds: [] })).toEqual({ supplierIds: [], workerIds: [], skippedPartners: 0 });
    expect(copySitePartnersMessage({ partners: 2, workers: 5 })).toBe('協力会社 2 社・作業員 5 人を写しました');
    expect(copySitePartnersMessage({ partners: 0, workers: 0 })).toBe('写す協力会社・作業員はありませんでした（すでに登録済みです）');
  });
});

describe('請負金額の入力（parseYenInput・partnerAmountError）', () => {
  it('カンマ・空白・円・全角数字を受け付け、空欄は null', () => {
    expect(parseYenInput('1,500,000')).toBe(1500000);
    expect(parseYenInput(' １５０００００円 ')).toBe(1500000);
    expect(parseYenInput('')).toBeNull();
    expect(parseYenInput('abc')).toBeNaN();
  });
  it('円単位の整数・0以上・上限まで', () => {
    expect(partnerAmountError(null)).toBeNull();
    expect(partnerAmountError(1500000)).toBeNull();
    expect(partnerAmountError(99_999_999_999)).toBeNull();
    expect(partnerAmountError(1.5)).toBe('請負金額は円単位の整数で入力してください（小数は使えません）');
    expect(partnerAmountError(100_000_000_000)).toBe('請負金額が大きすぎます（999億9999万9999円まで）');
    expect(partnerAmountError(-1)).toBe('請負金額は0以上の数値で入力してください');
    expect(partnerAmountError(Number.NaN)).toBe('請負金額は0以上の数値で入力してください');
    expect(sitePartnerUpdateSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111', amount: 1.5 }).success).toBe(false);
  });
});

describe('sitePartnerWorkerAddSchema（現場から協力会社の作業員を新しく登録）', () => {
  const base = {
    siteId: '11111111-1111-4111-8111-111111111111',
    supplierId: '22222222-2222-4222-8222-222222222222',
    name: ' 山田 太郎 ',
    trade: '鳶',
    amount: 20000,
    overtimeRate: null,
  };
  it('名前・日当があれば通り、名前は前後の空白を除く', () => {
    const r = sitePartnerWorkerAddSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('山田 太郎');
      expect(r.data.overtimeRate).toBeNull();
    }
  });
  it('名前が空・日当が無い（NaN）・負はエラー', () => {
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, name: '  ' }).success).toBe(false);
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, amount: Number.NaN }).success).toBe(false);
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
  it('残業単価は空欄（null・空文字）なら null、負はエラー', () => {
    const r = sitePartnerWorkerAddSchema.safeParse({ ...base, overtimeRate: '' });
    expect(r.success && r.data.overtimeRate).toBeNull();
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, overtimeRate: 3125 }).success).toBe(true);
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, overtimeRate: -5 }).success).toBe(false);
  });
  it('名前は 100 文字まで（作業員マスターと同じ）', () => {
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, name: 'あ'.repeat(101) }).success).toBe(false);
  });
  it('現場・会社の ID が不正ならエラー', () => {
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, siteId: 'x' }).success).toBe(false);
    expect(sitePartnerWorkerAddSchema.safeParse({ ...base, supplierId: '' }).success).toBe(false);
  });
});

describe('sitePartnerWorkerRpcError（gn_add_site_partner_worker のエラー → 文言）', () => {
  it('それぞれの理由を日本語にする', () => {
    expect(sitePartnerWorkerRpcError('not_employee')).toBe(SITE_PARTNERS_FORBIDDEN_MESSAGE);
    expect(sitePartnerWorkerRpcError('site_closed')).toBe(SITE_PARTNERS_CLOSED_MESSAGE);
    expect(sitePartnerWorkerRpcError('not_member')).toContain('権限');
    expect(sitePartnerWorkerRpcError('not_site_partner')).toContain('この現場の協力会社ではない');
    expect(sitePartnerWorkerRpcError('invalid_input')).toContain('日当');
    expect(sitePartnerWorkerRpcError('duplicate_worker')).toBe(SITE_PARTNER_DUPLICATE_WORKER_MESSAGE);
  });
  it('関数が無い（SQL 未実行）ときは管理者への連絡を促す', () => {
    expect(sitePartnerWorkerRpcError('Could not find the function public.gn_add_site_partner_worker(p_daily_rate, ...) in the schema cache')).toContain(
      'データベースの更新',
    );
  });
  it('それ以外・不明は再試行の文言', () => {
    expect(sitePartnerWorkerRpcError('boom')).toBe('作業員の登録に失敗しました。もう一度お試しください。');
    expect(sitePartnerWorkerRpcError(null)).toBe('作業員の登録に失敗しました。もう一度お試しください。');
  });
});

describe('siteInputSchema（見積提出が必須のお客様）', () => {
  it('省略は undefined（変更しない）、真偽を受け付け、それ以外は日本語の文言で弾く', () => {
    expect(siteInputSchema.parse(base).estimateRequired).toBeUndefined();
    expect(siteInputSchema.parse({ ...base, estimateRequired: true }).estimateRequired).toBe(true);
    expect(siteInputSchema.parse({ ...base, estimateRequired: false }).estimateRequired).toBe(false);
    expect(firstError(siteInputSchema, { ...base, estimateRequired: 'yes' })).toBe('見積提出が必須の指定が正しくありません');
  });
});
