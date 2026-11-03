import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { optionalMinutesSchema, optionalTimeSchema } from '@/lib/db/settings-schemas';

// 現場管理の入力検証スキーマ。サーバー（Server Actions）とクライアント（フォーム）の両方で使う。

export const CONTRACT_TYPES = ['元請け', '下請', '常用'] as const;
export const SITE_STATUSES = ['active', 'done'] as const;
export const SITE_ROLES = ['staff', 'reviewer', 'approver'] as const;
/** 契約金額の状態（確定・未確定）。 */
export const CONTRACT_STATUSES = ['fixed', 'tentative'] as const;

const MSG_NAME = '現場名を入力してください';
const MSG_TEXT = '200文字以内で入力してください';
const MSG_AMOUNT = '金額は0以上の数値で入力してください';
const MSG_MAN_DAYS = '人工は0以上の数値で入力してください';
const MSG_COST = '労務費は0以上の数値で入力してください';
const MSG_ESTIMATE = '概算金額は0以上の数値で入力してください';
const MSG_DAILY_RATE = '常用単価の既定は0以上の数値で入力してください';

const idSchema = z.uuid({ error: 'IDの形式が正しくありません' });

// 空文字は null として扱う（任意項目のクリア）。
const optionalText = z
  .string({ error: MSG_TEXT })
  .trim()
  .max(200, MSG_TEXT)
  .transform((v) => (v === '' ? null : v))
  .nullable();

export const siteInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string({ error: MSG_NAME }).trim().min(1, MSG_NAME).max(100, '現場名は100文字以内で入力してください'),
  clientName: optionalText,
  projectName: optionalText,
  projectNo: optionalText,
  overview: optionalText,
  contractAmount: z.number({ error: MSG_AMOUNT }).min(0, MSG_AMOUNT).nullable(),
  startDate: dateSchema.nullable(),
  endDate: dateSchema.nullable(),
  contractType: z.enum(CONTRACT_TYPES, { error: '請負の種類が正しくありません' }).nullable(),
  // 省略時: 新規は 'active'、更新は変更しない（アクション側で処理）。
  status: z.enum(SITE_STATUSES, { error: '状態が正しくありません' }).optional(),
  // 新しい日報の共通時間の既定（任意。空欄なら全社の設定）。省略時は変更しない。
  commonStart: optionalTimeSchema.optional(),
  commonEnd: optionalTimeSchema.optional(),
  commonBreakMin: optionalMinutesSchema.optional(),
  commonGapMin: optionalMinutesSchema.optional(),
  // 契約の状態と概算・見積提示額（任意）。省略時は変更しない（新規は DB の既定：確定・概算なし）。
  contractStatus: z.enum(CONTRACT_STATUSES, { error: '契約の状態が正しくありません' }).optional(),
  estimatedAmount: z.number({ error: MSG_ESTIMATE }).min(0, MSG_ESTIMATE).nullable().optional(),
  // 常用単価の既定（客先請求・円／人工。任意）。件を常用で精算するときの単価の初期値。省略時は変更しない。
  defaultDailyRate: z.number({ error: MSG_DAILY_RATE }).min(0, MSG_DAILY_RATE).nullable().optional(),
});
export type SiteInputParsed = z.output<typeof siteInputSchema>;

export const memberSchema = z.object({
  siteId: idSchema,
  userId: idSchema,
  role: z.enum(SITE_ROLES, { error: '役割が正しくありません' }).nullable(),
});

export const siteMastersSchema = z.object({
  siteId: idSchema,
  workerIds: z.array(idSchema),
  supplierIds: z.array(idSchema),
  vehicleIds: z.array(idSchema),
  leaseItemIds: z.array(idSchema),
});

export const carryoverSchema = z.object({
  workerId: idSchema,
  manDays: z.number({ error: MSG_MAN_DAYS }).min(0, MSG_MAN_DAYS),
  laborCost: z.number({ error: MSG_COST }).min(0, MSG_COST),
  beforeDate: dateSchema,
});

/** 現場の削除（アーカイブ）。実行する管理者本人のメールアドレスとパスワードで再認証する。理由は任意（空なら null）。 */
export const archiveSiteSchema = z.object({
  siteId: idSchema,
  email: z.string().trim().min(1, 'メールアドレスを入力してください').max(200),
  password: z.string().min(1, 'パスワードを入力してください').max(72),
  reason: z
    .string()
    .trim()
    .max(200, '理由は200文字以内で入力してください')
    .transform((v) => (v === '' ? null : v))
    .nullable(),
});
export type ArchiveSiteInput = z.input<typeof archiveSiteSchema>;

/** 現場の状態の切り替え（現場詳細の「完了にする」「進行中に戻す」）。 */
export const siteStatusSchema = z.object({
  siteId: idSchema,
  status: z.enum(SITE_STATUSES, { error: '状態が正しくありません' }),
});

export const PARTNER_ROLE_ERROR = '協力会社は担当のみ割り当てできます';

/** 協力会社（partner）は担当（staff）以外にできない。違反ならメッセージ、問題なければ null。 */
export function partnerRoleError(accountType: 'employee' | 'partner', role: (typeof SITE_ROLES)[number] | null): string | null {
  return accountType === 'partner' && role !== null && role !== 'staff' ? PARTNER_ROLE_ERROR : null;
}
