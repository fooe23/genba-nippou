import { describe, expect, it } from 'vitest';
import { countBySite, hideEstimateDates, issueColumns, issueFromRow, type IssueRow } from '@/lib/report/issue-row';

const base: IssueRow = {
  id: 'i1',
  site_id: 's1',
  report_id: 'r1',
  body: '軒先の修繕',
  status: 'estimating',
  done_at: null,
  kind: 'extra',
  instructed_by: null,
  instruction_method: null,
  amount_estimate: null,
  settlement_method: null,
  fixed_amount: null,
  daily_rate: null,
  fixed_on: null,
  estimate_submitted_on: null,
  gn_daily_reports: { report_date: '2026-11-04' },
};

describe('issueColumns', () => {
  it('列があるときだけ estimate_requirement を読む', () => {
    expect(issueColumns(true)).toContain('estimate_requirement');
    expect(issueColumns(false)).not.toContain('estimate_requirement');
    expect(issueColumns(false)).toContain('estimate_submitted_on');
    expect(issueColumns(true).endsWith('gn_daily_reports(report_date)')).toBe(true);
  });
});

describe('issueFromRow', () => {
  it('列なし（SQL の前）：不要・未提出でない', () => {
    const i = issueFromRow(base);
    expect(i.estimateRequirement).toBe('none');
    expect(i.estimatePending).toBe(false);
    expect(i.reportDate).toBe('2026-11-04');
  });
  it('列あり：before・記録なしは未提出', () => {
    const i = issueFromRow({ ...base, estimate_requirement: 'before' });
    expect(i.estimateRequirement).toBe('before');
    expect(i.estimatePending).toBe(true);
  });
  it('記録ありは未提出でない、知らない値は none', () => {
    expect(issueFromRow({ ...base, estimate_requirement: 'after', estimate_submitted_on: '2026-11-06' }).estimatePending).toBe(false);
    expect(issueFromRow({ ...base, estimate_requirement: 'later' }).estimateRequirement).toBe('none');
  });
});

describe('hideEstimateDates（協力会社）', () => {
  it('提出の日は消し、estimatePending と見積書の欄は残す', () => {
    const submitted = issueFromRow({ ...base, estimate_requirement: 'before', estimate_submitted_on: '2026-11-06' });
    const pending = issueFromRow({ ...base, id: 'i2', estimate_requirement: 'after' });
    const [a, b] = hideEstimateDates([submitted, pending]);
    expect(a.estimateSubmittedOn).toBeNull();
    expect(a.estimatePending).toBe(false);
    expect(a.estimateRequirement).toBe('before');
    expect(b.estimatePending).toBe(true);
    expect(b.estimateRequirement).toBe('after');
  });
});

describe('countBySite', () => {
  it('現場ごとに数える', () => {
    expect(countBySite([{ site_id: 'a' }, { site_id: 'b' }, { site_id: 'a' }])).toEqual({ a: 2, b: 1 });
    expect(countBySite([])).toEqual({});
  });
});
