import { describe, expect, it } from 'vitest';
import {
  MISSING_CONTRACT_WORK_ALL_CHANGES,
  MISSING_CONTRACT_WORK_NONE,
  contractWorkWarning,
  needsSettlement,
  outputBreakdown,
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
