import { describe, expect, it } from 'vitest';
import { accountTypeSchema, mapAdminActionError, partnerAccountSchema, partnerSupplierSchema } from '@/lib/db/accounts-schemas';

const ok = { companyName: '山田建設', name: '山田太郎', email: 'yamada@example.com', password: 'abcd1234' };

describe('partnerAccountSchema', () => {
  it('正しい入力は通り、前後の空白は除かれる', () => {
    const r = partnerAccountSchema.safeParse({ ...ok, companyName: ' 山田建設 ', email: ' yamada@example.com ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.companyName).toBe('山田建設');
      expect(r.data.email).toBe('yamada@example.com');
    }
  });
  it('会社名・氏名の空と100文字超、メール形式、パスワード長を拒否', () => {
    expect(partnerAccountSchema.safeParse({ ...ok, companyName: ' ' }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, name: '' }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, name: 'あ'.repeat(101) }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, email: 'not-an-email' }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, password: '1234567' }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, password: 'a'.repeat(73) }).success).toBe(false);
    expect(partnerAccountSchema.safeParse({ ...ok, password: 'a'.repeat(72) }).success).toBe(true);
  });
});

describe('accountTypeSchema', () => {
  it('区分は employee / partner のみ', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(accountTypeSchema.safeParse({ userId: id, accountType: 'partner', companyName: '山田建設' }).success).toBe(true);
    expect(accountTypeSchema.safeParse({ userId: id, accountType: 'admin', companyName: null }).success).toBe(false);
  });
});

describe('mapAdminActionError', () => {
  it('Supabase の英語メッセージを日本語にする', () => {
    expect(mapAdminActionError('A user with this email address has already been registered')).toBe('このメールアドレスは既に登録されています');
    expect(mapAdminActionError('Unable to validate email address: invalid format')).toBe('メールアドレスの形式が正しくありません');
    expect(mapAdminActionError('Password should be at least 6 characters')).toContain('パスワード');
  });
  it('日本語の文はそのまま、不明な英語・空は汎用の文言', () => {
    expect(mapAdminActionError('管理者権限が必要です')).toBe('管理者権限が必要です');
    expect(mapAdminActionError('認証が必要です')).toBe('認証が必要です');
    expect(mapAdminActionError('Something broke')).toBe('アカウントの作成に失敗しました。もう一度お試しください。');
    expect(mapAdminActionError(null)).toBe('アカウントの作成に失敗しました。もう一度お試しください。');
    expect(mapAdminActionError('', 'x')).toBe('x');
  });
});

describe('協力会社アカウントの所属する協力会社（2026-11-07）', () => {
  const ok = { companyName: '山田工業', name: '山田 太郎', email: 'yamada@example.com', password: 'password1' };
  const S = '22222222-2222-4222-8222-222222222222';
  it('作成時は任意（省略・空欄は null）、指定すれば取引先の ID', () => {
    expect(partnerAccountSchema.parse(ok).supplierId).toBeUndefined();
    expect(partnerAccountSchema.parse({ ...ok, supplierId: '' }).supplierId).toBeNull();
    expect(partnerAccountSchema.parse({ ...ok, supplierId: S }).supplierId).toBe(S);
    expect(partnerAccountSchema.safeParse({ ...ok, supplierId: 'x' }).error?.issues[0].message).toBe('所属する協力会社の指定が正しくありません');
  });
  it('設定・解除（null）', () => {
    expect(partnerSupplierSchema.parse({ userId: S, supplierId: null }).supplierId).toBeNull();
    expect(partnerSupplierSchema.parse({ userId: S, supplierId: S }).supplierId).toBe(S);
  });
});
