import { describe, expect, it } from 'vitest';
import {
  CHANGE_KINDS,
  CHANGE_KIND_LABELS,
  EMPTY_WORK_CHANGE,
  INSTRUCTION_METHODS,
  INSTRUCTION_METHOD_LABELS,
  ISSUE_KINDS,
  ISSUE_KIND_LABELS,
} from '@/lib/report/change-labels';
import { validateReport, type SaveInput } from '@/lib/report/schema';
import { fromInput, patchRow, toInput } from '@/components/report/form-state';

// 作業内容の行の「追加・変更・減」の記録（区分・指示者・指示方法・指示日・根拠の件）。

const base = {
  siteId: '11111111-1111-1111-1111-111111111111',
  date: '2026-11-05',
  weather: '晴れ',
  supervisor: '大堀',
  common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 },
  issuesText: '',
  notesText: '',
};
const ISSUE = '22222222-2222-4222-8222-222222222222';
// 項目追加前の下書き（区分などの項目が無い）
const oldWork = { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 20, unit: '㎡', manDays: 1.5, unitPrice: 3000, source: 'extra' };

function workOf(input: unknown) {
  const r = validateReport({ ...base, lines: [input] });
  if (!r.ok) throw new Error(r.errors.join(' / '));
  const l = r.value.lines[0];
  if (l.kind !== 'work') throw new Error('work ではない');
  return l;
}

function errorsOf(input: unknown): string[] {
  const r = validateReport({ ...base, lines: [input] });
  return r.ok ? [] : r.errors;
}

describe('ラベル', () => {
  it('区分・指示方法・件の種別の表示名', () => {
    expect(CHANGE_KINDS.map((k) => CHANGE_KIND_LABELS[k])).toEqual(['契約内', '追加', '増', '変更', '減']);
    expect(INSTRUCTION_METHODS.map((k) => INSTRUCTION_METHOD_LABELS[k])).toEqual(['口頭', '電話', 'メール', '書面', 'その他']);
    expect(ISSUE_KINDS.map((k) => ISSUE_KIND_LABELS[k])).toEqual([
      '追加指示', '増（数量増）', '仕様変更', '減', '客先都合（手待ち・待機）', 'やり直し', 'その他',
    ]);
  });
  it('既定値は契約内・指示なし', () => {
    expect(EMPTY_WORK_CHANGE).toEqual({ changeKind: 'contract', instructedBy: '', instructionMethod: null, instructedOn: null, issueId: null });
  });
});

describe('作業内容の区分・指示の検証', () => {
  it('項目の無い古い下書きも通り、契約内・指示なしになる', () => {
    expect(workOf(oldWork)).toMatchObject(EMPTY_WORK_CHANGE);
  });
  it('区分・指示者・指示方法・指示日・根拠の件を受け付ける（指示者の前後の空白は除く）', () => {
    for (const changeKind of CHANGE_KINDS) expect(workOf({ ...oldWork, changeKind }).changeKind).toBe(changeKind);
    for (const instructionMethod of INSTRUCTION_METHODS) {
      expect(workOf({ ...oldWork, instructionMethod }).instructionMethod).toBe(instructionMethod);
    }
    expect(
      workOf({ ...oldWork, changeKind: 'extra', instructedBy: ' 施主 山田様 ', instructionMethod: 'oral', instructedOn: '2026-11-04', issueId: ISSUE }),
    ).toMatchObject({ changeKind: 'extra', instructedBy: '施主 山田様', instructionMethod: 'oral', instructedOn: '2026-11-04', issueId: ISSUE });
  });
  it('空欄は未入力（指示者は ""、指示方法・指示日・根拠の件は null）', () => {
    expect(workOf({ ...oldWork, instructedBy: null, instructionMethod: '', instructedOn: '', issueId: '' })).toMatchObject({
      instructedBy: '', instructionMethod: null, instructedOn: null, issueId: null,
    });
  });
  it('正しくない値は日本語の文言で止める', () => {
    expect(errorsOf({ ...oldWork, changeKind: 'plus' })).toEqual(['作業内容の1行目：区分は契約内・追加・増・変更・減から選んでください']);
    expect(errorsOf({ ...oldWork, changeKind: null })).toEqual(['作業内容の1行目：区分は契約内・追加・増・変更・減から選んでください']);
    expect(errorsOf({ ...oldWork, instructionMethod: 'fax' })).toEqual(['作業内容の1行目：指示方法は口頭・電話・メール・書面・その他から選んでください']);
    expect(errorsOf({ ...oldWork, instructedOn: '2026/11/04' })).toEqual(['作業内容の1行目：指示日は YYYY-MM-DD 形式で入力してください']);
    expect(errorsOf({ ...oldWork, instructedOn: '2026-02-30' })).toEqual(['作業内容の1行目：指示日は YYYY-MM-DD 形式で入力してください']);
    expect(errorsOf({ ...oldWork, issueId: 'abc' })).toEqual(['作業内容の1行目：IDの形式が正しくありません']);
    expect(errorsOf({ ...oldWork, instructedBy: 'あ'.repeat(101) })).toEqual(['作業内容の1行目：指示者は100文字以内で入力してください']);
  });
});

describe('入力画面の行 → 保存の入力', () => {
  it('追加・根拠の件つきの行は、区分を契約内に戻しても値を残したまま検証を通る（指示者は前後の空白を除く）', () => {
    const saved = { ...base, lines: [{ ...oldWork, changeKind: 'extra', instructedBy: ' 施主 山田様 ', instructionMethod: 'phone', instructedOn: '2026-11-04', issueId: ISSUE }] };
    const state = fromInput(saved as SaveInput);
    expect(state.rows.work).toHaveLength(1);
    const back = toInput(base.siteId, base.date, state);
    const r = validateReport(back);
    expect(r.ok && r.value.lines[0]).toMatchObject({ changeKind: 'extra', instructedBy: '施主 山田様', instructionMethod: 'phone', instructedOn: '2026-11-04', issueId: ISSUE });

    const hidden = { ...state, rows: { ...state.rows, work: patchRow(state.rows.work, 0, { changeKind: 'contract' }) } };
    const r2 = validateReport(toInput(base.siteId, base.date, hidden));
    expect(r2.ok && r2.value.lines[0]).toMatchObject({ changeKind: 'contract', instructedBy: '施主 山田様', issueId: ISSUE });
  });
});
