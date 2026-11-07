import { describe, expect, it } from 'vitest';
import {
  clientSignatureSchema,
  confirmIssueIdsSchema,
  INVALID_ISSUE_MESSAGE,
  MAX_CONFIRM_ISSUES,
  signatureErrorMessage,
  TOO_MANY_ISSUES_MESSAGE,
} from '@/lib/report/client-signature';
import { CLIENT_ISSUE_STATUS_LABELS } from '@/lib/report/change-labels';
import { latestConfirmations, type IssueConfirmationRow } from '@/lib/report/issue-confirmations';

const SITE = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const SIGN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('確認していただく件の id（saveClientSignature の issueIds）', () => {
  const base = { confirmedBy: '施主様', note: '', signaturePath: `${SITE}/sign/${SIGN_ID}.png` };

  it('渡さなければ空。uuid は小文字にそろえ、重複を除く（最初に出た順）', () => {
    expect(clientSignatureSchema.parse(base).issueIds).toEqual([]);
    const upper = id(2).toUpperCase();
    expect(clientSignatureSchema.parse({ ...base, issueIds: [id(1), upper, id(1), id(2)] }).issueIds).toEqual([id(1), id(2)]);
  });

  it('uuid でない値・null は断る', () => {
    for (const bad of [['abc'], [null], [`${id(1)} `], 'x', [1]]) {
      expect(confirmIssueIdsSchema.safeParse(bad).error?.issues[0].message).toBe(INVALID_ISSUE_MESSAGE);
    }
  });

  it('重複を除いて 50 件まで', () => {
    const fifty = Array.from({ length: MAX_CONFIRM_ISSUES }, (_, i) => id(i + 1));
    expect(confirmIssueIdsSchema.parse([...fifty, ...fifty])).toHaveLength(50);
    expect(confirmIssueIdsSchema.safeParse([...fifty, id(51)]).error?.issues[0].message).toBe(TOO_MANY_ISSUES_MESSAGE);
    expect(TOO_MANY_ISSUES_MESSAGE).toBe('確認していただく件は 50 件までです');
  });

  it('DB の invalid_issue は件を選び直す文言', () => {
    expect(signatureErrorMessage('invalid_issue')).toBe(INVALID_ISSUE_MESSAGE);
  });
});

describe('件の状態のお客様向けの表示名', () => {
  it('見積中＝お見積り中・対応中・完了', () => {
    expect(CLIENT_ISSUE_STATUS_LABELS).toEqual({ estimating: 'お見積り中', open: '対応中', done: '完了' });
  });
});

describe('件ごとの最新のお客様確認（latestConfirmations）', () => {
  const row = (over: Partial<IssueConfirmationRow> & { issue_id: string }): IssueConfirmationRow => ({
    confirmed_on: '2026-11-06',
    confirmed_by: '施主様',
    signed_at: '2026-11-06T08:00:00+00:00',
    revoked_at: null,
    ...over,
  });

  it('取り消していない確認のうち、確認した日が新しいもの（同じ日ならサインした日時が新しいもの）', () => {
    const m = latestConfirmations([
      row({ issue_id: 'a', confirmed_on: '2026-11-04', confirmed_by: '古い' }),
      row({ issue_id: 'a', confirmed_on: '2026-11-06', confirmed_by: '新しい' }),
      row({ issue_id: 'a', confirmed_on: '2026-11-08', confirmed_by: '取り消し', revoked_at: '2026-11-09T00:00:00Z' }),
      row({ issue_id: 'b', confirmed_on: '2026-11-06', confirmed_by: '朝', signed_at: '2026-11-06T00:00:00Z' }),
      row({ issue_id: 'b', confirmed_on: '2026-11-06', confirmed_by: '夕方', signed_at: '2026-11-06T09:00:00Z' }),
      row({ issue_id: 'c', revoked_at: '2026-11-07T00:00:00Z' }),
    ]);
    expect(Object.fromEntries(m)).toEqual({
      a: { confirmedOn: '2026-11-06', confirmedBy: '新しい' },
      b: { confirmedOn: '2026-11-06', confirmedBy: '夕方' },
    });
  });
});
