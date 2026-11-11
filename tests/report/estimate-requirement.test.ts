import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_REQUIREMENTS,
  ESTIMATE_REQUIREMENT_LABELS,
  ESTIMATE_CLEAR_BLOCKED_MESSAGE,
  ESTIMATE_REQUIRED_FIRST_MESSAGE,
  ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE,
  blockedEstimateClear,
  blockedRequirementChange,
  blockedStatusChange,
  daysSinceRequest,
  defaultEstimateRequirement,
  estimatePendingBadge,
  estimatePendingCountLabel,
  estimateRequirementErrorMessage,
  estimateRequirementSchema,
  isEstimatePending,
  isEstimateRequirement,
  newIssueStatusFor,
  newIssueFormDefaults,
  planNewIssueEstimate,
  statusBlockFor,
  shouldOfferSignature,
} from '@/lib/report/estimate-requirement';

describe('見積書の値', () => {
  it('3 つの値と表示名', () => {
    expect(ESTIMATE_REQUIREMENTS).toEqual(['before', 'after', 'none']);
    expect(ESTIMATE_REQUIREMENT_LABELS).toEqual({
      before: '要（先に出す）',
      after: '要（お客様の指示で先に対応・後出し）',
      none: '不要',
    });
    expect(isEstimateRequirement('after')).toBe(true);
    expect(isEstimateRequirement('later')).toBe(false);
    expect(isEstimateRequirement(null)).toBe(false);
    expect(estimateRequirementSchema.safeParse('before').success).toBe(true);
    expect(estimateRequirementSchema.safeParse('later').success).toBe(false);
  });
});

describe('defaultEstimateRequirement（新しい件の既定）', () => {
  it('必須の現場はやり直し以外 before、やり直しは none', () => {
    expect(defaultEstimateRequirement(true)).toBe('before');
    expect(defaultEstimateRequirement(true, 'extra')).toBe('before');
    expect(defaultEstimateRequirement(true, 'client_delay')).toBe('before');
    expect(defaultEstimateRequirement(true, null)).toBe('before');
    expect(defaultEstimateRequirement(true, 'rework')).toBe('none');
  });
  it('必須でない現場は種別に関係なく none', () => {
    expect(defaultEstimateRequirement(false)).toBe('none');
    expect(defaultEstimateRequirement(false, 'extra')).toBe('none');
    expect(defaultEstimateRequirement(false, 'rework')).toBe('none');
  });
});

describe('isEstimatePending', () => {
  it('要（before・after）で提出の日が無いとき', () => {
    expect(isEstimatePending({ estimateRequirement: 'before', estimateSubmittedOn: null })).toBe(true);
    expect(isEstimatePending({ estimateRequirement: 'after', estimateSubmittedOn: null })).toBe(true);
    expect(isEstimatePending({ estimateRequirement: 'before', estimateSubmittedOn: '2026-11-06' })).toBe(false);
    expect(isEstimatePending({ estimateRequirement: 'none', estimateSubmittedOn: null })).toBe(false);
  });
});

describe('blockedStatusChange（状態の止め）', () => {
  const before = { estimateRequirement: 'before' as const, estimateSubmittedOn: null };
  it('before・未提出：対応中・完了へは止める', () => {
    expect(blockedStatusChange({ ...before, status: 'estimating' }, 'open')).toBe('estimate_required_first');
    expect(blockedStatusChange({ ...before, status: 'estimating' }, 'done')).toBe('estimate_required_first');
    expect(blockedStatusChange({ ...before, status: 'open' }, 'done')).toBe('estimate_required_first');
  });
  it('見積中のままは止めない', () => {
    expect(blockedStatusChange({ ...before, status: 'estimating' }, 'estimating')).toBeNull();
  });
  it('提出済み・after・none は止めない', () => {
    expect(blockedStatusChange({ ...before, estimateSubmittedOn: '2026-11-06', status: 'estimating' }, 'open')).toBeNull();
    expect(blockedStatusChange({ estimateRequirement: 'after', estimateSubmittedOn: null, status: 'estimating' }, 'done')).toBeNull();
    expect(blockedStatusChange({ estimateRequirement: 'none', estimateSubmittedOn: null, status: 'estimating' }, 'open')).toBeNull();
  });
});

describe('blockedRequirementChange（見積書の欄の変更）', () => {
  it('対応中・完了で未提出の件を before にするのは止める', () => {
    expect(blockedRequirementChange({ status: 'open', estimateSubmittedOn: null }, 'before')).toBe('estimate_required_first');
    expect(blockedRequirementChange({ status: 'done', estimateSubmittedOn: null }, 'before')).toBe('estimate_required_first');
  });
  it('見積中・提出済み・before 以外は止めない', () => {
    expect(blockedRequirementChange({ status: 'estimating', estimateSubmittedOn: null }, 'before')).toBeNull();
    expect(blockedRequirementChange({ status: 'open', estimateSubmittedOn: '2026-11-06' }, 'before')).toBeNull();
    expect(blockedRequirementChange({ status: 'open', estimateSubmittedOn: null }, 'after')).toBeNull();
    expect(blockedRequirementChange({ status: 'done', estimateSubmittedOn: null }, 'none')).toBeNull();
  });
});

describe('blockedEstimateClear（見積提出の記録の取り消し）', () => {
  it('before の対応中・完了は止める', () => {
    expect(blockedEstimateClear({ estimateRequirement: 'before', status: 'open' })).toBe(true);
    expect(blockedEstimateClear({ estimateRequirement: 'before', status: 'done' })).toBe(true);
  });
  it('before の見積中・after・none は止めない', () => {
    expect(blockedEstimateClear({ estimateRequirement: 'before', status: 'estimating' })).toBe(false);
    expect(blockedEstimateClear({ estimateRequirement: 'after', status: 'done' })).toBe(false);
    expect(blockedEstimateClear({ estimateRequirement: 'none', status: 'open' })).toBe(false);
  });
});

describe('newIssueStatusFor（新しい件の状態）', () => {
  it('before は常に見積中', () => {
    expect(newIssueStatusFor('before', 'open')).toBe('estimating');
    expect(newIssueStatusFor('before', undefined)).toBe('estimating');
    expect(newIssueStatusFor('before', 'estimating')).toBe('estimating');
  });
  it('after・none は渡したまま（省略は対応中）', () => {
    expect(newIssueStatusFor('after', 'open')).toBe('open');
    expect(newIssueStatusFor('none', 'estimating')).toBe('estimating');
    expect(newIssueStatusFor('none', undefined)).toBe('open');
  });
});

describe('daysSinceRequest（依頼から N 日）', () => {
  it('同じ日は 0、日の差', () => {
    expect(daysSinceRequest('2026-11-04', '2026-11-04')).toBe(0);
    expect(daysSinceRequest('2026-11-04', '2026-11-06')).toBe(2);
  });
  it('月・年をまたぐ', () => {
    expect(daysSinceRequest('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysSinceRequest('2026-12-30', '2027-01-02')).toBe(3);
  });
  it('今日より後の依頼日は 0', () => {
    expect(daysSinceRequest('2026-11-10', '2026-11-06')).toBe(0);
  });
});

describe('estimatePendingBadge（赤い印）', () => {
  it('before 未提出 →「必須の見積書が未提出」', () => {
    expect(
      estimatePendingBadge({ estimateRequirement: 'before', estimatePending: true, reportDate: '2026-11-04' }, '2026-11-06'),
    ).toEqual({ tone: 'red', label: '必須の見積書が未提出', days: 2, daysLabel: '依頼から 2 日' });
  });
  it('after 未提出 →「見積書が未提出（後出し）」、当日は「依頼の当日」', () => {
    expect(
      estimatePendingBadge({ estimateRequirement: 'after', estimatePending: true, reportDate: '2026-11-12' }, '2026-11-12'),
    ).toEqual({ tone: 'red', label: '見積書が未提出（後出し）', days: 0, daysLabel: '依頼の当日' });
  });
  it('none・提出済みは null', () => {
    expect(estimatePendingBadge({ estimateRequirement: 'none', estimatePending: false, reportDate: '2026-11-04' }, '2026-11-06')).toBeNull();
    expect(estimatePendingBadge({ estimateRequirement: 'before', estimatePending: false, reportDate: '2026-11-04' }, '2026-11-06')).toBeNull();
  });
});

describe('shouldOfferSignature（完了でサインを勧める）', () => {
  const base = { requirement: 'after' as const, next: 'done' as const, current: 'open' as const, kind: 'extra' as const };
  it('後出し・完了へ・やり直しでない', () => {
    expect(shouldOfferSignature({ ...base, canSign: true })).toBe('offer');
    expect(shouldOfferSignature({ ...base, canSign: false })).toBe('later_only');
  });
  it('ほかは出さない', () => {
    expect(shouldOfferSignature({ ...base, requirement: 'before', canSign: true })).toBe('no');
    expect(shouldOfferSignature({ ...base, requirement: 'none', canSign: true })).toBe('no');
    expect(shouldOfferSignature({ ...base, kind: 'rework', canSign: true })).toBe('no');
    expect(shouldOfferSignature({ ...base, current: 'done', canSign: true })).toBe('no');
    expect(shouldOfferSignature({ ...base, next: 'open', canSign: true })).toBe('no');
  });
});

describe('estimateRequirementErrorMessage', () => {
  it('estimate_required_first を操作ごとの文言に', () => {
    expect(estimateRequirementErrorMessage('estimate_required_first', 'status', true)).toBe(ESTIMATE_REQUIRED_FIRST_MESSAGE);
    expect(estimateRequirementErrorMessage('estimate_required_first', 'status', false)).toBe(ESTIMATE_REQUIRED_FIRST_PARTNER_MESSAGE);
    expect(estimateRequirementErrorMessage('estimate_required_first', 'clear', true)).toBe(ESTIMATE_CLEAR_BLOCKED_MESSAGE);
    expect(estimateRequirementErrorMessage('estimate_required_first', 'requirement', true)).toContain('対応中・完了');
    expect(estimateRequirementErrorMessage('other error', 'status', true)).toBeNull();
  });
});

describe('planNewIssueEstimate（件を作るときの見積書と状態）', () => {
  it('列が無い（SQL の前）：見積書を送らず、状態は渡したまま', () => {
    expect(planNewIssueEstimate({ ready: false, isStaff: true, siteRequired: true, kind: 'extra', requested: 'before', status: 'open' })).toEqual({
      send: null,
      status: 'open',
    });
  });
  it('社員：渡した値（省略は現場の既定と種別）を送り、要（先に出す）なら見積中', () => {
    expect(planNewIssueEstimate({ ready: true, isStaff: true, siteRequired: true, kind: 'extra', requested: undefined, status: 'open' })).toEqual({
      send: 'before',
      status: 'estimating',
    });
    expect(planNewIssueEstimate({ ready: true, isStaff: true, siteRequired: true, kind: 'rework', requested: undefined, status: 'open' })).toEqual({
      send: 'none',
      status: 'open',
    });
    expect(planNewIssueEstimate({ ready: true, isStaff: true, siteRequired: true, kind: 'extra', requested: 'after', status: 'open' })).toEqual({
      send: 'after',
      status: 'open',
    });
    expect(planNewIssueEstimate({ ready: true, isStaff: true, siteRequired: false, kind: 'extra', requested: 'before', status: 'open' })).toEqual({
      send: 'before',
      status: 'estimating',
    });
  });
  it('協力会社：見積書は送らない（DB が決める）。状態は現場の既定と種別で決める', () => {
    expect(planNewIssueEstimate({ ready: true, isStaff: false, siteRequired: true, kind: 'extra', requested: 'after', status: 'open' })).toEqual({
      send: null,
      status: 'estimating',
    });
    expect(planNewIssueEstimate({ ready: true, isStaff: false, siteRequired: true, kind: 'rework', requested: undefined, status: 'open' })).toEqual({
      send: null,
      status: 'open',
    });
  });
});

describe('statusBlockFor（画面：協力会社は提出の日が来ないので未提出かどうかで判定）', () => {
  it('before・未提出は対応中・完了を止める。提出済み・after は止めない', () => {
    expect(statusBlockFor({ estimateRequirement: 'before', estimatePending: true, status: 'estimating' }, 'open')).toBe('estimate_required_first');
    expect(statusBlockFor({ estimateRequirement: 'before', estimatePending: true, status: 'estimating' }, 'estimating')).toBeNull();
    expect(statusBlockFor({ estimateRequirement: 'before', estimatePending: false, status: 'estimating' }, 'done')).toBeNull();
    expect(statusBlockFor({ estimateRequirement: 'after', estimatePending: true, status: 'estimating' }, 'done')).toBeNull();
  });
});

describe('newIssueFormDefaults（件の追加の欄）', () => {
  it('列なし：見積書を出さない・状態は見積中／対応中', () => {
    expect(newIssueFormDefaults({ ready: false, isStaff: true, siteRequired: true, kind: 'extra', chosen: null })).toEqual({
      mode: 'hidden',
      requirement: 'none',
      statusChoices: ['estimating', 'open'],
    });
  });
  it('必須の現場・社員：既定は before で状態は見積中だけ。やり直しは none', () => {
    expect(newIssueFormDefaults({ ready: true, isStaff: true, siteRequired: true, kind: 'extra', chosen: null })).toEqual({
      mode: 'select',
      requirement: 'before',
      statusChoices: ['estimating'],
    });
    expect(newIssueFormDefaults({ ready: true, isStaff: true, siteRequired: true, kind: 'rework', chosen: null }).requirement).toBe('none');
  });
  it('社員が選んだ値はそのまま（後出しなら対応中も選べる）', () => {
    expect(newIssueFormDefaults({ ready: true, isStaff: true, siteRequired: true, kind: 'extra', chosen: 'after' })).toEqual({
      mode: 'select',
      requirement: 'after',
      statusChoices: ['estimating', 'open'],
    });
  });
  it('必須でない現場・社員：none', () => {
    expect(newIssueFormDefaults({ ready: true, isStaff: true, siteRequired: false, kind: 'extra', chosen: null }).requirement).toBe('none');
  });
  it('協力会社：選べず、現場の設定と種別の表示だけ（選んだ値は無視）', () => {
    expect(newIssueFormDefaults({ ready: true, isStaff: false, siteRequired: true, kind: 'extra', chosen: 'after' })).toEqual({
      mode: 'display',
      requirement: 'before',
      statusChoices: ['estimating'],
    });
  });
});

describe('estimatePendingCountLabel（ホーム・管理者の現場の一覧）', () => {
  it('0 件・未定は出さない', () => {
    expect(estimatePendingCountLabel(0)).toBeNull();
    expect(estimatePendingCountLabel(undefined)).toBeNull();
    expect(estimatePendingCountLabel(3)).toBe('見積が未提出の件 3 件');
  });
});
