import { z } from 'zod';
import { ISSUE_KINDS } from '@/lib/report/change-labels';
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
