import type { IssueKind, IssueStatus } from '@/lib/types';
import type { IssueConfirmation } from '@/lib/report/issue-confirmations';

// お客様用の確認画面（/sites/[siteId]/reports/[date]/client）と件の印「お客様の確認：未／確認済み MM/DD」の純関数（2026-11-13）。

/** 確認画面の候補にする件に要る項目（件番号はその件を書いた日報の中での登録順）。 */
export interface ConfirmCandidateIssue {
  id: string;
  reportDate: string;
  kind: IssueKind;
  status: IssueStatus;
  number: number;
}

/**
 * 確認していただく件の候補：その日報の件（状態は問わない）＋その現場の見積中・対応中の件＋その日に完了にした件
 * （doneOnDate。前の日に書いた後出しの件を今日完了にして、そのままサインをもらうため。2026-11-20）。
 * やり直しの件は除き、同じ件は 1 つ。並びは件を書いた日報の日付 → 件番号。
 */
export function clientConfirmCandidates<T extends ConfirmCandidateIssue>(
  reportIssues: readonly T[],
  openIssues: readonly T[],
  doneOnDate: readonly T[] = [],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (i: T) => {
    if (i.kind === 'rework' || seen.has(i.id)) return;
    seen.add(i.id);
    out.push(i);
  };
  reportIssues.forEach(add);
  openIssues.filter((i) => i.status === 'estimating' || i.status === 'open').forEach(add);
  doneOnDate.forEach(add);
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.number - b.number);
}

/**
 * 初めの印：「この件の確認をもらう」から開いたとき（focusIssueId が候補にあるとき）はその件だけ、それ以外は全部。
 * focusIssueId が候補に無い（完了した・やり直し・ほかの現場の件など）ときは全部に印を付ける。
 */
export function initialSelection(candidates: readonly { id: string }[], focusIssueId?: string | null): Set<string> {
  if (focusIssueId && candidates.some((c) => c.id === focusIssueId)) return new Set([focusIssueId]);
  return new Set(candidates.map((c) => c.id));
}

/** お客様用の確認画面の URL。issueId を付けると、その件だけに印を付けて開く。 */
export function clientConfirmHref(siteId: string, date: string, issueId?: string): string {
  const base = `/sites/${encodeURIComponent(siteId)}/reports/${encodeURIComponent(date)}/client`;
  return issueId ? `${base}?issue=${encodeURIComponent(issueId)}` : base;
}

/** 後出しの件を完了にするとき、サインをもらいに行けない理由（「あとで」だけを出す。2026-11-20）。 */
export const SIGN_LATER_REASONS = {
  /** 現場の画面など、日報が決まらない画面。 */
  noReport: 'その日の日報の画面からサインをもらえます',
  unsaved: '日報を保存するとサインをもらえます',
  signed: 'この日報にはもうサインがあります',
  confirmed: 'この件はもうお客様の確認（サイン）をもらっています',
  /** ほかの日の件を、今日でない日報の画面で完了にしたとき（完了の日が今日になり、その日の確認画面の候補に入らない）。 */
  otherDay: '今日の日報の画面からサインをもらえます',
} as const;

/**
 * 後出しの件を完了にするとき、サインをもらいに行く先（href）か、行けない理由（reason）。
 * href：その日報の確認画面（null は日報が決まらない画面・承認画面）。onThisReport：その日報の件か。
 * ほかの日の件は、確認画面の候補（その日に完了にした件）に入る今日の日報のときだけ行ける。
 */
export function signTargetFor(p: {
  href: string | null;
  reportSaved: boolean;
  /** 日報の入力に保存していない変更がある（確認画面へ行くと消えるので、保存を先に）。省略は false。 */
  unsavedChanges?: boolean;
  reportSigned: boolean;
  issueConfirmed: boolean;
  onThisReport: boolean;
  reportIsToday: boolean;
}): { href: string; reason: null } | { href: null; reason: string } {
  if (p.href === null) return { href: null, reason: SIGN_LATER_REASONS.noReport };
  if (!p.reportSaved || p.unsavedChanges) return { href: null, reason: SIGN_LATER_REASONS.unsaved };
  if (p.reportSigned) return { href: null, reason: SIGN_LATER_REASONS.signed };
  if (p.issueConfirmed) return { href: null, reason: SIGN_LATER_REASONS.confirmed };
  if (!p.onThisReport && !p.reportIsToday) return { href: null, reason: SIGN_LATER_REASONS.otherDay };
  return { href: p.href, reason: null };
}

/** 件の印の文言：「お客様の確認：未」か「お客様の確認：確認済み MM/DD」（取り消されていない確認のうち最新の日付）。 */
export function issueConfirmationLabel(c: Pick<IssueConfirmation, 'confirmedOn'> | null | undefined): string {
  if (!c) return 'お客様の確認：未';
  return `お客様の確認：確認済み ${c.confirmedOn.slice(5).replace('-', '/')}`;
}

/** 「社内の画面に戻る」の長押しの長さ（ミリ秒）。 */
export const LONG_PRESS_MS = 1500;

/**
 * 長押しの進み具合（0〜1）と、終わったか。押し始めてからの時間 elapsedMs で決める（負は 0、duration 以上で終わり）。
 */
export function longPressProgress(elapsedMs: number, durationMs: number = LONG_PRESS_MS): { progress: number; done: boolean } {
  if (!(durationMs > 0)) return { progress: 1, done: true };
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const progress = Math.min(1, t / durationMs);
  return { progress, done: progress >= 1 };
}
