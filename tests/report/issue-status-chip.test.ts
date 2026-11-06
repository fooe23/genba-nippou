import { describe, expect, it } from 'vitest';
import { ISSUE_STATUS_LABELS, ISSUE_STATUSES } from '@/lib/report/change-labels';
import {
  canRequestReportFix,
  canReviewSite,
  ISSUE_STATUS_CHIP_CLASS,
  issueStatusLabel,
  issueStatusOrder,
  issueStatusTone,
  sortIssuesByStatus,
} from '@/lib/report/issue-status';

// 件の状態の札（表示名・色・並び）と、承認解除・修正申請のボタンを出すかの判定。

describe('件の状態の札', () => {
  it('表示名は 見積中・対応中・完了（ISSUE_STATUS_LABELS と同じ）', () => {
    expect(issueStatusLabel('estimating')).toBe('見積中');
    expect(issueStatusLabel('open')).toBe('対応中');
    expect(issueStatusLabel('done')).toBe('完了');
    for (const s of ISSUE_STATUSES) expect(issueStatusLabel(s)).toBe(ISSUE_STATUS_LABELS[s]);
  });

  it('色は 見積中＝紫・対応中＝青・完了＝緑', () => {
    expect(issueStatusTone('estimating')).toBe('purple');
    expect(issueStatusTone('open')).toBe('blue');
    expect(issueStatusTone('done')).toBe('green');
    expect(ISSUE_STATUS_CHIP_CLASS.estimating).toContain('purple');
    expect(ISSUE_STATUS_CHIP_CLASS.open).toContain('blue');
    expect(ISSUE_STATUS_CHIP_CLASS.done).toContain('green');
  });

  it('並びの順位は 見積中 → 対応中 → 完了', () => {
    expect(issueStatusOrder('estimating')).toBeLessThan(issueStatusOrder('open'));
    expect(issueStatusOrder('open')).toBeLessThan(issueStatusOrder('done'));
  });

  it('見積中を先に、同じ状態の中は渡した並び（件番号順）のまま', () => {
    const issues = [
      { id: 'a', status: 'open' as const },
      { id: 'b', status: 'estimating' as const },
      { id: 'c', status: 'open' as const },
      { id: 'd', status: 'estimating' as const },
      { id: 'e', status: 'done' as const },
    ];
    const sorted = sortIssuesByStatus(issues);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c', 'e']);
    // 元の並びは変えない
    expect(issues.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('空の一覧は空のまま', () => {
    expect(sortIssuesByStatus([])).toEqual([]);
  });
});

describe('承認解除のボタン（確認者・承認者・管理者）', () => {
  it('管理者はどの役割でも出す', () => {
    expect(canReviewSite(true, null)).toBe(true);
    expect(canReviewSite(true, 'staff')).toBe(true);
  });
  it('確認者・承認者には出し、担当・メンバー外には出さない', () => {
    expect(canReviewSite(false, 'reviewer')).toBe(true);
    expect(canReviewSite(false, 'approver')).toBe(true);
    expect(canReviewSite(false, 'staff')).toBe(false);
    expect(canReviewSite(false, null)).toBe(false);
  });
});

describe('修正を申請のボタン', () => {
  const base = {
    status: 'submitted' as const,
    siteClosed: false,
    isAdmin: false,
    accountType: 'employee' as const,
    createdBy: 'other',
    currentUserId: 'me',
  };
  it('提出済み・承認済みのときだけ出す', () => {
    expect(canRequestReportFix(base)).toBe(true);
    expect(canRequestReportFix({ ...base, status: 'approved' })).toBe(true);
    expect(canRequestReportFix({ ...base, status: 'draft' })).toBe(false);
    expect(canRequestReportFix({ ...base, status: 'rejected' })).toBe(false);
    expect(canRequestReportFix({ ...base, status: 'none' })).toBe(false);
  });
  it('完了した現場では出さない', () => {
    expect(canRequestReportFix({ ...base, siteClosed: true })).toBe(false);
  });
  it('社員・管理者はだれの日報でも、協力会社は自分の日報だけ', () => {
    expect(canRequestReportFix({ ...base, isAdmin: true, accountType: 'partner' })).toBe(true);
    expect(canRequestReportFix({ ...base, accountType: 'partner' })).toBe(false);
    expect(canRequestReportFix({ ...base, accountType: 'partner', createdBy: 'me' })).toBe(true);
    expect(canRequestReportFix({ ...base, accountType: 'partner', createdBy: null })).toBe(false);
  });
});
