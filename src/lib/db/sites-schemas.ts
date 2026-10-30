import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';

// 現場管理の入力検証スキーマ。サーバー（Server Actions）とクライアント（フォーム）の両方で使う。

export const CONTRACT_TYPES = ['元請け', '下請', '常用'] as const;
export const SITE_STATUSES = ['active', 'done'] as const;
export const SITE_ROLES = ['staff', 'reviewer', 'approver'] as const;

const MSG_NAME = '現場名を入力してください';
const MSG_TEXT = '200文字以内で入力してください';
const MSG_AMOUNT = '金額は0以上の数値で入力してください';
const MSG_MAN_DAYS = '人工は0以上の数値で入力してください';
const MSG_COST = '労務費は0以上の数値で入力してください';

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
