import { z } from 'zod';
import {
  BUDGET_ITEMS,
  BUDGET_PERFORMERS,
  CONTRACT_CATEGORIES,
  CONTRACT_SECTIONS,
  PARTNER_ITEMS,
  SITE_WIDE_ITEMS,
  type BudgetItem,
  type BudgetPerformer,
} from '@/lib/budget/types';

// 積算連携の入力検証（純関数。サーバーの Server Actions と画面・取り込みの両方で使う）。
// DB 側にも同じ制約がある（update_2026-11-15_budget.sql）：工種名 1〜50 文字・現場内で一意、予算の行の組み合わせ
// （gn_budget_lines_combo_ck）、金額＝round(数量 × 単価)（トリガー）、進み具合 0〜100（gn_trade_progress_percent_check）。

export const TRADE_NAME_MAX = 50;
export const MAX_TRADES = 200;
export const MAX_BUDGET_LINES = 1000;
export const MAX_CONTRACT_ITEMS = 2000;

/**
 * 数量 × 単価の金額を 1 円単位で四捨五入する（0.5 は 0 から遠い方へ。DB の round(numeric) と同じ）。
 * 浮動小数の誤差（1.005 × 1000 = 1004.9999… など）は小数 6 桁で落としてから丸める。
 */
export function roundYen(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const cleaned = Number(v.toFixed(6));
  const r = Math.sign(cleaned) * Math.round(Math.abs(cleaned));
  return r === 0 ? 0 : r; // -0 を 0 に
}

/** 金額＝round(数量 × 単価)。 */
export function lineAmount(qty: number, unitPrice: number): number {
  return roundYen(qty * unitPrice);
}

const MSG_ID = 'IDの形式が正しくありません';
const idSchema = z.guid({ error: MSG_ID });
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const nullToEmpty = (v: unknown) => (v === null || v === undefined ? '' : v);
const optionalIdSchema = z.preprocess(emptyToNull, idSchema.nullable());

function textSchema(label: string, max: number) {
  return z.preprocess(
    nullToEmpty,
    z.string({ error: `${label}は文字で入力してください` }).trim().max(max, `${label}は${max}文字以内で入力してください`),
  );
}
function requiredTextSchema(label: string, max: number) {
  return z
    .string({ error: `${label}を入力してください` })
    .trim()
    .min(1, `${label}を入力してください`)
    .max(max, `${label}は${max}文字以内で入力してください`);
}
/**
 * 数量・単価の小数は 3 桁まで。画面の金額（lineAmount の浮動小数）と DB の round(numeric) が、
 * 小数の桁が多いときに 1 円ずれるのを防ぐ（DB には桁の制約を置かず、アプリの検証で止める）。
 */
export const QTY_PRICE_DECIMALS = 3;
/** 小数が QTY_PRICE_DECIMALS 桁以内か。 */
export function hasAtMostDecimals(v: number, digits = QTY_PRICE_DECIMALS): boolean {
  if (!Number.isFinite(v)) return false;
  const scaled = v * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) < 1e-7 + 1e-12 * Math.abs(scaled); // 浮動小数の誤差だけ許す
}
function decimalsMessage(label: string): string {
  return `${label}の小数は${QTY_PRICE_DECIMALS}桁までにしてください`;
}
/** 有限の数（負も可。小数は 3 桁まで）。 */
function finiteSchema(label: string) {
  const msg = `${label}は数値で入力してください`;
  return z
    .number({ error: msg })
    .refine((v) => Number.isFinite(v), msg)
    .refine((v) => hasAtMostDecimals(v), decimalsMessage(label));
}
/** 0 以上の有限の数（小数は 3 桁まで）。 */
function nonNegativeSchema(label: string) {
  const msg = `${label}は0以上の数値で入力してください`;
  return z
    .number({ error: msg })
    .min(0, msg)
    .refine((v) => Number.isFinite(v), msg)
    .refine((v) => hasAtMostDecimals(v), decimalsMessage(label));
}

// ─── 工種 ───

/** 工種の名前に使えない名前（Excel の雛形で「現場全体」「経費」「減分」の印に使う）。 */
export const RESERVED_TRADE_NAMES: readonly string[] = ['経費', '減分', '（現場全体）', '現場全体'];
/** 使えない名前なら文言（比べるときは全角・半角と空白の違いを無視する）。 */
export function reservedTradeNameError(name: string): string | null {
  const key = name.normalize('NFKC').replace(/\s+/g, '');
  const hit = RESERVED_TRADE_NAMES.find((r) => r.normalize('NFKC').replace(/\s+/g, '') === key);
  return hit ? `「${hit}」は工種の名前に使えません（Excel の雛形で経費・減分・現場全体の印に使うため）` : null;
}

export const tradeNameSchema = requiredTextSchema('工種名', TRADE_NAME_MAX).superRefine((v, ctx) => {
  const err = reservedTradeNameError(v);
  if (err) ctx.addIssue({ code: 'custom', message: err });
});

/** 工種の一覧の 1 行（id が null なら新しい工種）。 */
export const tradeInputSchema = z.object({
  id: optionalIdSchema.default(null),
  name: tradeNameSchema,
});
export type TradeInput = z.input<typeof tradeInputSchema>;
export type TradeValue = z.output<typeof tradeInputSchema>;

/** 工種の一覧（現場の全部・並びの順）。名前・id の重複は不可。 */
export const tradesInputSchema = z
  .array(tradeInputSchema, { error: '工種の形式が正しくありません' })
  .max(MAX_TRADES, `工種が多すぎます（${MAX_TRADES}件まで）`)
  .superRefine((list, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    list.forEach((t, i) => {
      if (names.has(t.name)) ctx.addIssue({ code: 'custom', path: [i, 'name'], message: `工種「${t.name}」が重複しています` });
      names.add(t.name);
      if (t.id !== null) {
        if (ids.has(t.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: '同じ工種が 2 回入っています' });
        ids.add(t.id);
      }
    });
  });

// ─── 元請けの内訳 ───

export const contractItemInputSchema = z
  .object({
    section: z.enum(CONTRACT_SECTIONS, { error: '区分は当初か変更を選んでください' }).default('initial'),
    name: requiredTextSchema('名称', 200),
    spec: textSchema('規格', 200),
    qty: finiteSchema('数量'),
    unit: textSchema('単位', 20),
    unitPrice: finiteSchema('単価'),
    tradeId: optionalIdSchema.default(null),
    category: z.enum(CONTRACT_CATEGORIES, { error: '識別は工種・経費・減分から選んでください' }).default('trade'),
  })
  .superRefine((v, ctx) => {
    if (v.category !== 'trade' && v.tradeId !== null) {
      ctx.addIssue({ code: 'custom', path: ['tradeId'], message: '経費・減分の行には工種を付けません' });
    }
  })
  .transform((v) => ({ ...v, amount: lineAmount(v.qty, v.unitPrice) }));
export type ContractItemInput = z.input<typeof contractItemInputSchema>;
export type ContractItemValue = z.output<typeof contractItemInputSchema>;

export const contractItemsInputSchema = z
  .array(contractItemInputSchema, { error: '元請けの内訳の形式が正しくありません' })
  .max(MAX_CONTRACT_ITEMS, `元請けの内訳が多すぎます（${MAX_CONTRACT_ITEMS}行まで）`);

export const CONTRACT_MODES = ['replace', 'appendChange'] as const;
export type ContractMode = (typeof CONTRACT_MODES)[number];
export const contractModeSchema = z.enum(CONTRACT_MODES, { error: '取り込み方は「全部入れ替える」か「変更の行として足す」を選んでください' });

// ─── 実行予算 ───

/** 項目と施工者・会社・工種の組み合わせの誤り（正しければ null）。DB の gn_budget_lines_combo_ck と同じ。 */
export function budgetComboError(v: {
  item: BudgetItem;
  performer: BudgetPerformer;
  supplierId: string | null;
  tradeId: string | null;
}): string | null {
  if (SITE_WIDE_ITEMS.includes(v.item)) {
    if (v.tradeId !== null) return '材料・リース・その他は工種に分けず、現場全体に入れてください';
    if (v.performer !== 'own' || v.supplierId !== null) return '材料・リース・その他には施工者の会社を入れません';
    return null;
  }
  if (v.item === 'labor') {
    if (v.performer !== 'own' || v.supplierId !== null) return '労務は自社の行です（協力会社は請負か常用にしてください）';
    return null;
  }
  if (PARTNER_ITEMS.includes(v.item)) {
    if (v.performer !== 'partner' || v.supplierId === null) return '請負・常用は施工者の協力会社を選んでください';
    return null;
  }
  return '項目が正しくありません';
}

export const budgetLineInputSchema = z
  .object({
    tradeId: optionalIdSchema.default(null),
    performer: z.enum(BUDGET_PERFORMERS, { error: '施工者は自社か協力会社を選んでください' }),
    supplierId: optionalIdSchema.default(null),
    item: z.enum(BUDGET_ITEMS, { error: '項目は労務・請負・常用・材料・リース・その他から選んでください' }),
    note: textSchema('内容', 200),
    qty: nonNegativeSchema('数量'),
    unit: textSchema('単位', 20),
    unitPrice: nonNegativeSchema('単価'),
  })
  .superRefine((v, ctx) => {
    const err = budgetComboError(v);
    if (err) ctx.addIssue({ code: 'custom', path: ['item'], message: err });
  })
  .transform((v) => ({ ...v, amount: lineAmount(v.qty, v.unitPrice) }));
export type BudgetLineInput = z.input<typeof budgetLineInputSchema>;
export type BudgetLineValue = z.output<typeof budgetLineInputSchema>;

export const budgetLinesInputSchema = z
  .array(budgetLineInputSchema, { error: '実行予算の形式が正しくありません' })
  .max(MAX_BUDGET_LINES, `実行予算が多すぎます（${MAX_BUDGET_LINES}行まで）`);

// ─── 読み替え表・進み具合 ───

export const tradeAliasInputSchema = z.object({
  tradeText: requiredTextSchema('日報の工種', 200),
  tradeId: optionalIdSchema,
});

const MSG_PERCENT = '進み具合は 0〜100 の数値（%）で入力してください';
/** 進み具合の上書き（%）。null は上書きを消す。 */
export const progressPercentSchema = z
  .number({ error: MSG_PERCENT })
  .min(0, MSG_PERCENT)
  .max(100, MSG_PERCENT)
  .refine((v) => Number.isFinite(v), MSG_PERCENT)
  .nullable();

export const siteIdSchema = z.guid({ error: '現場の指定が正しくありません' });
export const tradeIdSchema = z.guid({ error: '工種の指定が正しくありません' });

// ─── エラーの文言 ───

/** "3.qty" のような位置を「3行目：」にして最初の誤りを返す。 */
export function firstIssueMessage(error: z.ZodError, label = ''): string {
  const issue = error.issues[0];
  if (!issue) return '入力内容が正しくありません';
  const index = issue.path[0];
  return typeof index === 'number' ? `${label}${index + 1}行目：${issue.message}` : issue.message;
}

export const BUDGET_FORBIDDEN_MESSAGE = '実行予算・元請けの内訳・工種は社員・管理者だけが変更できます';
export const BUDGET_CLOSED_MESSAGE = 'この現場は完了（または削除）されているため変更できません';
export const PROGRESS_FORBIDDEN_MESSAGE = '進み具合を上書きできるのは、管理者と、この現場の確認者・承認者（社員）だけです';
export const BUDGET_SAVE_FAILED = '保存に失敗しました。通信状況を確認してもう一度お試しください。';

/**
 * 積算連携の表・関数（ガード・制約・RLS）のエラーを利用者向けの文言に変える。該当しなければ null（呼び出し側の共通の文言）。
 * detail は trade_in_use のときの工種の名前（Postgres の DETAIL）。
 */
export function budgetErrorMessage(dbMessage: string | null | undefined, detail?: string | null): string | null {
  const m = dbMessage ?? '';
  if (m.includes('trade_in_use')) {
    const name = detail?.trim();
    return name
      ? `工種「${name}」は日報・読み替え表・実行予算・元請けの内訳・進み具合で使われているため消せません`
      : '日報・読み替え表・実行予算・元請けの内訳・進み具合で使われている工種は消せません';
  }
  if (m.includes('site_closed')) return BUDGET_CLOSED_MESSAGE;
  if (m.includes('not_employee') || m.includes('not_member')) return BUDGET_FORBIDDEN_MESSAGE;
  if (m.includes('trade_not_in_site') || m.includes('trade_not_found')) {
    return '工種が見つかりません（他の端末で変更された可能性があります）。画面を再読み込みしてください';
  }
  if (m.includes('not_partner')) return '請負・常用の施工者は、協力会社の印のある会社を選んでください';
  if (m.includes('gn_site_trades_site_id_name_key')) return '同じ名前の工種がすでにあります';
  if (m.includes('gn_budget_lines_combo_ck')) return '実行予算の項目と施工者の組み合わせが正しくありません';
  if (m.includes('gn_contract_items_trade_ck')) return '経費・減分の行には工種を付けません';
  if (m.includes('gn_trade_progress_percent_check')) return MSG_PERCENT;
  if (m.includes('invalid_input')) return '入力内容が正しくありません';
  return null;
}
