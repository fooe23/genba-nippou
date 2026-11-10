import { describe, expect, it } from 'vitest';
import {
  MISSING_CONTRACT_WORK_ALL_CHANGES,
  MISSING_CONTRACT_WORK_NONE,
  contractWorkWarning,
  manDaysMismatchWarning,
  manDaysText,
  missingSettlementAmount,
  needsSettlement,
  outputBreakdown,
  workWarnings,
} from '@/lib/report/contract-work';
import type { ChangeKind } from '@/lib/types';

const w = (changeKind: ChangeKind) => ({ changeKind });

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
});

describe('needsSettlement（精算が必要な区分）', () => {
  it('契約内以外は精算が必要', () => {
    expect(needsSettlement('contract')).toBe(false);
    for (const k of ['extra', 'increase', 'change', 'minus'] as const) expect(needsSettlement(k)).toBe(true);
  });
});

describe('outputBreakdown（本日出来高を契約内と追加・変更に分ける）', () => {
  it('契約外の行が無ければ全部契約内', () => {
    expect(outputBreakdown(100_000, null)).toEqual({ contract: 100_000, changes: 0, total: 100_000 });
  });
  it('契約外の合計（減は負）を引いた残りが契約内', () => {
    const changes = { extra: 30_000, increase: 25_000, change: 0, minus: -5_000, net: 50_000 };
    expect(outputBreakdown(150_000, changes)).toEqual({ contract: 100_000, changes: 50_000, total: 150_000 });
  });
  it('減だけの日は契約外がマイナス', () => {
    const changes = { extra: 0, increase: 0, change: 0, minus: -10_000, net: -10_000 };
    expect(outputBreakdown(40_000, changes)).toEqual({ contract: 50_000, changes: -10_000, total: 40_000 });
  });
});

describe('manDaysMismatchWarning（作業員と作業内容の人工のずれ）', () => {
  const m = (manDays: number | null, changeKind: ChangeKind = 'contract') => ({ changeKind, manDays });
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
    expect(workWarnings([2], [{ changeKind: 'extra', manDays: 1 }])).toEqual([
      MISSING_CONTRACT_WORK_ALL_CHANGES,
      '作業員の人工（2.0 人工）と作業内容の投入人工（1.0 人工）が合っていません。',
    ]);
  });
  it('人工のずれだけ、何も無ければ空', () => {
    expect(workWarnings([1], [{ changeKind: 'contract', manDays: 2 }])).toEqual(['作業員の人工（1.0 人工）と作業内容の投入人工（2.0 人工）が合っていません。']);
    expect(workWarnings([1], [{ changeKind: 'contract', manDays: 1 }])).toEqual([]);
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
