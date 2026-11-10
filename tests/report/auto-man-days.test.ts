import { describe, expect, it } from 'vitest';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { autoManDays, fillAutoManDays, isAutoManDaysTarget, laborManDaysForAllocation, withAutoManDays } from '@/lib/report/auto-man-days';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import { MISSING_CONTRACT_WORK_NONE, workWarnings } from '@/lib/report/contract-work';
import type { ChangeKind, LaborLine, ReportLine, TimeSpec, WorkLine } from '@/lib/types';

const common: TimeSpec = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };
const W = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const NO_TIME = { start: null, end: null, breakMin: null, gapMin: null };

const ito: LaborLine = { kind: 'labor', workerId: W, workerName: '伊藤', time: NO_TIME, dailyRate: 20000, note: '', overtimeRate: null, affiliation: 'own' };
const work = (description: string, manDays: number | null, changeKind: ChangeKind = 'contract', issueId: string | null = null): WorkLine => ({
  kind: 'work', estimateItemId: null, trade: '', description, qty: null, unit: '', manDays, unitPrice: null, source: 'extra',
  ...EMPTY_WORK_CHANGE, changeKind, issueId, siteTradeId: null,
});
const manDaysOf = (lines: ReportLine[]) => lines.flatMap((l) => (l.kind === 'work' ? [l.manDays] : []));

describe('fillAutoManDays（契約内の作業の投入人工が空なら、出面の残りの人工を割り振る）', () => {
  it('伊藤 1 人工、契約内の行が 1 つで空 → 1.0', () => {
    expect(manDaysOf(fillAutoManDays([ito, work('タイル張り', null)], common, DEFAULT_LABOR_RULE))).toEqual([1]);
  });
  it('契約内が空 ＋ 件の行 0.5 → 契約内は 0.5', () => {
    const lines = [ito, work('タイル張り', null), work('門扉の調整', 0.5, 'extra', I)];
    expect(manDaysOf(fillAutoManDays(lines, common, DEFAULT_LABOR_RULE))).toEqual([0.5, 0.5]);
  });
  it('契約内の空が 2 行で残り 1.0 → 0.5 ずつ', () => {
    const lines = [ito, work('タイル張り', null), work('目地', null)];
    expect(manDaysOf(fillAutoManDays(lines, common, DEFAULT_LABOR_RULE))).toEqual([0.5, 0.5]);
  });
  it('名前なし（会社と人数）の行は人数分で数える：2 名 × 1 人工 ＋ 伊藤 1 人工 → 3.0', () => {
    const unnamed: LaborLine = { ...ito, workerId: null, workerName: '東北建興（名前なし）', headcount: 2 };
    expect(manDaysOf(fillAutoManDays([ito, unnamed, work('タイル張り', null)], common, DEFAULT_LABOR_RULE))).toEqual([3]);
  });
  it('残りが 0 以下 → 0', () => {
    const lines = [ito, work('タイル張り', null), work('門扉の調整', 1.5, 'extra', I)];
    expect(manDaysOf(fillAutoManDays(lines, common, DEFAULT_LABOR_RULE))).toEqual([0, 1.5]);
  });
  it('件の行（追加・増・変更・減、または件を選んだ契約内の行）は空でも入れない', () => {
    const lines = [ito, work('門扉の調整', null, 'extra', I), work('手直し', null, 'contract', I), work('撤去', null, 'minus')];
    expect(manDaysOf(fillAutoManDays(lines, common, DEFAULT_LABOR_RULE))).toEqual([null, null, null]);
  });
  it('入力済みの契約内の行はそのまま、空の行に残りだけ', () => {
    const lines = [ito, work('タイル張り', 0.25), work('目地', null)];
    expect(manDaysOf(fillAutoManDays(lines, common, DEFAULT_LABOR_RULE))).toEqual([0.25, 0.75]);
  });
  it('作業員がいない日・名前の無い空の作業員の行だけの日は入れない', () => {
    expect(manDaysOf(fillAutoManDays([work('タイル張り', null)], common, DEFAULT_LABOR_RULE))).toEqual([null]);
    const blank: LaborLine = { ...ito, workerId: null, workerName: '' };
    expect(manDaysOf(fillAutoManDays([blank, work('タイル張り', null)], common, DEFAULT_LABOR_RULE))).toEqual([null]);
  });
  it('足したばかりの空の作業内容の行には入れない', () => {
    expect(manDaysOf(fillAutoManDays([ito, work('  ', null), work('タイル張り', null)], common, DEFAULT_LABOR_RULE))).toEqual([null, 1]);
  });
});

describe('autoManDays（割り振りの計算）', () => {
  const c = (description: string, manDays: number | null = null) => ({ changeKind: 'contract' as const, description, manDays, qty: null, unitPrice: null, issueId: null });
  it('0.01 単位で割り、端数は最初の行に足す（合計はぴったり）', () => {
    expect(autoManDays([1], [c('a'), c('b'), c('c')])).toEqual([0.34, 0.33, 0.33]);
  });
  it('対象でない行は null', () => {
    expect(autoManDays([1], [c('a', 0.5), c('b')])).toEqual([null, 0.5]);
  });
  it('施工数量だけの行も対象', () => {
    expect(isAutoManDaysTarget({ changeKind: 'contract', description: '', manDays: null, qty: 10, unitPrice: null, issueId: null })).toBe(true);
  });
  it('laborManDaysForAllocation は名前のある行・名前なしの行だけ', () => {
    expect(laborManDaysForAllocation([ito, { ...ito, workerId: null, workerName: '' }, work('x', null)], common, DEFAULT_LABOR_RULE)).toEqual([1]);
  });
});

describe('人工のずれの知らせは自動の値で見る', () => {
  it('契約内の空の行が 1 つなら、ずれの知らせは出ない', () => {
    const lines = [work('タイル張り', null)];
    expect(workWarnings([1], withAutoManDays([1], lines))).toEqual([]);
    // 自動の値を使わなければ出る（従来の動き）
    expect(workWarnings([1], lines)).toHaveLength(1);
  });
  it('作業内容が無ければ従来どおり (a)', () => {
    expect(workWarnings([1], withAutoManDays([1], []))).toEqual([MISSING_CONTRACT_WORK_NONE]);
  });
});
