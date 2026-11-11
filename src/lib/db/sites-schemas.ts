import { z } from 'zod';
import { dateSchema, newWorkerFieldsSchema } from '@/lib/db/masters-schemas';
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
  defaultDailyRate: z
    .number({ error: MSG_DAILY_RATE })
    .min(0, MSG_DAILY_RATE)
    .int('常用単価の既定は円単位の整数で入力してください')
    .nullable()
    .optional(),
  // 見積提出が必須のお客様（2026-11-20。任意）。省略時は変更しない。
  estimateRequired: z.boolean({ error: '見積提出が必須の指定が正しくありません' }).optional(),
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

// ─── 現場の協力会社（gn_site_partners）と協力会社の作業員の登録（gn_site_workers の協力会社の作業員） ───

const MSG_CONTRACT_AMOUNT = '請負金額は0以上の数値で入力してください';
/** 請負金額の上限（円）。 */
export const MAX_PARTNER_AMOUNT = 99_999_999_999;
export const MSG_PARTNER_AMOUNT_INT = '請負金額は円単位の整数で入力してください（小数は使えません）';
export const MSG_PARTNER_AMOUNT_MAX = '請負金額が大きすぎます（999億9999万9999円まで）';
const MSG_NOTE = 'メモは200文字以内で入力してください';

/** 完了・削除済みの現場で、現場の協力会社・作業員の登録を変えようとしたとき。 */
export const SITE_PARTNERS_CLOSED_MESSAGE = 'この現場は完了（または削除）されているため、協力会社と作業員の登録は変更できません';
/** 協力会社でない（社員・管理者でない）アカウントが変えようとしたとき。 */
export const SITE_PARTNERS_FORBIDDEN_MESSAGE = '協力会社と作業員の登録は社員・管理者だけが変更できます';

// 請負金額（任意。空欄は null）。メモ（任意。空欄は null）。
const contractAmountSchema = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z
    .number({ error: MSG_CONTRACT_AMOUNT })
    .min(0, MSG_CONTRACT_AMOUNT)
    .int(MSG_PARTNER_AMOUNT_INT)
    .max(MAX_PARTNER_AMOUNT, MSG_PARTNER_AMOUNT_MAX)
    .nullable(),
);

/**
 * 請負金額の入力欄の文字 → 数値（純関数）。カンマ・空白・「円」を除き、全角数字は半角にする。空欄は null、
 * 数値にできなければ NaN（検証でエラーにする）。小数・上限は contractAmountSchema で弾く。
 */
export function parseYenInput(raw: string): number | null {
  const t = raw
    .replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s　円]/g, '');
  if (t === '') return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** 請負金額の検証（画面用）。問題なければ null。 */
export function partnerAmountError(amount: number | null): string | null {
  const r = contractAmountSchema.safeParse(amount);
  return r.success ? null : (r.error.issues[0]?.message ?? MSG_CONTRACT_AMOUNT);
}
const partnerNoteSchema = z.preprocess(
  (v) => (v === undefined ? null : v),
  z
    .string({ error: MSG_NOTE })
    .trim()
    .max(200, MSG_NOTE)
    .transform((v) => (v === '' ? null : v))
    .nullable(),
);

/** 現場に協力会社を追加する（請負金額・メモは任意）。 */
export const sitePartnerAddSchema = z.object({
  siteId: idSchema,
  supplierId: z.uuid({ error: '協力会社（取引先）を選んでください' }),
  amount: contractAmountSchema,
  note: partnerNoteSchema,
});
export type SitePartnerAddInput = z.input<typeof sitePartnerAddSchema>;

/** 現場の協力会社の請負金額・メモを直す。 */
export const sitePartnerUpdateSchema = z.object({
  id: idSchema,
  amount: contractAmountSchema,
  note: partnerNoteSchema,
});
export type SitePartnerUpdateInput = z.input<typeof sitePartnerUpdateSchema>;

/** 協力会社 1 社の、この現場に登録する作業員（その会社の協力会社の作業員だけ）。 */
export const sitePartnerWorkersSchema = z.object({
  siteId: idSchema,
  supplierId: idSchema,
  workerIds: z.array(idSchema).max(500, '作業員が多すぎます'),
});

/** 別の現場から協力会社と作業員の登録を写す。 */
export const copySitePartnersSchema = z
  .object({ fromSiteId: idSchema, toSiteId: idSchema })
  .refine((v) => v.fromSiteId !== v.toSiteId, { message: '写し元と写し先が同じ現場です', path: ['fromSiteId'] });

/**
 * 別の現場から写すものを決める（純関数）。
 * - 協力会社：写し元の協力会社（請負金額・メモは写さない）と、写す作業員の会社のうち、写し先に無いもの。
 * - 作業員：写し元に登録された協力会社の作業員のうち、有効で、写し先にまだ登録されていないもの（無効な作業員は飛ばす）。
 * - isPartner を渡すと、協力会社の印の無い会社（後から印を外した会社など）とその作業員は写さない。skippedPartners は
 *   写さなかった会社の数（写し元の会社と作業員の会社。重複なし）。
 * 写し元の登録順を保つ。
 */
export function planSitePartnerCopy(
  source: { supplierIds: string[]; workers: { id: string; supplierId: string | null; active: boolean }[] },
  target: { supplierIds: string[]; workerIds: string[] },
  isPartner: (supplierId: string) => boolean = () => true,
): { supplierIds: string[]; workerIds: string[]; skippedPartners: number } {
  const skipped = new Set(
    [...source.supplierIds, ...source.workers.map((w) => w.supplierId)].filter((id): id is string => !!id && !isPartner(id)),
  );
  const haveSuppliers = new Set(target.supplierIds);
  const haveWorkers = new Set(target.workerIds);
  const workers = source.workers.filter((w) => w.active && !haveWorkers.has(w.id) && !(w.supplierId && skipped.has(w.supplierId)));
  const supplierIds: string[] = [];
  for (const id of [...source.supplierIds, ...workers.map((w) => w.supplierId)]) {
    if (id && !haveSuppliers.has(id) && !skipped.has(id)) {
      supplierIds.push(id);
      haveSuppliers.add(id);
    }
  }
  const workerIds: string[] = [];
  for (const w of workers) {
    if (!haveWorkers.has(w.id)) {
      workerIds.push(w.id);
      haveWorkers.add(w.id);
    }
  }
  return { supplierIds, workerIds, skippedPartners: skipped.size };
}

/** 写した結果の文言。 */
export function copySitePartnersMessage(counts: { partners: number; workers: number; skippedPartners?: number }): string {
  const skipped = counts.skippedPartners
    ? `（協力会社の印の無い会社 ${counts.skippedPartners} 社とその作業員は写していません）`
    : '';
  if (counts.partners === 0 && counts.workers === 0) {
    return skipped ? `写す協力会社・作業員はありませんでした${skipped}` : '写す協力会社・作業員はありませんでした（すでに登録済みです）';
  }
  return `協力会社 ${counts.partners} 社・作業員 ${counts.workers} 人を写しました${skipped}`;
}

// ─── 現場から協力会社の作業員を新しく登録する（gn_add_site_partner_worker） ───

/** 現場の協力会社のカードから、その会社の作業員を新しく登録する。名前・職種・日当・残業単価は作業員マスターと同じ規則。 */
export const sitePartnerWorkerAddSchema = newWorkerFieldsSchema.extend({
  siteId: idSchema,
  supplierId: idSchema,
});
export type SitePartnerWorkerAddInput = z.input<typeof sitePartnerWorkerAddSchema>;

/** この会社に同じ名前の有効な作業員がすでにいるとき（gn_add_site_partner_worker の duplicate_worker）。 */
export const SITE_PARTNER_DUPLICATE_WORKER_MESSAGE =
  '同じ名前の作業員が、この会社にすでにいます。一覧でチェックを付けて登録してください（別人なら名前を変えてください）';

/** gn_add_site_partner_worker のエラー → 画面の文言（純関数）。 */
export function sitePartnerWorkerRpcError(dbMessage: string | null | undefined): string {
  const m = dbMessage ?? '';
  if (m.includes('not_employee')) return SITE_PARTNERS_FORBIDDEN_MESSAGE;
  if (m.includes('site_closed')) return SITE_PARTNERS_CLOSED_MESSAGE;
  if (m.includes('not_member')) return 'この現場を見る権限がありません';
  if (m.includes('not_site_partner')) return 'この会社はこの現場の協力会社ではないか、協力会社として有効ではありません。画面を読み込み直してください';
  if (m.includes('duplicate_worker')) return SITE_PARTNER_DUPLICATE_WORKER_MESSAGE;
  if (m.includes('invalid_input')) return '名前と日当（0以上）を入力してください。残業単価は空欄か0以上にします';
  if (m.includes('gn_add_site_partner_worker')) return '作業員の登録の準備ができていません。管理者に連絡してください（データベースの更新が必要です）';
  return '作業員の登録に失敗しました。もう一度お試しください。';
}
