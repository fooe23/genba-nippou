import { z } from 'zod';
import type { ZodType } from 'zod';

// マスター入力の検証スキーマ。サーバー（Server Actions）とクライアント（フォーム）の両方で使う。
// 本番ビルドでは Server Action が投げた Error の文言がクライアントに届かないため、
// クライアント側でも同じスキーマで検証して日本語メッセージを表示する。

const MSG_NAME = '名前を入力してください';
const MSG_AMOUNT = '金額は0以上の数値で入力してください';
const MSG_DATE = '日付は YYYY-MM-DD 形式で入力してください';
const MSG_KM = '燃費は0以上の数値で入力してください';
const MSG_SORT = '並び順は0以上の整数で入力してください';

const idSchema = z.uuid({ error: 'IDの形式が正しくありません' });
const nameSchema = z
  .string({ error: MSG_NAME })
  .trim()
  .min(1, MSG_NAME)
  .max(100, '名前は100文字以内で入力してください');
const textSchema = z.string().trim().max(500, '500文字以内で入力してください');

export const amountSchema = z.number({ error: MSG_AMOUNT }).min(0, MSG_AMOUNT);
export const dateSchema = z
  .string({ error: MSG_DATE })
  .regex(/^\d{4}-\d{2}-\d{2}$/, MSG_DATE)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, MSG_DATE);

export const workerInputSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  trade: textSchema.optional(),
  note: textSchema.optional(),
  active: z.boolean().optional(),
});
export type WorkerInput = z.input<typeof workerInputSchema>;

export const supplierInputSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  category: textSchema.optional(),
  contact: textSchema.optional(),
  note: textSchema.optional(),
  active: z.boolean().optional(),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

export const vehicleInputSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  kind: textSchema.optional(),
  kmPerL: z.number({ error: MSG_KM }).min(0, MSG_KM).nullable().optional(),
  note: textSchema.optional(),
  active: z.boolean().optional(),
});
export type VehicleInput = z.input<typeof vehicleInputSchema>;

export const leaseItemInputSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  spec: textSchema.optional(),
  note: textSchema.optional(),
  active: z.boolean().optional(),
});
export type LeaseItemInput = z.input<typeof leaseItemInputSchema>;

export const rateInputSchema = z.object({
  ownerId: idSchema,
  amount: amountSchema,
  effectiveFrom: dateSchema,
});

export const optionInputSchema = z.object({
  name: nameSchema,
  sortOrder: z.number({ error: MSG_SORT }).int(MSG_SORT).min(0, MSG_SORT),
});

/** 検証して値を返す。違反は最初のメッセージで Error を投げる。 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? '入力内容が正しくありません');
  }
  return result.data;
}

/** 検証して最初のエラーメッセージを返す（問題なければ null）。フォーム用。 */
export function firstError(schema: ZodType, value: unknown): string | null {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? '入力内容が正しくありません');
}
