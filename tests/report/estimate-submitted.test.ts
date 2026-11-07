import { describe, expect, it } from 'vitest';
import {
  canClearEstimateSubmitted,
  canRecordEstimateSubmitted,
  estimateBadges,
  estimateSubmittedOnSchema,
} from '@/lib/report/estimate-submitted';

const staff = { isStaff: true, siteClosed: false };

describe('estimateBadges（件の見積の印。社員・管理者だけ）', () => {
  it('ファイルあり →「見積書あり」。提出の記録もあれば「提出 MM/DD」も並べる', () => {
    expect(estimateBadges({ hasFile: true, estimateSubmittedOn: null, status: 'estimating', isStaff: true })).toEqual([
      { kind: 'file', label: '見積書あり' },
    ]);
    expect(estimateBadges({ hasFile: true, estimateSubmittedOn: '2026-11-08', status: 'open', isStaff: true })).toEqual([
      { kind: 'file', label: '見積書あり' },
      { kind: 'submitted', label: '提出 11/08' },
    ]);
  });

  it('ファイルなし・提出の記録あり →「見積提出 MM/DD」（見積中でも「見積書なし」は出さない）', () => {
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: '2026-12-01', status: 'estimating', isStaff: true })).toEqual([
      { kind: 'submitted', label: '見積提出 12/01' },
    ]);
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: '2026-12-01', status: 'done', isStaff: true })).toEqual([
      { kind: 'submitted', label: '見積提出 12/01' },
    ]);
  });

  it('どちらも無い：見積中なら「見積書なし」、対応中・完了なら印なし', () => {
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: null, status: 'estimating', isStaff: true })).toEqual([
      { kind: 'missing', label: '見積書なし' },
    ]);
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: null, status: 'open', isStaff: true })).toEqual([]);
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: null, status: 'done', isStaff: true })).toEqual([]);
  });

  it('協力会社には何も出さない', () => {
    expect(estimateBadges({ hasFile: true, estimateSubmittedOn: '2026-11-08', status: 'estimating', isStaff: false })).toEqual([]);
    expect(estimateBadges({ hasFile: false, estimateSubmittedOn: null, status: 'estimating', isStaff: false })).toEqual([]);
  });
});

describe('記録・取り消しのボタン', () => {
  it('記録：社員・管理者で、完了現場でなく、記録が無く、件が完了していないとき', () => {
    expect(canRecordEstimateSubmitted({ status: 'estimating', estimateSubmittedOn: null }, staff)).toBe(true);
    expect(canRecordEstimateSubmitted({ status: 'open', estimateSubmittedOn: null }, staff)).toBe(true);
    expect(canRecordEstimateSubmitted({ status: 'done', estimateSubmittedOn: null }, staff)).toBe(false);
    expect(canRecordEstimateSubmitted({ status: 'open', estimateSubmittedOn: '2026-11-08' }, staff)).toBe(false);
    expect(canRecordEstimateSubmitted({ status: 'open', estimateSubmittedOn: null }, { isStaff: false, siteClosed: false })).toBe(false);
    expect(canRecordEstimateSubmitted({ status: 'open', estimateSubmittedOn: null }, { isStaff: true, siteClosed: true })).toBe(false);
  });

  it('取り消し：社員・管理者で、完了現場でなく、記録があるとき（件が完了していても）', () => {
    expect(canClearEstimateSubmitted({ estimateSubmittedOn: '2026-11-08' }, staff)).toBe(true);
    expect(canClearEstimateSubmitted({ estimateSubmittedOn: null }, staff)).toBe(false);
    expect(canClearEstimateSubmitted({ estimateSubmittedOn: '2026-11-08' }, { isStaff: false, siteClosed: false })).toBe(false);
    expect(canClearEstimateSubmitted({ estimateSubmittedOn: '2026-11-08' }, { isStaff: true, siteClosed: true })).toBe(false);
  });
});

describe('estimateSubmittedOnSchema', () => {
  it('YYYY-MM-DD の正しい日付か null だけ通す', () => {
    expect(estimateSubmittedOnSchema.parse('2026-11-08')).toBe('2026-11-08');
    expect(estimateSubmittedOnSchema.parse(null)).toBeNull();
    for (const bad of ['2026-02-30', '2026/11/08', '', undefined, 20261108]) {
      expect(estimateSubmittedOnSchema.safeParse(bad).success).toBe(false);
    }
  });
});
