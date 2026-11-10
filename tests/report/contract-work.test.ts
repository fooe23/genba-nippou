import { describe, expect, it } from 'vitest';
import {
  MISSING_CONTRACT_WORK_ALL_CHANGES,
  MISSING_CONTRACT_WORK_NONE,
  contractWorkWarning,
  hasWorkContent,
  manDaysMismatchWarning,
  manDaysText,
  missingSettlementAmount,
  needsSettlement,
  outputBreakdown,
  taggedCostCategory,
  taggedCostNote,
  taggedCostTotal,
  workWarnings,
} from '@/lib/report/contract-work';
import type { ChangeKind } from '@/lib/types';

/** 中身のある作業内容の行（施工内容あり）。 */
const line = (changeKind: ChangeKind, manDays: number | null = null) => ({ changeKind, description: '作業', manDays, qty: null, unitPrice: null });
const w = (changeKind: ChangeKind) => line(changeKind);
const empty = (changeKind: ChangeKind = 'contract') => ({ changeKind, description: '  ', manDays: null, qty: null, unitPrice: null });

describe('contractWorkWarning（作業内容が無い・契約外だけの日の知らせ）', () => {
  it('人工のある作業員がいて、作業内容の行が無い → (a)', () => {
    expect(contractWorkWarning([1], [])).toBe(MISSING_CONTRACT_WORK_NONE);
    expect(MISSING_CONTRACT_WORK_NONE).toBe('作業員の人工がありますが、作業内容が入っていません。契約内の作業を入れてください。');
  });
  it('人工のある作業員がいて、作業内容が追加・増・変更・減だけ → (b)', () => {
    expect(contractWorkWarning([0.5, 1], [w('extra'), w('increase'), w('change'), w('minus')])).toBe(MISSING_CONTRACT_WORK_ALL_CHANGES);
    expect(MISSING_CONTRACT_WORK_ALL_CHANGES).toBe(
      '作業内容が追加・変更の行だけです。契約内の作業が入っていないと、作業員の人工が全部その件に付きます。',
    );
  });
  it('契約内の行が 1 行でもあれば出さない', () => {
    expect(contractWorkWarning([1], [w('extra'), w('contract')])).toBeNull();
    expect(contractWorkWarning([1], [w('contract')])).toBeNull();
  });
  it('人工のある作業員がいなければ出さない（行が無い・人工 0 だけ）', () => {
    expect(contractWorkWarning([], [])).toBeNull();
    expect(contractWorkWarning([0, 0], [])).toBeNull();
    expect(contractWorkWarning([0], [w('extra')])).toBeNull();
  });
  it('人工が数でない（入力途中）の行は数えない', () => {
    expect(contractWorkWarning([Number.NaN], [])).toBeNull();
  });
  it('足したばかりの空の行（施工内容・投入人工・金額が無い）は作業内容に数えない', () => {
    expect(contractWorkWarning([1], [empty()])).toBe(MISSING_CONTRACT_WORK_NONE);
    expect(contractWorkWarning([1], [w('extra'), empty()])).toBe(MISSING_CONTRACT_WORK_ALL_CHANGES);
    expect(workWarnings([1], [empty()])).toEqual([MISSING_CONTRACT_WORK_NONE]);
    expect(manDaysMismatchWarning([1], [empty()])).toBeNull();
  });
  it('施工内容・投入人工・金額のどれかがあれば中身のある行', () => {
    expect(hasWorkContent({ description: '床', manDays: null, qty: null, unitPrice: null })).toBe(true);
    expect(hasWorkContent({ description: '', manDays: 0.5, qty: null, unitPrice: null })).toBe(true);
    expect(hasWorkContent({ description: '', manDays: 0, qty: 2, unitPrice: 1000 })).toBe(true);
    expect(hasWorkContent({ description: '', manDays: 0, qty: 2, unitPrice: null })).toBe(false);
    expect(contractWorkWarning([1], [{ ...empty(), manDays: 1 }])).toBeNull();
  });
});

describe('needsSettlement（精算が必要な区分）', () => {
  it('契約内以外は精算が必要', () => {
    expect(needsSettlement('contract')).toBe(false);
    for (const k of ['extra', 'increase', 'change', 'minus'] as const) expect(needsSettlement(k)).toBe(true);
  });
});

describe('outputBreakdown（本日出来高を契約内と追加・変更に分ける）', () => {
  it('契約外の行が無ければ全部契約内', () => {
    expect(outputBreakdown(100_000, null)).toEqual({ contract: 100_000, changes: 0, total: 100_000, subcontractContract: 0, subcontractChanges: 0 });
  });
  it('契約外の合計（減は負）を引いた残りが契約内', () => {
    const changes = { extra: 30_000, increase: 25_000, change: 0, minus: -5_000, net: 50_000 };
    expect(outputBreakdown(150_000, changes)).toEqual({ contract: 100_000, changes: 50_000, total: 150_000, subcontractContract: 0, subcontractChanges: 0 });
  });
  it('減だけの日は契約外がマイナス', () => {
    const changes = { extra: 0, increase: 0, change: 0, minus: -10_000, net: -10_000 };
    expect(outputBreakdown(40_000, changes)).toEqual({ contract: 50_000, changes: -10_000, total: 40_000, subcontractContract: 0, subcontractChanges: 0 });
  });
});

describe('manDaysMismatchWarning（作業員と作業内容の人工のずれ）', () => {
  const m = (manDays: number | null, changeKind: ChangeKind = 'contract') => line(changeKind, manDays);
  it('作業員の人工の合計と作業内容の投入人工の合計が 0.01 以上ずれていれば知らせる', () => {
    expect(manDaysMismatchWarning([1], [m(0.5)])).toBe('作業員の人工（1.0 人工）と作業内容の投入人工（0.5 人工）が合っていません。');
    expect(manDaysMismatchWarning([0.5, 1], [m(1), m(1.25, 'extra')])).toBe('作業員の人工（1.5 人工）と作業内容の投入人工（2.25 人工）が合っていません。');
    expect(manDaysMismatchWarning([1], [m(null)])).toBe('作業員の人工（1.0 人工）と作業内容の投入人工（0.0 人工）が合っていません。');
  });
  it('合っている（浮動小数の誤差・0.01 未満の差を含む）なら出さない', () => {
    expect(manDaysMismatchWarning([1, 0.5], [m(1), m(0.5, 'extra')])).toBeNull();
    expect(manDaysMismatchWarning([0.1, 0.2], [m(0.3)])).toBeNull();
    expect(manDaysMismatchWarning([1], [m(0.995)])).toBeNull();
    expect(manDaysMismatchWarning([1], [m(0.99)])).not.toBeNull();
  });
  it('作業員の人工が 0・作業内容の行が無いときは出さない（人工が数でない・0 以下の行は数えない）', () => {
    expect(manDaysMismatchWarning([], [m(1)])).toBeNull();
    expect(manDaysMismatchWarning([0, Number.NaN], [m(1)])).toBeNull();
    expect(manDaysMismatchWarning([1], [])).toBeNull();
  });
});

describe('workWarnings（当てはまる知らせを全部）', () => {
  it('(a) 作業内容が無い日は (a) だけ（ずれは出さない）', () => {
    expect(workWarnings([1], [])).toEqual([MISSING_CONTRACT_WORK_NONE]);
  });
  it('(b) 契約外だけで人工もずれていれば両方', () => {
    expect(workWarnings([2], [line('extra', 1)])).toEqual([
      MISSING_CONTRACT_WORK_ALL_CHANGES,
      '作業員の人工（2.0 人工）と作業内容の投入人工（1.0 人工）が合っていません。',
    ]);
  });
  it('人工のずれだけ、何も無ければ空', () => {
    expect(workWarnings([1], [line('contract', 2)])).toEqual(['作業員の人工（1.0 人工）と作業内容の投入人工（2.0 人工）が合っていません。']);
    expect(workWarnings([1], [line('contract', 1)])).toEqual([]);
    expect(workWarnings([], [])).toEqual([]);
  });
});

describe('manDaysText（人工の表示）', () => {
  it('小数 1 桁は必ず、2 桁目があれば 2 桁', () => {
    expect([1, 1.5, 0.25, 0, 2.1, 1.005].map(manDaysText)).toEqual(['1.0', '1.5', '0.25', '0.0', '2.1', '1.0']);
  });
});

describe('missingSettlementAmount（精算の金額（施工単価）が入っていない行）', () => {
  const line = (changeKind: ChangeKind, qty: number | null, unitPrice: number | null) => ({ changeKind, qty, unitPrice });
  it('追加・増・変更で数量 × 施工単価が 0 以下・空欄なら true', () => {
    expect(missingSettlementAmount(line('extra', 1, null))).toBe(true);
    expect(missingSettlementAmount(line('increase', null, 5000))).toBe(true);
    expect(missingSettlementAmount(line('change', 2, 0))).toBe(true);
    expect(missingSettlementAmount(line('extra', 1, 25000))).toBe(false);
  });
  it('契約内・減は出さない。根拠の件が一式・見積・常用なら出さない（未定なら出す）', () => {
    expect(missingSettlementAmount(line('contract', 1, null))).toBe(false);
    expect(missingSettlementAmount(line('minus', 1, null))).toBe(false);
    expect(missingSettlementAmount(line('extra', 1, null), { settlementMethod: 'lump_sum' })).toBe(false);
    expect(missingSettlementAmount(line('extra', 1, null), { settlementMethod: 'daily_rate' })).toBe(false);
    expect(missingSettlementAmount(line('extra', 1, null), { settlementMethod: 'undecided' })).toBe(true);
  });
});

describe('根拠の件を選んだ費用（2026-11-11：契約外＝精算が必要）', () => {
  const kinds = new Map([
    ['iInc', 'increase' as const],
    ['iSite', 'site_judgment' as const],
    ['iMinus', 'minus' as const],
    ['iRework', 'rework' as const],
  ]);
  it('区分と文言：件の区分（現場判断は追加）。根拠なし・減・やり直しは印なし、読めない件は区分なし', () => {
    expect(taggedCostNote('iInc', kinds)).toBe('契約外（増）の費用です。');
    expect(taggedCostNote('iSite', kinds)).toBe('契約外（追加）の費用です。');
    expect(taggedCostNote(null, kinds)).toBeNull();
    expect(taggedCostNote('iMinus', kinds)).toBeNull();
    expect(taggedCostNote('iRework', kinds)).toBeNull();
    expect(taggedCostCategory('gone', kinds)).toBe('unknown');
    expect(taggedCostNote('gone', kinds)).toBe('契約外の費用です。');
  });
  const lines = [
    { kind: 'labor', issueId: null, a: 20000 },
    { kind: 'work', issueId: 'iInc', a: 25000 },
    { kind: 'fuel', issueId: 'iInc', a: 170 },
    { kind: 'lease', issueId: 'iSite', a: 3000 },
    { kind: 'cash', issueId: null, a: 800 },
    { kind: 'credit', purchaseKind: 'material', issueId: 'iInc', a: 25000 },
    { kind: 'credit', purchaseKind: 'subcontract', issueId: 'iInc', a: 170000 },
    { kind: 'credit', purchaseKind: 'material', issueId: 'iRework', a: 1000 },
    { kind: 'cash', issueId: 'gone', a: 500 },
  ];
  it('和は根拠の件を選んだ燃料・リース・現金・買掛（仕入・外注）だけ。労務・作業内容・根拠なし・減・やり直しは入れない', () => {
    expect(taggedCostTotal(lines, kinds, (l) => l.a)).toBe(170 + 3000 + 25000 + 170000 + 500);
  });
  it('協力会社（includeSubcontract false）は外注を入れない。帳票（includeUnknown false）は読めない件を入れない', () => {
    expect(taggedCostTotal(lines, kinds, (l) => l.a, { includeSubcontract: false })).toBe(170 + 3000 + 25000 + 500);
    expect(taggedCostTotal(lines, kinds, (l) => l.a, { includeUnknown: false })).toBe(170 + 3000 + 25000 + 170000);
  });
});
