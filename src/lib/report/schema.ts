import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { CHANGE_KINDS, INSTRUCTION_METHODS } from '@/lib/report/change-labels';
import { jouyouHoursWarning } from '@/lib/calc/labor-cost';
import { effectiveHours } from '@/lib/calc/report';
import { isUnnamedLabor, laborDisplayName } from '@/lib/report/unnamed-workers';
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
/** 常用・請負の値。 */
export const LABOR_CONTRACTS = ['jouyou', 'ukeoi'] as const;
/** 買掛の区分（仕入・外注。2026-11-17）。 */
export const PURCHASE_KINDS = ['material', 'subcontract'] as const;
const MSG_JOUYOU_HOURS = 'うち常用の時間は0〜24の数値（時間）で入力してください';

const MSG_INSTRUCTED_ON = '指示日は YYYY-MM-DD 形式で入力してください';

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

/** 指示方法（空欄は null）。重要事項の件（src/lib/db/issue-schemas.ts）と同じ選択肢・文言。 */
export const instructionMethodSchema = z.preprocess(
  emptyToNull,
  z.enum(INSTRUCTION_METHODS, { error: '指示方法は口頭・電話・メール・書面・その他・指示なし（現場判断）から選んでください' }).nullable(),
);

// 指示日（YYYY-MM-DD の実在する日付。空欄は null）。
const instructedOnSchema = z.preprocess(
  emptyToNull,
  z.string({ error: MSG_INSTRUCTED_ON }).refine((v) => dateSchema.safeParse(v).success, MSG_INSTRUCTED_ON).nullable(),
);

const noteSchema = textSchema('備考', 200);
const unitSchema = textSchema('単位', 50);
const specSchema = textSchema('規格', 200);

const MSG_HEADCOUNT = '人数は1以上の整数で入れてください';
const MSG_UNNAMED_COMPANY = '名前なしの行は会社を選んでください';

const laborSchema = z.object({
  kind: z.literal('labor'),
  workerId: refIdSchema,
  workerName: requiredText('作業員名', 100, '作業員名を選択してください'),
  time: timeSpecSchema,
  dailyRate: numSchema('日当'),
  note: noteSchema,
  // 作業員の残業単価（円/H）の上書き。古い下書きには無い項目なので、省略時は null（標準の計算式）。
  overtimeRate: numSchema('残業単価').default(null),
  // 常用・請負（2026-11-07）。古い下書きには無い項目なので省略可（省略・空欄は常用扱い）。
  // 協力会社の作業員の行だけ意味を持ち、保存時にそれ以外の行は null にそろえる（snapshots.ts）。
  // 所属（affiliation・supplierId）は受け取らない（z.object が取り除く）。保存時にサーバーがマスターから写す。
  laborContract: z
    .preprocess(emptyToNull, z.enum(LABOR_CONTRACTS, { error: '常用・請負の区分が正しくありません' }).nullable())
    .optional(),
  // うち常用の時間（H。2026-11-17）。古い下書きには無い項目なので、省略・空欄は null（全部が請負）。
  jouyouHours: z
    .preprocess(emptyToNull, z.number({ error: MSG_JOUYOU_HOURS }).min(0, MSG_JOUYOU_HOURS).max(24, MSG_JOUYOU_HOURS).nullable())
    .default(null),
  // 人数（2026-11-19）。名前なし（会社と人数）の行だけ（src/lib/report/unnamed-workers.ts）。省略・null は名前のある行（1 人）。
  // 画面で空にしている間は 0 が来るので、ここで止める。
  headcount: z
    .preprocess(emptyToNull, z.number({ error: MSG_HEADCOUNT }).int(MSG_HEADCOUNT).min(1, MSG_HEADCOUNT).max(999, MSG_HEADCOUNT).nullable())
    .optional(),
  // 名前なしの行の会社（協力会社）。名前のある行では使わない（normalizeLine で取り除く。所属はサーバーが決める）。
  supplierId: refIdSchema.optional(),
}).superRefine((v, ctx) => {
  if (isUnnamedLabor(v) && !v.workerId && !v.supplierId) {
    ctx.addIssue({ code: 'custom', message: MSG_UNNAMED_COMPANY, path: ['supplierId'] });
  }
});

// 根拠の件（gn_report_issues.id。2026-11-17 から燃料・リース・現金・買掛にも）。古い下書きには無いので省略は null。
const lineIssueSchema = refIdSchema.default(null);

const fuelSchema = z.object({
  kind: z.literal('fuel'),
  vehicleId: refIdSchema,
  vehicleName: requiredText('車両名', 100, '車両を選ぶか、車両名を入れてください'),
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
  issueId: lineIssueSchema,
});

const leaseSchema = z.object({
  kind: z.literal('lease'),
  itemId: refIdSchema,
  itemName: requiredText('品目', 100, 'リース品を選ぶか、品目名を入れてください'),
  spec: specSchema,
  unit: unitSchema,
  qty: numSchema('数量'),
  unitPrice: numSchema('単価'),
  note: noteSchema,
  issueId: lineIssueSchema,
});

// 現金・買掛: 数量と単価の両方、または金額のみ（amountOnly）のどちらか。
// amountOnly のキーがあって空（null）なら「金額のみ入力」で金額が未入力。
function purchaseCheck(v: { qty: number | null; unitPrice: number | null; amountOnly?: number | null }, ctx: z.RefinementCtx) {
  if (v.amountOnly === null) {
    ctx.addIssue({ code: 'custom', message: '金額を入力してください', path: ['amountOnly'] });
    return;
  }
  if (v.amountOnly !== undefined) return;
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
    issueId: lineIssueSchema,
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
    // 外注（2026-11-17）も入るので、列名は「単価」「支払先」。
    unitPrice: numSchema('単価'),
    supplierId: refIdSchema,
    vendor: textSchema('支払先', 200),
    // 区分（仕入・外注）・工種（外注のときだけ使う）・根拠の件。古い下書きには無いので省略は仕入・null。
    purchaseKind: z.enum(PURCHASE_KINDS, { error: '買掛の区分は仕入・外注から選んでください' }).default('material'),
    siteTradeId: refIdSchema.default(null),
    issueId: lineIssueSchema,
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
  // 追加・増・変更・減の記録。古い下書きには無い項目なので、省略時は契約内・指示なし。
  changeKind: z.enum(CHANGE_KINDS, { error: '区分は契約内・追加・増・変更・減から選んでください' }).default('contract'),
  instructedBy: textSchema('指示者', 100),
  instructionMethod: instructionMethodSchema.default(null),
  instructedOn: instructedOnSchema.default(null),
  issueId: refIdSchema.default(null),
  // 実行予算の工種（gn_site_trades.id）。古い下書きには無い項目なので、省略時は選んでいない（null）。
  siteTradeId: refIdSchema.default(null),
});

const lineSchema = z.discriminatedUnion('kind', [laborSchema, fuelSchema, leaseSchema, cashSchema, creditSchema, workSchema], {
  error: '明細の種類が正しくありません',
});

/** 金額のみ入力 → qty=1, unitPrice=金額。amountOnly を取り除いて ReportLine にする。 */
function normalizeLine(line: z.output<typeof lineSchema>): ReportLine {
  if (line.kind === 'labor') {
    // 会社は名前なしの行だけ持つ（作業員を選んだ行・手入力の行の会社はサーバーがマスターから決める）。
    if (isUnnamedLabor(line) && !line.workerId) return line;
    const { supplierId: _supplierId, ...rest } = line;
    void _supplierId;
    return rest;
  }
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

/**
 * 保存は止めない警告。ctx があれば日付の前後も確認する。
 * siteHasTrades が false（実行予算の工種の無い現場）なら、外注の買掛の工種の警告は出さない（省略は工種のある現場として扱う）。
 * jouyouRates は会社 id → 実行予算の常用の単価（労務費の決まり src/lib/calc/labor-cost.ts）。請負の行の日当の警告に使う。
 */
export function reportWarnings(
  input: SaveInput,
  ctx?: { siteStartDate: string | null; today: string; siteHasTrades?: boolean; jouyouRates?: Readonly<Record<string, number>> },
): string[] {
  const w: string[] = [];
  if (ctx) {
    if (ctx.siteStartDate && input.date < ctx.siteStartDate) w.push('日付が着工予定日より前です');
    if (input.date > ctx.today) w.push('日付が今日より後です');
  }
  if (isBefore(input.common.start, input.common.end)) w.push('共通時間：終了が開始より前です');

  let laborCount = 0;
  for (const line of input.lines) {
    // 未選択の行は検証エラーで知らせるので、ここでは選択済みの行だけ見る。
    if (line.kind === 'labor') {
      laborCount++;
      const name = line.workerName ? laborDisplayName(line) : `${laborCount}行目`;
      if (isBefore(line.time.start, line.time.end)) w.push(`作業員「${name}」：終了が開始より前です`);
      if (line.laborContract === 'ukeoi') {
        // 請負の行は原価 0 が決まり（2026-11-11 利用者）。うち常用の時間があるのに単価（日当・実行予算の常用の単価）が無いときだけ知らせる
        const hasJouyou = line.jouyouHours != null && line.jouyouHours > 0;
        const budgetRate = line.supplierId ? ctx?.jouyouRates?.[line.supplierId] : undefined;
        if (line.workerName && hasJouyou && line.dailyRate === null && budgetRate === undefined) {
          w.push(`作業員「${name}」：うち常用の時間がありますが、常用の単価（日当）が未設定です`);
        }
        // うち常用の時間が実働を超える（請負の行だけ。2026-11-17。全部を常用として数える）
        const jw = jouyouHoursWarning(name, line.jouyouHours, effectiveHours(line.time, input.common));
        if (jw) w.push(jw);
      } else if (line.workerName && line.dailyRate === null) {
        w.push(`作業員「${name}」：日当が未設定です（労務費が0円になります）`);
      }
    } else if (line.kind === 'fuel') {
      if (line.vehicleName && !line.kmPerL) w.push(`車両「${line.vehicleName}」：燃費が未設定です（燃料費が0円になります）`);
    } else if (line.kind === 'lease') {
      if (line.itemName && line.unitPrice === null) w.push(`リース「${line.itemName}」：単価が未設定です（リース費が0円になります）`);
    } else if (line.kind === 'credit') {
      if (line.purchaseKind === 'subcontract' && !line.siteTradeId && ctx?.siteHasTrades !== false) {
        w.push(`外注「${line.itemName || '品目なし'}」：工種が選ばれていません（予算と実績で予算外に入ります）`);
      }
    }
  }
  if (laborCount === 0) w.push('作業員が0人です（休工日の場合はこのまま保存できます）');
  return w;
}
