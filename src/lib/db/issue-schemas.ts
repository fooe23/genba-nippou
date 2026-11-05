import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { ISSUE_KINDS, SETTLEMENT_METHODS } from '@/lib/report/change-labels';
import { instructionMethodSchema } from '@/lib/report/schema';

// 重要事項の件の種別・指示者・指示方法・金額見込み（addIssue の追加の項目）の入力検証。
// サーバー（Server Action）とクライアント（フォーム）の両方で使う。どれも省略でき、省略時は「その他」・指示なし。

const MSG_AMOUNT = '金額見込みは0以上の数値で入力してください';

// 空文字（空白だけを含む）は null として扱う（未入力）。
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const issueExtraSchema = z.object({
  kind: z.enum(ISSUE_KINDS, { error: '件の種別が正しくありません' }).default('other'),
  instructedBy: z
    .preprocess(
      emptyToNull,
      z.string({ error: '指示者は文字で入力してください' }).trim().max(100, '指示者は100文字以内で入力してください').nullable(),
    )
    .default(null),
  instructionMethod: instructionMethodSchema.default(null),
  amountEstimate: z.preprocess(emptyToNull, z.number({ error: MSG_AMOUNT }).min(0, MSG_AMOUNT).nullable()).default(null),
});
export type IssueExtraInput = z.input<typeof issueExtraSchema>;

// 件の精算の項目（精算の方法・確定額・常用単価・確定日）の入力検証。updateIssueSettlement とフォームの両方で使う。
// 確定額・常用単価は円単位の整数。一式・見積は確定額（見積額）、常用は常用単価が必須。使わない方の金額は保存のときに null にする（アクション側）。

const MSG_FIXED_AMOUNT = '確定額は0以上の数値で入力してください';
const MSG_DAILY_RATE = '常用単価は0以上の数値で入力してください';
const MSG_FIXED_AMOUNT_INT = '確定額は円単位の整数で入力してください';
const MSG_DAILY_RATE_INT = '常用単価は円単位の整数で入力してください';

export const issueSettlementSchema = z
  .object({
    settlementMethod: z.enum(SETTLEMENT_METHODS, { error: '精算の方法が正しくありません' }).default('undecided'),
    fixedAmount: z
      .preprocess(emptyToNull, z.number({ error: MSG_FIXED_AMOUNT }).min(0, MSG_FIXED_AMOUNT).int(MSG_FIXED_AMOUNT_INT).nullable())
      .default(null),
    dailyRate: z.preprocess(emptyToNull, z.number({ error: MSG_DAILY_RATE }).min(0, MSG_DAILY_RATE).int(MSG_DAILY_RATE_INT).nullable()).default(null),
    fixedOn: z.preprocess(emptyToNull, dateSchema.nullable()).default(null),
  })
  .superRefine((v, ctx) => {
    if (v.settlementMethod === 'lump_sum' && v.fixedAmount === null) {
      ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: '一式のときは確定額を入力してください' });
    }
    if (v.settlementMethod === 'estimate' && v.fixedAmount === null) {
      ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: '見積のときは見積額を入力してください' });
    }
    if (v.settlementMethod === 'daily_rate' && v.dailyRate === null) {
      ctx.addIssue({ code: 'custom', path: ['dailyRate'], message: '常用のときは常用単価を入力してください' });
    }
  });
export type IssueSettlementInput = z.input<typeof issueSettlementSchema>;
export type IssueSettlementParsed = z.output<typeof issueSettlementSchema>;
