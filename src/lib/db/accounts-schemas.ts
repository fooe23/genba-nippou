import { z } from 'zod';

// アカウント管理の入力検証。サーバー（Server Actions）とクライアント（フォーム）の両方で使う。

export const ACCOUNT_TYPES = ['employee', 'partner'] as const;
export const ACCOUNT_TYPE_LABELS = { employee: '社員', partner: '協力会社' } as const;

const MSG_COMPANY = '会社名を入力してください（100文字以内）';
const MSG_NAME = '氏名を入力してください（100文字以内）';
const MSG_EMAIL = 'メールアドレスの形式が正しくありません';
const MSG_SUPPLIER = '所属する協力会社の指定が正しくありません';
const MSG_PASSWORD = 'パスワードは8文字以上72文字以内で入力してください';

export const passwordSchema = z.string({ error: MSG_PASSWORD }).min(8, MSG_PASSWORD).max(72, MSG_PASSWORD);

export const partnerAccountSchema = z.object({
  companyName: z.string({ error: MSG_COMPANY }).trim().min(1, MSG_COMPANY).max(100, MSG_COMPANY),
  name: z.string({ error: MSG_NAME }).trim().min(1, MSG_NAME).max(100, MSG_NAME),
  email: z.string({ error: MSG_EMAIL }).trim().pipe(z.email({ error: MSG_EMAIL })),
  password: passwordSchema,
  // 所属する協力会社（取引先。任意。空欄・省略は未設定）。
  supplierId: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.uuid({ error: MSG_SUPPLIER }).nullable()).optional(),
});
export type PartnerAccountInput = z.input<typeof partnerAccountSchema>;

export const userIdSchema = z.uuid({ error: 'ユーザーの指定が正しくありません' });

export const accountTypeSchema = z.object({
  userId: userIdSchema,
  accountType: z.enum(ACCOUNT_TYPES, { error: '区分が正しくありません' }),
  companyName: z.string({ error: MSG_COMPANY }).trim().max(100, MSG_COMPANY).nullable(),
});

/** 協力会社アカウントの所属する協力会社（取引先）。null は未設定に戻す。 */
export const partnerSupplierSchema = z.object({
  userId: userIdSchema,
  supplierId: z.uuid({ error: MSG_SUPPLIER }).nullable(),
});

/** 最初のエラーメッセージ（問題なければ null）。フォーム用。 */
export function firstIssue(schema: z.ZodType, value: unknown): string | null {
  const r = schema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? '入力内容が正しくありません');
}

export const CREATE_FAILED = 'アカウントの作成に失敗しました。もう一度お試しください。';
export const RESET_FAILED = 'パスワードの再設定に失敗しました。もう一度お試しください。';

/**
 * Edge Function（admin-action）のエラー文を日本語にする。
 * 日本語の文はそのまま、Supabase の英語メッセージは既知のものだけ変換し、不明は fallback。
 */
export function mapAdminActionError(message: string | null | undefined, fallback: string = CREATE_FAILED): string {
  const m = (message ?? '').trim();
  if (m === '') return fallback;
  if (/already (been )?registered|already exists|duplicate/i.test(m)) return 'このメールアドレスは既に登録されています';
  if (/password/i.test(m)) return 'パスワードの条件を満たしていません（8文字以上で入力してください）';
  if (/invalid|e-?mail/i.test(m)) return MSG_EMAIL;
  // 日本語を含む文（「管理者権限が必要です」など）はそのまま出す。
  if (/[぀-ヿ㐀-鿿]/.test(m)) return m;
  return fallback;
}
