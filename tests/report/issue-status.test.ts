import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstError } from '@/lib/db/masters-schemas';
import { fixRequestReasonSchema, issueStatusPatch, newIssueStatusSchema } from '@/lib/db/issue-schemas';
import { ISSUE_STATUS_LABELS, ISSUE_STATUSES, isIssueStatus, isUnfinishedIssue } from '@/lib/report/change-labels';
import { FIX_REQUEST_DUPLICATE_MESSAGE, fixRequestErrorMessage, reopenErrorMessage, REOPEN_FORBIDDEN_MESSAGE, SITE_CLOSED_MESSAGE } from '@/lib/report/rows';
import { canEditIssueContent, issueEditErrorMessage } from '@/lib/report/issue-status';

// 件の状態（見積中・対応中・完了）、確認者・承認者の承認解除、日報の修正申請。

// ─── Server Action を、DB（supabase）とログインを差し替えて呼ぶ ───
type Result = { data: unknown; error: { message: string } | null };
const db = vi.hoisted(() => ({
  head: null as Result | null,
  write: null as Result | null,
  calls: [] as { table: string; op: string; arg?: unknown }[],
  site: null as Result | null,
  estimateReady: false,
  profile: { id: 'u1', name: '担当', email: '', isAdmin: false, accountType: 'employee', companyName: null } as Record<string, unknown>,
}));

function builder(table: string) {
  let op = 'select';
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['select', 'eq', 'in', 'is', 'order']) b[m] = chain;
  b.update = (arg: unknown) => ((op = 'update'), db.calls.push({ table, op, arg }), b);
  b.insert = (arg: unknown) => ((op = 'insert'), db.calls.push({ table, op, arg }), b);
  b.maybeSingle = () => Promise.resolve(table === 'gn_sites' ? db.site : db.head);
  b.single = () => Promise.resolve(db.write);
  b.then = (resolve: (r: Result | null) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(op === 'select' ? db.head : db.write).then(resolve, reject);
  return b;
}

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/profile', () => ({
  requireProfile: vi.fn(async () => db.profile),
  isEmployeeOrAdmin: (p: { isAdmin: boolean; accountType: string }) => p.isAdmin || p.accountType === 'employee',
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn(async () => ({ from: (t: string) => builder(t) })) }));
vi.mock('@/lib/db/masters', () => ({ listLeaseItems: vi.fn(), listVehicles: vi.fn(), listWorkers: vi.fn() }));
vi.mock('@/lib/db/reports', () => ({ getPreviousReport: vi.fn(), issueEstimateColumnsReady: vi.fn(async () => db.estimateReady) }));
vi.mock('@/lib/db/settings', () => ({ getSettings: vi.fn() }));
vi.mock('@/lib/db/supplier-roles', () => ({ loadSupplierRoles: vi.fn() }));

const { addIssue, reopenReport, requestReportFix, setEstimateRequirement, setEstimateSubmitted, setIssueStatus } = await import('@/lib/db/reports-actions');

const REPORT = '11111111-1111-4111-8111-111111111111';
const ISSUE = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  db.calls = [];
  db.head = { data: { site_id: 's1', report_date: '2026-11-06', status: 'approved' }, error: null };
  db.write = { data: [{ id: REPORT, site_id: 's1', updated_at: '2026-11-06T10:00:00+00:00' }], error: null };
  db.profile = { id: 'u1', name: '担当', email: '', isAdmin: false, accountType: 'employee', companyName: null };
  db.site = null;
  db.estimateReady = false;
});

describe('件の状態', () => {
  it('見積中・対応中・完了の 3 つ。表示名は見積中・対応中・完了', () => {
    expect(ISSUE_STATUSES).toEqual(['estimating', 'open', 'done']);
    expect(ISSUE_STATUS_LABELS).toEqual({ estimating: '見積中', open: '対応中', done: '完了' });
    expect(isIssueStatus('estimating')).toBe(true);
    expect(isIssueStatus('pending')).toBe(false);
  });
  it('見積中と対応中は完了していない件（日報の上の枠に出続ける）', () => {
    expect(isUnfinishedIssue({ status: 'estimating' })).toBe(true);
    expect(isUnfinishedIssue({ status: 'open' })).toBe(true);
    expect(isUnfinishedIssue({ status: 'done' })).toBe(false);
  });
});

describe('issueStatusPatch（setIssueStatus が書く列）', () => {
  it('完了は完了日を入れる。省略すると今日', () => {
    expect(issueStatusPatch('done', undefined, '2026-11-06')).toEqual({ ok: true, patch: { status: 'done', done_at: '2026-11-06' } });
    expect(issueStatusPatch('done', '2026-11-01', '2026-11-06')).toEqual({ ok: true, patch: { status: 'done', done_at: '2026-11-01' } });
  });
  it('見積中・対応中は完了日を消す（完了日の指定は使わない）', () => {
    expect(issueStatusPatch('estimating', undefined, '2026-11-06')).toEqual({ ok: true, patch: { status: 'estimating', done_at: null } });
    expect(issueStatusPatch('open', '2026-11-01', '2026-11-06')).toEqual({ ok: true, patch: { status: 'open', done_at: null } });
  });
  it('3 つ以外の状態・正しくない完了日は日本語の文言で弾く', () => {
    expect(issueStatusPatch('pending', undefined, '2026-11-06')).toEqual({ ok: false, error: '件の状態が正しくありません' });
    expect(issueStatusPatch(true, undefined, '2026-11-06')).toEqual({ ok: false, error: '件の状態が正しくありません' });
    expect(issueStatusPatch('done', '2026/11/01', '2026-11-06')).toEqual({ ok: false, error: '完了日の指定が正しくありません' });
  });
});

describe('newIssueStatusSchema（件を追加するときの状態）', () => {
  it('省略は対応中。見積中か対応中だけ', () => {
    expect(newIssueStatusSchema.parse(undefined)).toBe('open');
    expect(newIssueStatusSchema.parse('estimating')).toBe('estimating');
    expect(newIssueStatusSchema.parse('open')).toBe('open');
    expect(firstError(newIssueStatusSchema, 'done')).toBe('件の状態は見積中か対応中から選んでください');
  });
});

describe('fixRequestReasonSchema（修正申請の理由）', () => {
  it('1〜500 文字（前後の空白は除く）', () => {
    expect(fixRequestReasonSchema.parse('  写真の付け忘れ  ')).toBe('写真の付け忘れ');
    expect(fixRequestReasonSchema.safeParse('あ'.repeat(500)).success).toBe(true);
    expect(firstError(fixRequestReasonSchema, '   ')).toBe('修正の理由を入力してください');
    expect(firstError(fixRequestReasonSchema, undefined)).toBe('修正の理由を入力してください');
    expect(firstError(fixRequestReasonSchema, 'あ'.repeat(501))).toBe('理由は500文字以内で入力してください');
  });
});

describe('reopenErrorMessage・fixRequestErrorMessage', () => {
  it('承認解除の権限なし（not_reviewer / approved_report_locked）は確認者・承認者・管理者の文言', () => {
    expect(reopenErrorMessage('approved_report_locked')).toBe(REOPEN_FORBIDDEN_MESSAGE);
    expect(reopenErrorMessage('not_reviewer')).toBe(REOPEN_FORBIDDEN_MESSAGE);
    expect(REOPEN_FORBIDDEN_MESSAGE).toBe('この現場の確認者・承認者か管理者だけが承認を解除できます');
    expect(reopenErrorMessage('site_closed')).toBe(SITE_CLOSED_MESSAGE);
    expect(reopenErrorMessage('boom')).toBeNull();
  });
  it('修正申請の拒否の理由を文言にする', () => {
    expect(fixRequestErrorMessage('not_report_owner')).toBe('協力会社のアカウントは、自分が作った日報だけ修正を申請できます');
    expect(fixRequestErrorMessage('report_not_submitted')).toBe('修正の申請は、提出済みか承認済みの日報だけ出せます');
    expect(fixRequestErrorMessage('site_closed')).toBe(SITE_CLOSED_MESSAGE);
    expect(fixRequestErrorMessage('duplicate key value violates unique constraint "gn_report_fix_requests_open_uidx"')).toBe(
      FIX_REQUEST_DUPLICATE_MESSAGE,
    );
    // RLS の一般の拒否は協力会社の文言にしない
    expect(fixRequestErrorMessage('new row violates row-level security policy for table "gn_report_fix_requests"')).toBe(
      '修正を申請する権限がありません',
    );
    expect(fixRequestErrorMessage('boom')).toBeNull();
  });
});

describe('reopenReport（承認解除。権限は DB に任せる）', () => {
  it('管理者でなくても DB に下書きへの変更を送る（アプリでは止めない）', async () => {
    const res = await reopenReport(REPORT);
    expect(res).toEqual({ ok: true, updatedAt: '2026-11-06T10:00:00+00:00' });
    expect(db.calls).toEqual([
      { table: 'gn_daily_reports', op: 'update', arg: { status: 'draft', approved_by: null, approved_at: null, reviewed_by: null } },
    ]);
  });
  it('DB が拒否したら（確認者・承認者でない）確認者・承認者・管理者の文言', async () => {
    db.write = { data: null, error: { message: 'approved_report_locked' } };
    expect(await reopenReport(REPORT)).toEqual({ ok: false, error: REOPEN_FORBIDDEN_MESSAGE });
  });
  it('承認済みでない日報は送らない', async () => {
    db.head = { data: { site_id: 's1', report_date: '2026-11-06', status: 'submitted' }, error: null };
    expect(await reopenReport(REPORT)).toEqual({ ok: false, error: '承認済みの日報ではありません' });
    expect(db.calls).toEqual([]);
  });
});

describe('setIssueStatus', () => {
  it('見積中にすると完了日を消して送る', async () => {
    expect(await setIssueStatus(ISSUE, 'estimating')).toEqual({ ok: true });
    expect(db.calls).toEqual([{ table: 'gn_report_issues', op: 'update', arg: { status: 'estimating', done_at: null } }]);
  });
  it('完了日を指定して完了にする', async () => {
    expect(await setIssueStatus(ISSUE, 'done', '2026-11-05')).toEqual({ ok: true });
    expect(db.calls).toEqual([{ table: 'gn_report_issues', op: 'update', arg: { status: 'done', done_at: '2026-11-05' } }]);
  });
  it('正しくない状態は送らない', async () => {
    expect(await setIssueStatus(ISSUE, 'pending' as never)).toEqual({ ok: false, error: '件の状態が正しくありません' });
    expect(db.calls).toEqual([]);
  });
});

describe('addIssue の状態', () => {
  beforeEach(() => {
    db.head = { data: { site_id: 's1', report_date: '2026-11-06' }, error: null };
    db.write = { data: { id: ISSUE }, error: null };
  });
  it('省略は対応中、見積中も選べる', async () => {
    expect(await addIssue(REPORT, '棚の追加')).toEqual({ ok: true, id: ISSUE });
    expect((db.calls[0].arg as { status: string }).status).toBe('open');
    db.calls = [];
    expect(await addIssue(REPORT, '棚の追加', { status: 'estimating' })).toEqual({ ok: true, id: ISSUE });
    expect((db.calls[0].arg as { status: string }).status).toBe('estimating');
  });
  it('完了の件は追加できない', async () => {
    expect(await addIssue(REPORT, '棚の追加', { status: 'done' as never })).toEqual({ ok: false, error: '件の状態は見積中か対応中から選んでください' });
    expect(db.calls).toEqual([]);
  });
});

describe('件の見積書（2026-11-20）', () => {
  const PARTNER = { id: 'u2', name: '職長', email: '', isAdmin: false, accountType: 'partner', companyName: '協力' };
  beforeEach(() => {
    db.head = { data: { site_id: 's1', report_date: '2026-11-06' }, error: null };
    db.write = { data: { id: ISSUE }, error: null };
  });
  it('列が無い（SQL の前）：見積書を送らず今までどおり', async () => {
    expect(await addIssue(REPORT, '棚の追加', { estimateRequirement: 'before' })).toEqual({ ok: true, id: ISSUE });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].arg).not.toHaveProperty('estimate_requirement');
    expect((db.calls[0].arg as { status: string }).status).toBe('open');
  });
  it('必須の現場で社員が作る：既定は要（先に出す）・見積中。やり直しは不要', async () => {
    db.estimateReady = true;
    db.site = { data: { estimate_required: true }, error: null };
    expect(await addIssue(REPORT, '軒先の修繕', { kind: 'extra', status: 'open' })).toEqual({ ok: true, id: ISSUE });
    expect(db.calls[0].arg).toMatchObject({ estimate_requirement: 'before', status: 'estimating' });
    db.calls = [];
    expect(await addIssue(REPORT, '手直し', { kind: 'rework' })).toEqual({ ok: true, id: ISSUE });
    expect(db.calls[0].arg).toMatchObject({ estimate_requirement: 'none', status: 'open' });
  });
  it('協力会社は見積書を送らない（DB が決める）。状態は必須の現場なら見積中', async () => {
    db.estimateReady = true;
    db.site = { data: { estimate_required: true }, error: null };
    db.profile = PARTNER;
    expect(await addIssue(REPORT, '軒先の修繕', { kind: 'extra', estimateRequirement: 'none' })).toEqual({ ok: true, id: ISSUE });
    expect(db.calls[0].arg).not.toHaveProperty('estimate_requirement');
    expect((db.calls[0].arg as { status: string }).status).toBe('estimating');
  });
  it('setIssueStatus：DB の estimate_required_first を社員・協力会社の文言に', async () => {
    db.write = { data: null, error: { message: 'estimate_required_first' } };
    const staff = await setIssueStatus(ISSUE, 'open');
    expect(staff.ok === false && staff.error).toContain('見積書を『要（お客様の指示で先に対応・後出し）』に変えてください');
    db.profile = PARTNER;
    const partner = await setIssueStatus(ISSUE, 'open');
    expect(partner.ok === false && partner.error).toContain('社員が見積提出を記録するまで');
  });
  it('setEstimateRequirement：協力会社・列なしは送らない。社員は送る', async () => {
    db.profile = PARTNER;
    expect(await setEstimateRequirement(ISSUE, 'after')).toEqual({ ok: false, error: '見積書の欄は社員・管理者のアカウントだけが変えられます。' });
    db.profile = { id: 'u1', name: '担当', email: '', isAdmin: false, accountType: 'employee', companyName: null };
    expect(await setEstimateRequirement(ISSUE, 'after')).toEqual({ ok: false, error: 'まだ使えません（管理者に SQL の実行を頼んでください）' });
    expect(await setEstimateRequirement(ISSUE, 'later' as never)).toEqual({ ok: false, error: '見積書の指定が正しくありません' });
    expect(db.calls).toEqual([]);
    db.estimateReady = true;
    db.write = { data: [{ site_id: 's1' }], error: null };
    expect(await setEstimateRequirement(ISSUE, 'after')).toEqual({ ok: true });
    expect(db.calls).toEqual([{ table: 'gn_report_issues', op: 'update', arg: { estimate_requirement: 'after' } }]);
    db.write = { data: null, error: { message: 'estimate_required_first' } };
    const r = await setEstimateRequirement(ISSUE, 'before');
    expect(r.ok === false && r.error).toContain('『要（先に出す）』にできません');
  });
  it('setEstimateSubmitted：要（先に出す）の対応中の件の取り消しは、後出しに変える案内', async () => {
    db.write = { data: null, error: { message: 'estimate_required_first' } };
    const r = await setEstimateSubmitted(ISSUE, null);
    expect(r.ok === false && r.error).toContain('先に見積書を『後出し』に変えてください');
  });
});

describe('requestReportFix', () => {
  it('理由が空なら送らない', async () => {
    expect(await requestReportFix(REPORT, '  ')).toEqual({ ok: false, error: '修正の理由を入力してください' });
    expect(db.calls).toEqual([]);
  });
  it('提出済み・承認済みの日報に理由を付けて出す', async () => {
    db.write = { data: null, error: null };
    expect(await requestReportFix(REPORT, ' 写真の付け忘れ ')).toEqual({ ok: true });
    expect(db.calls).toEqual([
      { table: 'gn_report_fix_requests', op: 'insert', arg: { report_id: REPORT, site_id: 's1', reason: '写真の付け忘れ' } },
    ]);
  });
  it('下書きの日報には出せない', async () => {
    db.head = { data: { site_id: 's1', report_date: '2026-11-06', status: 'draft' }, error: null };
    expect(await requestReportFix(REPORT, '写真')).toEqual({ ok: false, error: '修正の申請は、提出済みか承認済みの日報だけ出せます' });
    expect(db.calls).toEqual([]);
  });
  it('協力会社が他人の日報に出すと DB が拒否し、その文言を返す', async () => {
    db.write = { data: null, error: { message: 'not_report_owner' } };
    expect(await requestReportFix(REPORT, '写真')).toEqual({ ok: false, error: '協力会社のアカウントは、自分が作った日報だけ修正を申請できます' });
  });
  it('未解決の申請がすでにある日報（一意索引 23505）は「すでに修正申請が出ています」', async () => {
    db.write = { data: null, error: { message: 'duplicate key value', code: '23505' } as { message: string } };
    expect(await requestReportFix(REPORT, '写真')).toEqual({ ok: false, error: FIX_REQUEST_DUPLICATE_MESSAGE });
  });
});

describe('canEditIssueContent（この日報の件を直す・消すボタン）', () => {
  const base = { status: 'draft' as const, siteClosed: false, isStaff: true, createdBy: 'u1', currentUserId: 'u2' };
  it('下書き・差戻しの日報だけ。未保存・提出済み・承認済みは出さない', () => {
    expect(canEditIssueContent(base)).toBe(true);
    expect(canEditIssueContent({ ...base, status: 'rejected' })).toBe(true);
    expect(canEditIssueContent({ ...base, status: 'none' })).toBe(false);
    expect(canEditIssueContent({ ...base, status: 'submitted' })).toBe(false);
    expect(canEditIssueContent({ ...base, status: 'approved' })).toBe(false);
  });
  it('完了した現場では出さない', () => {
    expect(canEditIssueContent({ ...base, siteClosed: true })).toBe(false);
  });
  it('協力会社は自分が作った日報だけ', () => {
    expect(canEditIssueContent({ ...base, isStaff: false })).toBe(false);
    expect(canEditIssueContent({ ...base, isStaff: false, createdBy: 'u2' })).toBe(true);
    expect(canEditIssueContent({ ...base, isStaff: false, createdBy: null })).toBe(false);
  });
});

describe('issueEditErrorMessage（件を直す・消すときの DB のエラー）', () => {
  it('ガードの理由ごとの文言。該当しなければ null', () => {
    expect(issueEditErrorMessage('issue_locked', 'update')).toBe('提出した日報の件は直せません（直すときは修正を申請してください）');
    expect(issueEditErrorMessage('issue_locked', 'delete')).toBe('提出した日報の件は消せません（直すときは修正を申請してください）');
    expect(issueEditErrorMessage('issue_in_use', 'delete')).toBe('この件を選んでいる作業内容の行があります。先に行の根拠の件を外してください');
    expect(issueEditErrorMessage('issue_has_attachments', 'delete')).toBe('写真・資料が付いている件は消せません。先に添付を消してください');
    expect(issueEditErrorMessage('issue_not_own', 'update')).toContain('自分が作った日報の件だけ');
    expect(issueEditErrorMessage('report_not_found', 'update')).toBeNull();
  });
});
