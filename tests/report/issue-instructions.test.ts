import { describe, expect, it } from 'vitest';
import { applyIssueInstructions, issueInstruction, issueInstructionText, type IssueInstructionSource } from '@/lib/report/issue-instructions';
import type { ReportLine, WorkLine } from '@/lib/types';

const I1 = '11111111-1111-4111-8111-111111111111';
const I2 = '22222222-2222-4222-8222-222222222222';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

function work(p: Partial<WorkLine>): WorkLine {
  return {
    kind: 'work',
    estimateItemId: null,
    trade: '内装',
    description: '棚',
    qty: 1,
    unit: '式',
    manDays: null,
    unitPrice: 10000,
    source: 'extra',
    changeKind: 'extra',
    instructedBy: '',
    instructionMethod: null,
    instructedOn: null,
    issueId: null,
    ...p,
  };
}

const issues = new Map<string, IssueInstructionSource>([
  [I1, { instructedBy: '施主（大江様）', instructionMethod: 'oral', reportDate: '2026-11-08' }],
  [I2, { instructedBy: null, instructionMethod: null, reportDate: '2026-11-05' }],
]);

describe('根拠の件から指示者・指示方法・指示日を入れる', () => {
  it('件のある行は画面の値を件の値で上書きする（指示日は件の日報の日付）', () => {
    const out = applyIssueInstructions(
      [work({ issueId: I1, instructedBy: '別人', instructionMethod: 'email', instructedOn: '2026-01-01' })],
      issues,
    );
    expect(out[0]).toMatchObject({ instructedBy: '施主（大江様）', instructionMethod: 'oral', instructedOn: '2026-11-08', issueId: I1 });
  });

  it('件に指示者・指示方法が無ければ空にする', () => {
    const out = applyIssueInstructions([work({ issueId: I2, instructedBy: '入力', instructionMethod: 'phone' })], issues);
    expect(out[0]).toMatchObject({ instructedBy: '', instructionMethod: null, instructedOn: '2026-11-05' });
  });

  it('件の無い行・見つからない件の行・作業内容以外の行はそのまま（同じオブジェクト）', () => {
    const lines: ReportLine[] = [
      work({ instructedBy: '施主', instructionMethod: 'phone', instructedOn: '2026-11-01' }),
      work({ issueId: UNKNOWN, instructedBy: '施主', instructionMethod: 'phone', instructedOn: '2026-11-01' }),
      { kind: 'cash', itemName: 'テープ', spec: '', unit: '巻', qty: 1, unitPrice: 100, vendor: '' },
    ];
    const out = applyIssueInstructions(lines, issues);
    lines.forEach((l, i) => expect(out[i]).toBe(l));
  });

  it('すでに件の値なら同じオブジェクトのまま返す', () => {
    const l = work({ issueId: I1, instructedBy: '施主（大江様）', instructionMethod: 'oral', instructedOn: '2026-11-08' });
    expect(applyIssueInstructions([l], issues)[0]).toBe(l);
  });

  it('件の日付が読めなければ指示日は null', () => {
    expect(issueInstruction({ instructedBy: 'A', instructionMethod: null, reportDate: '' })).toEqual({
      instructedBy: 'A',
      instructionMethod: null,
      instructedOn: null,
    });
  });

  it('表示：指示者／方法 日付（件から）。無ければ —', () => {
    expect(issueInstructionText(issues.get(I1)!)).toBe('指示：施主（大江様）／口頭 2026/11/8（件から）');
    expect(issueInstructionText(issues.get(I2)!)).toBe('指示：— 2026/11/5（件から）');
    expect(issueInstructionText({ instructedBy: null, instructionMethod: 'site', reportDate: '2026-11-08' })).toMatch(/^指示：指示なし（現場判断） 2026\/11\/8（件から）$/);
  });
});
