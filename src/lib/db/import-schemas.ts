import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';

// マスター取り込み（RPC gn_import_masters の payload）の検証。サーバー（Server Action）で使う。
// 端末側の読み取り（src/lib/import）でも同じ上限（名前 200 文字・その他 500 文字）で事前にエラーにしている。

export const IMPORT_ROWS_MAX = 500;

const MSG_NAME = '名前は1〜200文字で入力してください';
const MSG_TEXT = '500文字以内で入力してください';
const MSG_NUMBER = '数値は0以上で入力してください';
const MSG_ROWS = `1回に取り込めるのは種別ごとに${IMPORT_ROWS_MAX}件までです`;

const nameSchema = z.string({ error: MSG_NAME }).trim().min(1, MSG_NAME).max(200, MSG_NAME);
// 空文字は null（「変更しない」）にそろえる。
const textSchema = z
  .string({ error: MSG_TEXT })
  .trim()
  .max(500, MSG_TEXT)
  .nullable()
  .transform((v) => (v === null || v === '' ? null : v));
const numberSchema = z.number({ error: MSG_NUMBER }).min(0, MSG_NUMBER).nullable();

const rows = <T extends z.ZodType>(item: T) => z.array(item).max(IMPORT_ROWS_MAX, MSG_ROWS);

export const importPayloadSchema = z.object({
  workers: rows(z.object({ name: nameSchema, trade: textSchema, note: textSchema, daily_rate: numberSchema, overtime_rate: numberSchema })),
  suppliers: rows(z.object({ name: nameSchema, category: textSchema, contact: textSchema, note: textSchema })),
  vehicles: rows(z.object({ name: nameSchema, kind: textSchema, km_per_l: numberSchema, note: textSchema })),
  lease_items: rows(z.object({ name: nameSchema, spec: textSchema, note: textSchema, unit_price: numberSchema })),
});

export const importInputSchema = z.object({
  fileName: z.string({ error: 'ファイル名が正しくありません' }).trim().max(200, 'ファイル名は200文字以内にしてください'),
  effectiveFrom: dateSchema,
  payload: importPayloadSchema.refine(
    (p) => p.workers.length + p.suppliers.length + p.vehicles.length + p.lease_items.length > 0,
    '取り込む行がありません',
  ),
});
export type ImportInput = z.input<typeof importInputSchema>;
