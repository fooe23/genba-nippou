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
const MSG_OVERTIME = '残業単価は0以上の数値で入力してください';

const idSchema = z.uuid({ error: 'IDの形式が正しくありません' });
/** 作業員の ID（削除など）。 */
export const workerIdSchema = idSchema;
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

/** 所属の値（自社・協力会社）。 */
export const AFFILIATIONS = ['own', 'partner'] as const;
export const MSG_PARTNER_SUPPLIER = '協力会社の作業員は、所属する協力会社を選んでください';

// 所属：省略（undefined）なら変更しない。協力会社（partner）のときは取引先が必須。自社のとき取引先は保存しない（null）。
const affiliationFields = {
  affiliation: z.enum(AFFILIATIONS, { error: '所属は自社か協力会社から選んでください' }).optional(),
  supplierId: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), idSchema.nullable()).optional(),
};
function partnerNeedsSupplier(v: { affiliation?: 'own' | 'partner'; supplierId?: string | null }, ctx: z.RefinementCtx) {
  if (v.affiliation === 'partner' && !v.supplierId) {
    ctx.addIssue({ code: 'custom', message: MSG_PARTNER_SUPPLIER, path: ['supplierId'] });
  }
}

/**
 * 作業員の所属が変わるか（純関数）。自社→協力会社、協力会社→自社、協力会社の会社が変わるとき true。
 * そのときは前の所属で現場に登録・選択した分を外す（upsertWorker）。所属を省略（undefined）した保存は変えないので false。
 */
export function partnerCompanyChanged(
  before: { affiliation: string | null; supplier_id: string | null },
  next: { affiliation?: 'own' | 'partner'; supplierId?: string | null },
): boolean {
  if (next.affiliation === undefined) return false;
  if (before.affiliation !== 'partner') return next.affiliation === 'partner';
  return next.affiliation !== 'partner' || (next.supplierId ?? null) !== (before.supplier_id ?? null);
}

const workerBaseSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  trade: textSchema.optional(),
  note: textSchema.optional(),
  // 残業単価（円/H）。空欄（空文字・null）は null ＝ 標準の計算式。省略（undefined）なら変更しない。
  overtimeRate: z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.number({ error: MSG_OVERTIME }).min(0, MSG_OVERTIME).nullable())
    .optional(),
  active: z.boolean().optional(),
  ...affiliationFields,
});
export const workerInputSchema = workerBaseSchema.superRefine(partnerNeedsSupplier);
export type WorkerInput = z.input<typeof workerInputSchema>;

export const MSG_SUPPLIER_ROLE = '取引先か協力会社の、どちらかに印を付けてください';

// 取引先（isVendor）・協力会社（isPartner）の印。省略（undefined）なら変更しない。両方を送ってどちらも false はエラー
// （片方だけ送ったときは DB の制約 gn_suppliers_role_check が最後に止める）。
export const supplierInputSchema = z
  .object({
    id: idSchema.optional(),
    name: nameSchema,
    category: textSchema.optional(),
    contact: textSchema.optional(),
    note: textSchema.optional(),
    active: z.boolean().optional(),
    isVendor: z.boolean().optional(),
    isPartner: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.isVendor === false && v.isPartner === false) {
      ctx.addIssue({ code: 'custom', message: MSG_SUPPLIER_ROLE, path: ['isVendor'] });
    }
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

export const workerWithRateSchema = workerBaseSchema
  .pick({ name: true, trade: true, note: true, overtimeRate: true, affiliation: true, supplierId: true })
  .extend({ amount: amountSchema, effectiveFrom: dateSchema })
  .superRefine(partnerNeedsSupplier);
export type WorkerWithRateInput = z.input<typeof workerWithRateSchema>;

/**
 * 作業員の新規登録の項目（名前・職種・残業単価・日当）。管理者の新規登録（workerWithRateSchema）と同じ規則。
 * 現場の「協力会社と作業員」からの登録（sites-schemas の sitePartnerWorkerAddSchema）で使う。
 */
export const newWorkerFieldsSchema = workerBaseSchema
  .pick({ name: true, trade: true, overtimeRate: true })
  .extend({ amount: amountSchema });

export const leaseItemWithRateSchema = leaseItemInputSchema
  .pick({ name: true, spec: true, note: true })
  .extend({ amount: amountSchema, effectiveFrom: dateSchema });
export type LeaseItemWithRateInput = z.input<typeof leaseItemWithRateSchema>;

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

/** 作業員を削除できないとき（日報の作業員の行か繰越の初期値で使っている）の文言。 */
export const WORKER_IN_USE_MESSAGE = '日報や繰越で使っているため削除できません。無効にしてください';

/**
 * 作業員の削除の可否（純関数。DB の gn_delete_worker と同じ条件）。日報の作業員の行（gn_report_lines.ref_id、kind = 'labor'）と
 * 繰越の初期値（gn_carryovers）のどちらにも使われていなければ削除できる（null）。使っていれば文言を返す。
 * 現場の選択（gn_site_workers）は使用に数えない（削除のときに一緒に外す）。
 */
export function workerDeleteError(usage: { reportLines: number; carryovers: number }): string | null {
  return usage.reportLines > 0 || usage.carryovers > 0 ? WORKER_IN_USE_MESSAGE : null;
}
