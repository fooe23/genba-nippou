import { z } from 'zod';

// 全社の設定（労務の計算設定・共通時間の既定・件の精算の率・自社の名前）の入力検証。サーバー（Server Action）とクライアント（フォーム）の両方で使う。

const MSG_TIME = '時刻は HH:MM 形式で入力してください';
const MSG_MIN = '休憩・中抜は0〜600の整数（分）で入力してください';

// 空文字は null として扱う（未入力）。
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

function rangeSchema(label: string, min: number, max: number) {
  const msg = `${label}は${min}〜${max}の数値で入力してください`;
  return z.number({ error: msg }).min(min, msg).max(max, msg);
}

/** 共通時間の時刻（HH:MM）。空欄は null。 */
export const optionalTimeSchema = z.preprocess(
  emptyToNull,
  z.string({ error: MSG_TIME }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, MSG_TIME).nullable(),
);

/** 共通時間の休憩・中抜（分）。0〜600 の整数、空欄は null。 */
export const optionalMinutesSchema = z.preprocess(
  emptyToNull,
  z.number({ error: MSG_MIN }).int(MSG_MIN).min(0, MSG_MIN).max(600, MSG_MIN).nullable(),
);

/** 任意の文字列（前後の空白を除く。空欄は null）。 */
function optionalTextSchema(label: string, max: number) {
  return z.preprocess(
    emptyToNull,
    z.string({ error: `${label}は文字で入力してください` }).trim().max(max, `${label}は${max}文字以内で入力してください`).nullable(),
  );
}

export const settingsInputSchema = z.object({
  shoteiHours: rangeSchema('1人工の基準時間（所定）', 0.5, 24),
  fixedOvertimeLimit: rangeSchema('固定残業の上限時間', 0, 24),
  overtimeMultiplier: rangeSchema('残業の割増率', 0, 5),
  overtimeBaseHours: rangeSchema('残業単価の基準時間', 0.5, 24),
  defaultCommonStart: optionalTimeSchema,
  defaultCommonEnd: optionalTimeSchema,
  defaultCommonBreakMin: optionalMinutesSchema,
  defaultCommonGapMin: optionalMinutesSchema,
  // 件の精算の率（%。15.1 = 15.1%。DB の列と同じ単位）と自社の名前・連絡先。省略時は変更しない。
  legalWelfarePct: rangeSchema('法定福利費率', 0, 100).optional(),
  materialExpensePct: rangeSchema('材料経費率', 0, 100).optional(),
  leaseFuelExpensePct: rangeSchema('リース・燃料の経費率', 0, 100).optional(),
  overheadProfitPct: rangeSchema('諸経費率', 0, 100).optional(),
  companyName: optionalTextSchema('会社名', 100).optional(),
  companyContact: optionalTextSchema('会社の連絡先', 200).optional(),
  // 予算の標準日当（実行予算の自社の労務の単価の初期値）。省略時は変更しない。
  budgetDailyRate: rangeSchema('予算の標準日当', 0, 1_000_000).optional(),
});
export type SettingsInput = z.input<typeof settingsInputSchema>;
