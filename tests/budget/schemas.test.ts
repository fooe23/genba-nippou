import { describe, expect, it } from 'vitest';
import {
  budgetComboError,
  budgetErrorMessage,
  budgetLineInputSchema,
  budgetLinesInputSchema,
  contractItemInputSchema,
  contractModeSchema,
  firstIssueMessage,
  lineAmount,
  progressPercentSchema,
  roundYen,
  tradeAliasInputSchema,
  tradesInputSchema,
} from '@/lib/budget/schemas';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const S1 = '33333333-3333-4333-8333-333333333333';

describe('金額＝数量 × 単価（1 円単位で四捨五入。DB の round と同じ）', () => {
  it('0.5 は 0 から遠い方へ', () => {
    expect(lineAmount(12.5, 1001)).toBe(12513); // 12512.5
    expect(lineAmount(2.5, 20001)).toBe(50003); // 50002.5
    expect(roundYen(-2.5)).toBe(-3);
    expect(roundYen(-2.4)).toBe(-2);
    expect(roundYen(2.4999)).toBe(2);
  });
  it('浮動小数の誤差で切り捨てない', () => {
    expect(lineAmount(1.005, 1000)).toBe(1005); // 1004.9999… になる掛け算
    expect(lineAmount(0.1, 3)).toBe(0);
    expect(lineAmount(1.1, 3)).toBe(3);
  });
  it('0・-0・数でないものは 0', () => {
    expect(lineAmount(0, 1000)).toBe(0);
    expect(Object.is(roundYen(-0.4), 0)).toBe(true);
    expect(roundYen(Number.NaN)).toBe(0);
  });
});

describe('工種の一覧', () => {
  it('名前は前後の空白を落とし、1〜50 文字', () => {
    const r = tradesInputSchema.safeParse([{ id: null, name: ' 鉄骨工 ' }, { id: T1, name: 'あ'.repeat(50) }]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([{ id: null, name: '鉄骨工' }, { id: T1, name: 'あ'.repeat(50) }]);
    const empty = tradesInputSchema.safeParse([{ id: null, name: '  ' }]);
    expect(empty.success).toBe(false);
    if (!empty.success) expect(firstIssueMessage(empty.error, '工種の')).toBe('工種の1行目：工種名を入力してください');
    const long = tradesInputSchema.safeParse([{ id: null, name: 'あ'.repeat(51) }]);
    expect(long.success).toBe(false);
    if (!long.success) expect(long.error.issues[0].message).toBe('工種名は50文字以内で入力してください');
  });
  it('現場の中で名前の重複は不可（空白を落としてから比べる）', () => {
    const r = tradesInputSchema.safeParse([{ id: null, name: '塗装工' }, { id: T1, name: '塗装工 ' }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssueMessage(r.error, '工種の')).toBe('工種の2行目：工種「塗装工」が重複しています');
  });
  it('同じ id を 2 回入れられない。id は空なら新しい工種', () => {
    expect(tradesInputSchema.safeParse([{ id: T1, name: 'A' }, { id: T1, name: 'B' }]).success).toBe(false);
    const r = tradesInputSchema.safeParse([{ id: '', name: 'A' }, { name: 'B' }]);
    expect(r.success && r.data.map((t) => t.id)).toEqual([null, null]);
    expect(tradesInputSchema.safeParse([{ id: 'abc', name: 'A' }]).success).toBe(false);
  });
});

describe('実行予算の行の組み合わせ', () => {
  const line = (o: Record<string, unknown>) => ({ tradeId: T1, performer: 'own', supplierId: null, item: 'labor', note: '', qty: 10, unit: '人工', unitPrice: 25000, ...o });
  it('労務は自社。協力会社なら誤り', () => {
    expect(budgetLineInputSchema.safeParse(line({})).success).toBe(true);
    const r = budgetLineInputSchema.safeParse(line({ performer: 'partner', supplierId: S1 }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('労務は自社の行です');
  });
  it('請負・常用は協力会社が必須', () => {
    expect(budgetLineInputSchema.safeParse(line({ item: 'subcontract', performer: 'partner', supplierId: S1 })).success).toBe(true);
    expect(budgetLineInputSchema.safeParse(line({ item: 'jouyou', performer: 'partner', supplierId: S1 })).success).toBe(true);
    expect(budgetComboError({ item: 'jouyou', performer: 'partner', supplierId: null, tradeId: T1 })).toBe('請負・常用は施工者の協力会社を選んでください');
    expect(budgetComboError({ item: 'subcontract', performer: 'own', supplierId: null, tradeId: T1 })).toBe('請負・常用は施工者の協力会社を選んでください');
  });
  it('材料・リース・その他は現場全体（工種なし）だけ・会社なし', () => {
    for (const item of ['material', 'lease', 'other']) {
      expect(budgetLineInputSchema.safeParse(line({ item, tradeId: null })).success).toBe(true);
      expect(budgetComboError({ item: item as 'material', performer: 'own', supplierId: null, tradeId: T1 })).toBe('材料・リース・その他は工種に分けず、現場全体に入れてください');
      expect(budgetComboError({ item: item as 'material', performer: 'partner', supplierId: S1, tradeId: null })).toBe('材料・リース・その他には施工者の会社を入れません');
    }
  });
  it('労務・請負・常用は現場全体（工種なし）でもよい', () => {
    expect(budgetLineInputSchema.safeParse(line({ tradeId: null })).success).toBe(true);
  });
  it('金額は round(数量 × 単価) で付く。数量・単価は 0 以上', () => {
    const r = budgetLineInputSchema.safeParse(line({ item: 'jouyou', performer: 'partner', supplierId: S1, qty: 2.5, unitPrice: 20001 }));
    expect(r.success && r.data.amount).toBe(50003);
    expect(budgetLineInputSchema.safeParse(line({ qty: -1 })).success).toBe(false);
    expect(budgetLineInputSchema.safeParse(line({ unitPrice: Number.POSITIVE_INFINITY })).success).toBe(false);
  });
  it('一覧の誤りは「実行予算の n行目：」で返す', () => {
    const r = budgetLinesInputSchema.safeParse([line({}), line({ item: 'material' })]);
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssueMessage(r.error, '実行予算の')).toBe('実行予算の2行目：材料・リース・その他は工種に分けず、現場全体に入れてください');
  });
});

describe('元請けの内訳の行', () => {
  const item = (o: Record<string, unknown>) => ({ section: 'initial', name: '鉄骨建方', spec: '', qty: 12.5, unit: 't', unitPrice: 1001, tradeId: T1, category: 'trade', ...o });
  it('金額は round(数量 × 単価)。減分の負の単価も可', () => {
    const r = contractItemInputSchema.safeParse(item({}));
    expect(r.success && r.data.amount).toBe(12513);
    const minus = contractItemInputSchema.safeParse(item({ category: 'reduction', tradeId: null, qty: 1, unitPrice: -10000.5 }));
    expect(minus.success && minus.data.amount).toBe(-10001);
  });
  it('経費・減分には工種を付けない。工種の行の工種は空でもよい', () => {
    expect(contractItemInputSchema.safeParse(item({ category: 'expense' })).success).toBe(false);
    expect(contractItemInputSchema.safeParse(item({ category: 'expense', tradeId: null })).success).toBe(true);
    expect(contractItemInputSchema.safeParse(item({ tradeId: null })).success).toBe(true);
  });
  it('名称は必須。区分・識別は決まった値だけ', () => {
    expect(contractItemInputSchema.safeParse(item({ name: ' ' })).success).toBe(false);
    expect(contractItemInputSchema.safeParse(item({ section: 'other' })).success).toBe(false);
    expect(contractItemInputSchema.safeParse(item({ category: 'misc' })).success).toBe(false);
  });
  it('取り込み方は replace か appendChange', () => {
    expect(contractModeSchema.safeParse('replace').success).toBe(true);
    expect(contractModeSchema.safeParse('appendChange').success).toBe(true);
    expect(contractModeSchema.safeParse('append').success).toBe(false);
  });
});

describe('進み具合の上書き（%）と読み替え表', () => {
  it('0〜100。null は上書きを消す', () => {
    for (const v of [0, 37.5, 100, null]) expect(progressPercentSchema.safeParse(v).success).toBe(true);
    for (const v of [-0.1, 100.1, Number.NaN, '50']) expect(progressPercentSchema.safeParse(v).success).toBe(false);
  });
  it('日報の工種の文字は必須（空白を落とす）。工種は null で割り当てを外す', () => {
    const r = tradeAliasInputSchema.safeParse({ tradeText: ' ブラスト工 ', tradeId: T2 });
    expect(r.success && r.data).toEqual({ tradeText: 'ブラスト工', tradeId: T2 });
    expect(tradeAliasInputSchema.safeParse({ tradeText: 'x', tradeId: null }).success).toBe(true);
    expect(tradeAliasInputSchema.safeParse({ tradeText: '', tradeId: T2 }).success).toBe(false);
  });
});

describe('budgetErrorMessage', () => {
  it('DB の拒否の理由を日本語にする', () => {
    expect(budgetErrorMessage('trade_in_use', '鉄骨工')).toBe('工種「鉄骨工」は日報・読み替え表・実行予算・元請けの内訳・進み具合で使われているため消せません');
    expect(budgetErrorMessage('trade_in_use')).toBe('日報・読み替え表・実行予算・元請けの内訳・進み具合で使われている工種は消せません');
    expect(budgetErrorMessage('site_closed')).toContain('完了');
    expect(budgetErrorMessage('not_employee')).toContain('社員・管理者だけ');
    expect(budgetErrorMessage('not_partner')).toContain('協力会社の印');
    expect(budgetErrorMessage('trade_not_in_site')).toContain('工種が見つかりません');
    expect(budgetErrorMessage('duplicate key value violates unique constraint "gn_site_trades_site_id_name_key"')).toBe('同じ名前の工種がすでにあります');
    expect(budgetErrorMessage('violates check constraint "gn_budget_lines_combo_ck"')).toContain('組み合わせ');
    expect(budgetErrorMessage('something else')).toBeNull();
  });
});

describe('数量・単価の小数は 3 桁まで（画面の金額と DB の round を合わせる）', () => {
  const base = { performer: 'own', supplierId: null, item: 'labor', tradeId: '11111111-1111-4111-8111-111111111111', note: '', unit: '人工' } as const;
  it('3 桁までは通り、4 桁は誤り', async () => {
    const { budgetLineInputSchema, contractItemInputSchema, hasAtMostDecimals } = await import('@/lib/budget/schemas');
    expect(hasAtMostDecimals(1.125)).toBe(true);
    expect(hasAtMostDecimals(0.1 + 0.2)).toBe(true);
    expect(hasAtMostDecimals(1.1255)).toBe(false);
    expect(budgetLineInputSchema.safeParse({ ...base, qty: 2.125, unitPrice: 20000 }).success).toBe(true);
    const bad = budgetLineInputSchema.safeParse({ ...base, qty: 2.1255, unitPrice: 20000 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('数量の小数は3桁までにしてください');
    expect(
      contractItemInputSchema.safeParse({ name: 'x', qty: 1, unitPrice: 100.0001, spec: '', unit: '' }).success,
    ).toBe(false);
  });
  it('重複の文言は工種の名前の一意の制約のときだけ', () => {
    expect(budgetErrorMessage('duplicate key value violates unique constraint "gn_other_key"')).toBeNull();
  });
});

describe('工種の名前に使えない名前', () => {
  it('経費・減分・現場全体は断る（全角・半角の違いも）', () => {
    for (const name of ['経費', '減分', '（現場全体）', '(現場全体)', '現場全体', ' 経 費 ']) {
      const r = tradesInputSchema.safeParse([{ id: null, name }]);
      expect(r.success, name).toBe(false);
      expect(r.error?.issues[0]?.message).toContain('工種の名前に使えません');
    }
    expect(tradesInputSchema.safeParse([{ id: null, name: '経費調整工' }]).success).toBe(true);
  });
});
