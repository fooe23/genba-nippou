import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import type { CashLine, CreditLine, LineKind, ReportLine, TimeSpec } from '@/lib/types';

// 日報の入力検証（保存を止めるエラー）と警告（保存は止めない注意）。
// サーバー（saveReport）とクライアント（ReportForm）の両方で使う。

/** 現金・買掛は「金額のみ入力」を選べる。検証後は qty=1, unitPrice=金額 に正規化され、amountOnly は消える。 */
export type CashLineInput = CashLine & { amountOnly?: number | null };
export type CreditLineInput = CreditLine & { amountOnly?: number | null };
export type ReportLineInput = Exclude<ReportLine, CashLine | CreditLine> | CashLineInput | CreditLineInput;

/** saveReport（reports-actions.ts）の入力。 */
export interface SaveInput {
  siteId: string;
  date: string;
  weather: string | null;
  supervisor: string | null;
  common: TimeSpec;
  issuesText: string;
  notesText: string;
  lines: ReportLineInput[];
}

export const KIND_LABEL: Record<LineKind, string> = {
  labor: '作業員',
  fuel: '車両',
  lease: 'リース',
  cash: '現金',
  credit: '買掛',
  work: '作業内容',
};

const MSG_TIME = '時刻は HH:MM 形式で入力してください';
const MSG_MIN = '休憩・中抜は0以上の整数（分）で入力してください';
const MSG_ID = 'IDの形式が正しくありません';

// 空文字は null として扱う（未入力）。
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
// null / undefined は空文字として扱う（任意の文字列項目）。
const nullToEmpty = (v: unknown) => (v === null || v === undefined ? '' : v);

const timeSchema = z.preprocess(
  emptyToNull,
  z.string({ error: MSG_TIME }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, MSG_TIME).nullable(),
);
const minutesSchema = z.preprocess(
  emptyToNull,
  z.number({ error: MSG_MIN }).int(MSG_MIN).min(0, MSG_MIN).nullable(),
);
function numSchema(label: string) {
  const msg = `${label}は0以上の数値で入力してください`;
  return z.preprocess(emptyToNull, z.number({ error: msg }).min(0, msg).nullable());
}
// DB の uuid 列は 8-4-4-4-12 の16進ならよい（バージョン・バリアントは問わない）。
const refIdSchema = z.preprocess(emptyToNull, z.guid({ error: MSG_ID }).nullable());
function textSchema(label: string, max: number) {
  return z.preprocess(
    nullToEmpty,
    z.string({ error: `${label}は文字で入力してください` }).trim().max(max, `${label}は${max}文字以内で入力してください`),
  );
}
function requiredText(label: string, max: number, emptyMessage: string) {
  return z.preprocess(
    nullToEmpty,
    z
      .string({ error: emptyMessage })
      .trim()
      .min(1, emptyMessage)
      .max(max, `${label}は${max}文字以内で入力してください`),
  );
}
const optionalNameSchema = z.preprocess(
  emptyToNull,
  z.string({ error: '文字で入力してください' }).trim().max(100, '天候・作業責任者は100文字以内で入力してください').nullable(),
);

export const timeSpecSchema = z.object({
  start: timeSchema,
  end: timeSchema,
  breakMin: minutesSchema,
  gapMin: minutesSchema,
});

const noteSchema = textSchema('備考', 200);
const unitSchema = textSchema('単位', 50);
const specSchema = textSchema('規格', 200);

const laborSchema = z.object({
  kind: z.literal('labor'),
  workerId: refIdSchema,
  workerName: requiredText('作業員名', 100, '作業員名を選択してください'),
  time: timeSpecSchema,
  dailyRate: numSchema('日当'),
  note: noteSchema,
});

const fuelSchema = z.object({
  kind: z.literal('fuel'),
  vehicleId: refIdSchema,
  vehicleName: requiredText('車両名', 100, '車両を選択してください'),
  kmPerL: numSchema('燃費'),
  distanceKm: z.preprocess(
    emptyToNull,
    z.number({ error: '走行距離を入力してください' }).min(0, '走行距離は0以上の数値で入力してください'),
  ),
  pricePerL: z.preprocess(
    emptyToNull,
    z.number({ error: '燃料単価を入力してください' }).min(0, '燃料単価は0以上の数値で入力してください'),
  ),
  note: noteSchema,
});

const leaseSchema = z.object({
  kind: z.literal('lease'),
  itemId: refIdSchema,
  itemName: requiredText('品目', 100, 'リース品を選択してください'),
  spec: specSchema,
  unit: unitSchema,
  qty: numSchema('数量'),
  unitPrice: numSchema('単価'),
  note: noteSchema,
});

// 現金・買掛: 数量と単価の両方、または金額のみ（amountOnly）のどちらか。
function purchaseCheck(v: { qty: number | null; unitPrice: number | null; amountOnly?: number | null }, ctx: z.RefinementCtx) {
  if (v.amountOnly !== null && v.amountOnly !== undefined) return;
  if (v.qty === null) ctx.addIssue({ code: 'custom', message: '数量を入力してください（または「金額のみ入力」）', path: ['qty'] });
  if (v.unitPrice === null) ctx.addIssue({ code: 'custom', message: '単価を入力してください（または「金額のみ入力」）', path: ['unitPrice'] });
}

const cashSchema = z
  .object({
    kind: z.literal('cash'),
    itemName: requiredText('品目', 100, '品目を入力してください'),
    spec: specSchema,
    unit: unitSchema,
    qty: numSchema('数量'),
    unitPrice: numSchema('購入単価'),
    vendor: textSchema('購入先', 200),
    amountOnly: numSchema('金額').optional(),
  })
  .superRefine(purchaseCheck);

const creditSchema = z
  .object({
    kind: z.literal('credit'),
    itemName: requiredText('品目', 100, '品目を入力してください'),
    spec: specSchema,
    unit: unitSchema,
    qty: numSchema('数量'),
    unitPrice: numSchema('仕入単価'),
    supplierId: refIdSchema,
    vendor: textSchema('仕入先', 200),
    amountOnly: numSchema('金額').optional(),
  })
  .superRefine(purchaseCheck);

const workSchema = z.object({
  kind: z.literal('work'),
  estimateItemId: refIdSchema,
  trade: textSchema('工種', 200),
  description: requiredText('施工内容', 200, '施工内容を入力してください'),
  qty: numSchema('施工数量'),
  unit: unitSchema,
  manDays: numSchema('投入人工'),
  unitPrice: numSchema('施工単価'),
  source: z.enum(['estimate', 'extra'], { error: '作業内容の区分が正しくありません' }),
});

const lineSchema = z.discriminatedUnion('kind', [laborSchema, fuelSchema, leaseSchema, cashSchema, creditSchema, workSchema], {
  error: '明細の種類が正しくありません',
});

/** 金額のみ入力 → qty=1, unitPrice=金額。amountOnly を取り除いて ReportLine にする。 */
function normalizeLine(line: z.output<typeof lineSchema>): ReportLine {
  if (line.kind !== 'cash' && line.kind !== 'credit') return line;
  const { amountOnly, ...rest } = line;
  if (amountOnly === null || amountOnly === undefined) return rest;
  return { ...rest, qty: 1, unitPrice: amountOnly };
}

export const reportInputSchema: z.ZodType<SaveInput> = z
  .object({
    siteId: z.guid({ error: '現場の指定が正しくありません' }),
    date: dateSchema,
    weather: optionalNameSchema,
    supervisor: optionalNameSchema,
    common: timeSpecSchema,
    issuesText: textSchema('重要事項', 2000),
    notesText: textSchema('連絡事項', 2000),
    lines: z.array(lineSchema, { error: '明細の形式が正しくありません' }).max(500, '明細が多すぎます（500行まで）'),
  })
  .transform((v) => ({ ...v, lines: v.lines.map(normalizeLine) }));

// "lines.3.qty" のような位置を「現金の2行目：」のような見出しにする。
function issuePrefix(input: unknown, path: PropertyKey[]): string {
  if (path[0] === 'common') return '共通時間：';
  if (path[0] !== 'lines' || typeof path[1] !== 'number') return '';
  const lines = (input as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return '';
  const index = path[1];
  const kind = (lines[index] as { kind?: unknown } | undefined)?.kind;
  if (typeof kind !== 'string' || !(kind in KIND_LABEL)) return `明細${index + 1}行目：`;
  const n = lines.slice(0, index + 1).filter((l) => (l as { kind?: unknown } | null)?.kind === kind).length;
  return `${KIND_LABEL[kind as LineKind]}の${n}行目：`;
}

export function validateReport(input: unknown): { ok: true; value: SaveInput } | { ok: false; errors: string[] } {
  const result = reportInputSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const errors = result.error.issues.map((i) => `${issuePrefix(input, i.path)}${i.message}`);
  return { ok: false, errors: errors.length > 0 ? errors : ['入力内容が正しくありません'] };
}

function isBefore(start: string | null, end: string | null): boolean {
  return start !== null && end !== null && start !== '' && end !== '' && end < start;
}

/** 保存は止めない警告。ctx があれば日付の前後も確認する。 */
export function reportWarnings(input: SaveInput, ctx?: { siteStartDate: string | null; today: string }): string[] {
  const w: string[] = [];
  if (ctx) {
    if (ctx.siteStartDate && input.date < ctx.siteStartDate) w.push('日付が着工予定日より前です');
    if (input.date > ctx.today) w.push('日付が今日より後です');
  }
  if (isBefore(input.common.start, input.common.end)) w.push('共通時間：終了が開始より前です');

  let laborCount = 0;
  for (const line of input.lines) {
    if (line.kind === 'labor') {
      laborCount++;
      const name = line.workerName || `${laborCount}行目`;
      if (isBefore(line.time.start, line.time.end)) w.push(`作業員「${name}」：終了が開始より前です`);
      if (line.dailyRate === null) w.push(`作業員「${name}」：日当が未設定です（労務費が0円になります）`);
    } else if (line.kind === 'fuel') {
      if (!line.kmPerL) w.push(`車両「${line.vehicleName || '未選択'}」：燃費が未設定です（燃料費が0円になります）`);
    }
  }
  if (laborCount === 0) w.push('作業員が0人です（休工日の場合はこのまま保存できます）');
  return w;
}
