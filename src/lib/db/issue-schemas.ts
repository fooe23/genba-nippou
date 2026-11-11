import { z } from 'zod';
import { dateSchema } from '@/lib/db/masters-schemas';
import { ISSUE_KINDS, ISSUE_STATUSES, NEW_ISSUE_STATUSES, SETTLEMENT_METHODS } from '@/lib/report/change-labels';
import type { IssueStatus } from '@/lib/types';
import { instructionMethodSchema } from '@/lib/report/schema';
import { ESTIMATE_REQUIREMENTS } from '@/lib/report/estimate-requirement';

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

// 件の状態（見積中・対応中・完了）。setIssueStatus と addIssue（追加のときの状態）で使う。

export const issueStatusSchema = z.enum(ISSUE_STATUSES, { error: '件の状態が正しくありません' });
/** 件を追加するときの状態（見積中か対応中。省略は対応中）。 */
export const newIssueStatusSchema = z
  .enum(NEW_ISSUE_STATUSES, { error: '件の状態は見積中か対応中から選んでください' })
  .default('open');
export type NewIssueStatus = z.output<typeof newIssueStatusSchema>;
/** 件を追加するときの見積書（2026-11-20。省略は現場の既定と種別。社員・管理者だけが使う）。 */
export const newIssueEstimateSchema = z
  .enum(ESTIMATE_REQUIREMENTS, { error: '見積書の指定が正しくありません' })
  .optional();

export type IssueStatusPatch = { status: IssueStatus; done_at: string | null };

/**
 * 件の状態を変えるときに書く列。完了は完了日（doneAt。省略は today）を入れ、見積中・対応中は完了日を消す（doneAt は使わない）。
 * 状態・完了日の形が正しくなければ日本語の文言を返す。
 */
export function issueStatusPatch(
  status: unknown,
  doneAt: unknown,
  today: string,
): { ok: true; patch: IssueStatusPatch } | { ok: false; error: string } {
  const s = issueStatusSchema.safeParse(status);
  if (!s.success) return { ok: false, error: s.error.issues[0].message };
  if (s.data !== 'done') return { ok: true, patch: { status: s.data, done_at: null } };
  if (doneAt === undefined || doneAt === null) return { ok: true, patch: { status: 'done', done_at: today } };
  const d = dateSchema.safeParse(doneAt);
  if (!d.success) return { ok: false, error: '完了日の指定が正しくありません' };
  return { ok: true, patch: { status: 'done', done_at: d.data } };
}

// 日報の修正申請の理由（requestReportFix）。DB の check（前後の空白を除いて 1〜500 文字）と同じ。
export const fixRequestReasonSchema = z
  .string({ error: '修正の理由を入力してください' })
  .trim()
  .min(1, '修正の理由を入力してください')
  .max(500, '理由は500文字以内で入力してください');
