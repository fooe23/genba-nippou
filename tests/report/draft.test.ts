import { describe, expect, it } from 'vitest';
import { isServerNewer, isValidDraft, upgradeDraft } from '@/lib/report/draft';
import type { SaveInput } from '@/lib/report/schema';

const siteId = '11111111-1111-4111-8111-111111111111';
const date = '2026-11-05';
const draft = {
  siteId,
  date,
  weather: null,
  supervisor: '大堀',
  common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 },
  issuesText: '',
  notesText: '',
  lines: [
    { kind: 'labor', workerId: null, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 19000, note: '' },
    { kind: 'cash', itemName: '雑費', spec: '', unit: '', qty: null, unitPrice: null, vendor: '', amountOnly: 1500 },
  ],
  savedAt: '2026-11-05T09:00:00.000Z',
};

describe('isValidDraft', () => {
  it('正しい形の下書きは受け付ける', () => {
    expect(isValidDraft(draft, siteId, date)).toBe(true);
  });
  it('time の無い作業員行・不明な kind・別の現場/日付は不可', () => {
    const { time: _time, ...noTime } = draft.lines[0];
    void _time;
    expect(isValidDraft({ ...draft, lines: [noTime] }, siteId, date)).toBe(false);
    expect(isValidDraft({ ...draft, lines: [{ kind: 'photo' }] }, siteId, date)).toBe(false);
    expect(isValidDraft({ ...draft, lines: [null] }, siteId, date)).toBe(false);
    expect(isValidDraft(draft, siteId, '2026-11-06')).toBe(false);
    expect(isValidDraft({ ...draft, lines: 'x' }, siteId, date)).toBe(false);
  });
  it('区分などの無い古い作業内容の行は、読み込み時に既定（契約内・指示なし）を末尾に足す', () => {
    const work = { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 1, unit: '', manDays: null, unitPrice: null, source: 'extra' };
    const old = { ...draft, lines: [work] } as unknown as SaveInput;
    expect(isValidDraft(old, siteId, date)).toBe(true);
    const up = upgradeDraft(old);
    expect(up.lines[0]).toEqual({ ...work, changeKind: 'contract', instructedBy: '', instructionMethod: null, instructedOn: null, issueId: null });
    expect(Object.keys(up.lines[0]).slice(-5)).toEqual(['changeKind', 'instructedBy', 'instructionMethod', 'instructedOn', 'issueId']);
    // 入っている値はそのまま
    const filled = upgradeDraft({ ...draft, lines: [{ ...work, changeKind: 'minus', instructedBy: '施主' }] } as unknown as SaveInput);
    expect(filled.lines[0]).toMatchObject({ changeKind: 'minus', instructedBy: '施主', instructionMethod: null });
  });
  it('残業単価（overtimeRate）の無い古い下書きも受け付け、読み込み時に null を末尾に足す', () => {
    expect(isValidDraft(draft, siteId, date)).toBe(true); // draft の作業員行には overtimeRate が無い
    const up = upgradeDraft(draft as unknown as SaveInput);
    expect(up.lines[0]).toMatchObject({ kind: 'labor', overtimeRate: null });
    expect(Object.keys(up.lines[0]).at(-1)).toBe('overtimeRate');
    expect(up.lines[1]).toBe(draft.lines[1]);
    const withRate = upgradeDraft({ ...draft, lines: [{ ...draft.lines[0], overtimeRate: 3000 }] } as unknown as SaveInput);
    expect(withRate.lines[0]).toMatchObject({ overtimeRate: 3000 });
  });
});

describe('isServerNewer（下書きより新しいサーバーの版）', () => {
  const v1 = '2026-10-30T12:00:00.123456+00:00';
  const v2 = '2026-10-30T12:05:00.000001+00:00';
  it('サーバーに日報が無ければ新しくない／同じ版なら新しくない', () => {
    expect(isServerNewer(null, null)).toBe(false);
    expect(isServerNewer(null, v1)).toBe(false);
    expect(isServerNewer(v1, v1)).toBe(false);
  });
  it('後から保存・作成された版は新しい', () => {
    expect(isServerNewer(v2, v1)).toBe(true);
    expect(isServerNewer(v1, null)).toBe(true);
    expect(isServerNewer('2026-10-30T12:00:00.123999+00:00', v1)).toBe(true); // マイクロ秒だけ違う
  });
  it('サーバーの版の方が古ければ新しくない', () => {
    expect(isServerNewer(v1, v2)).toBe(false);
  });
});
