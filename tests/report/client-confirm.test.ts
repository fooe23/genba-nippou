import { describe, expect, it } from 'vitest';
import {
  clientConfirmCandidates,
  clientConfirmHref,
  initialSelection,
  issueConfirmationLabel,
  LONG_PRESS_MS,
  longPressProgress,
  signTargetFor,
  SIGN_LATER_REASONS,
  type ConfirmCandidateIssue,
} from '@/lib/report/client-confirm';
import {
  clientIssueIdsForReport,
  REPORT_CONFIRMED_ISSUE_DELETE_MESSAGE,
  signatureErrorMessage,
} from '@/lib/report/client-signature';
import { ISSUE_CONFIRMED_DELETE_MESSAGE, issueEditErrorMessage } from '@/lib/report/issue-status';

const issue = (id: string, reportDate: string, number: number, over: Partial<ConfirmCandidateIssue> = {}): ConfirmCandidateIssue => ({
  id,
  reportDate,
  number,
  kind: 'extra',
  status: 'open',
  ...over,
});

describe('clientConfirmCandidates（確認していただく件の候補）', () => {
  it('その日報の件と現場の見積中・対応中の件。重複は 1 つ、やり直しは除く、並びは日付 → 番号', () => {
    const today2 = issue('t2', '2026-11-06', 2, { status: 'done' });
    const today1 = issue('t1', '2026-11-06', 1);
    const rework = issue('rw', '2026-11-06', 3, { kind: 'rework' });
    const old2 = issue('o2', '2026-11-03', 2, { status: 'estimating' });
    const old1 = issue('o1', '2026-11-03', 1);
    const oldRework = issue('or', '2026-11-02', 1, { kind: 'rework' });
    const got = clientConfirmCandidates([today2, today1, rework], [old2, today1, old1, oldRework]);
    expect(got.map((i) => i.id)).toEqual(['o1', 'o2', 't1', 't2']);
  });

  it('現場の件のうち完了した件は入れない（その日報の件なら完了でも入れる）', () => {
    const doneOld = issue('d', '2026-11-01', 1, { status: 'done' });
    const doneToday = issue('x', '2026-11-06', 1, { status: 'done' });
    expect(clientConfirmCandidates([doneToday], [doneOld]).map((i) => i.id)).toEqual(['x']);
  });

  it('件が無ければ空', () => {
    expect(clientConfirmCandidates([], [])).toEqual([]);
  });
});

describe('clientConfirmCandidates：その日に完了にした件（2026-11-20）', () => {
  it('前の日の件をその日に完了にしたら候補に入る。並びは日付 → 番号、重複しない、やり直しは入らない', () => {
    const today1 = issue('t1', '2026-11-12', 1);
    const doneOld = issue('d', '2026-11-04', 1, { status: 'done' });
    const doneRework = issue('dr', '2026-11-05', 1, { status: 'done', kind: 'rework' });
    const open = issue('o', '2026-11-08', 1);
    const got = clientConfirmCandidates([today1], [open], [doneOld, today1, doneRework, doneOld]);
    expect(got.map((i) => i.id)).toEqual(['d', 'o', 't1']);
  });
  it('「サインをもらう」で開いたとき、その件だけに印が付く', () => {
    const doneOld = issue('d', '2026-11-04', 1, { status: 'done' });
    const cands = clientConfirmCandidates([issue('t1', '2026-11-12', 1)], [], [doneOld]);
    expect([...initialSelection(cands, 'd')]).toEqual(['d']);
  });
  it('3 つ目を省略すると今までどおり', () => {
    expect(clientConfirmCandidates([], [issue('d', '2026-11-04', 1, { status: 'done' })])).toEqual([]);
  });
});

describe('signTargetFor（後出しの件の完了で、サインをもらいに行けるか）', () => {
  const base = { href: '/sites/s1/reports/2026-11-12/client?issue=i1', reportSaved: true, reportSigned: false, issueConfirmed: false, onThisReport: true, reportIsToday: true };
  it('保存済み・サインなし・確認なし → 行き先', () => {
    expect(signTargetFor(base)).toEqual({ href: base.href, reason: null });
  });
  it('サインをもらえないときは理由（あとでだけ）', () => {
    expect(signTargetFor({ ...base, href: null })).toEqual({ href: null, reason: SIGN_LATER_REASONS.noReport });
    expect(signTargetFor({ ...base, reportSaved: false })).toEqual({ href: null, reason: SIGN_LATER_REASONS.unsaved });
    expect(signTargetFor({ ...base, reportSigned: true })).toEqual({ href: null, reason: SIGN_LATER_REASONS.signed });
    expect(signTargetFor({ ...base, issueConfirmed: true })).toEqual({ href: null, reason: SIGN_LATER_REASONS.confirmed });
  });
  it('ほかの日の件は、今日の日報の画面からだけ（その日の確認画面の候補に入らないため）', () => {
    expect(signTargetFor({ ...base, onThisReport: false, reportIsToday: false })).toEqual({ href: null, reason: SIGN_LATER_REASONS.otherDay });
    expect(signTargetFor({ ...base, onThisReport: false, reportIsToday: true }).href).toBe(base.href);
    expect(signTargetFor({ ...base, onThisReport: true, reportIsToday: false }).href).toBe(base.href);
  });
  it('文言', () => {
    expect(SIGN_LATER_REASONS).toEqual({
      noReport: 'その日の日報の画面からサインをもらえます',
      unsaved: '日報を保存するとサインをもらえます',
      signed: 'この日報にはもうサインがあります',
      confirmed: 'この件はもうお客様の確認（サイン）をもらっています',
      otherDay: '今日の日報の画面からサインをもらえます',
    });
  });
});

describe('initialSelection（初めの印）', () => {
  const cands = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('初めは全部に印', () => {
    expect([...initialSelection(cands)]).toEqual(['a', 'b', 'c']);
    expect([...initialSelection(cands, null)]).toEqual(['a', 'b', 'c']);
  });
  it('「この件の確認をもらう」から開いたときはその件だけ', () => {
    expect([...initialSelection(cands, 'b')]).toEqual(['b']);
  });
  it('候補に無い件を指定されたときは全部', () => {
    expect([...initialSelection(cands, 'zzz')]).toEqual(['a', 'b', 'c']);
  });
  it('候補が無ければ空', () => {
    expect(initialSelection([], 'a').size).toBe(0);
  });
});

describe('件の印・確認画面の URL', () => {
  it('確認が無ければ「未」、あれば「確認済み MM/DD」', () => {
    expect(issueConfirmationLabel(undefined)).toBe('お客様の確認：未');
    expect(issueConfirmationLabel(null)).toBe('お客様の確認：未');
    expect(issueConfirmationLabel({ confirmedOn: '2026-11-06' })).toBe('お客様の確認：確認済み 11/06');
  });
  it('確認画面の URL（件を指定するときは ?issue=）', () => {
    expect(clientConfirmHref('s1', '2026-11-06')).toBe('/sites/s1/reports/2026-11-06/client');
    expect(clientConfirmHref('s1', '2026-11-06', 'i1')).toBe('/sites/s1/reports/2026-11-06/client?issue=i1');
  });
});

describe('longPressProgress（社内の画面に戻る長押し）', () => {
  it('1.5 秒で終わる', () => {
    expect(LONG_PRESS_MS).toBe(1500);
    expect(longPressProgress(0)).toEqual({ progress: 0, done: false });
    expect(longPressProgress(750)).toEqual({ progress: 0.5, done: false });
    expect(longPressProgress(1499).done).toBe(false);
    expect(longPressProgress(1500)).toEqual({ progress: 1, done: true });
    expect(longPressProgress(5000)).toEqual({ progress: 1, done: true });
  });
  it('負・数でない時間は 0 として扱う', () => {
    expect(longPressProgress(-100)).toEqual({ progress: 0, done: false });
    expect(longPressProgress(Number.NaN)).toEqual({ progress: 0, done: false });
  });
  it('長さを指定できる', () => {
    expect(longPressProgress(100, 200)).toEqual({ progress: 0.5, done: false });
  });
});

describe('第 4 段階より前のサイン・件の削除の文言', () => {
  it('サインの件の一覧：記録があればそれ（空でも）、記録の無いサインとサインの無い日報はその日報の件', () => {
    const reportIssueIds = ['r1', 'r2'];
    expect(clientIssueIdsForReport({ signed: true, signedIssueSet: ['o1'], reportIssueIds })).toEqual(['o1']);
    expect(clientIssueIdsForReport({ signed: true, signedIssueSet: [], reportIssueIds })).toEqual([]);
    expect(clientIssueIdsForReport({ signed: true, signedIssueSet: null, reportIssueIds })).toEqual(['r1', 'r2']);
    expect(clientIssueIdsForReport({ signed: false, signedIssueSet: null, reportIssueIds })).toEqual(['r1', 'r2']);
  });
  it('確認を受けた件のある日報は消せない', () => {
    expect(signatureErrorMessage('report_has_confirmed_issue')).toBe(REPORT_CONFIRMED_ISSUE_DELETE_MESSAGE);
  });
  it('お客様の確認を受けた件は消せない', () => {
    expect(issueEditErrorMessage('issue_confirmed', 'delete')).toBe(ISSUE_CONFIRMED_DELETE_MESSAGE);
    expect(ISSUE_CONFIRMED_DELETE_MESSAGE).toBe('お客様の確認を受けた件は消せません');
  });
});
