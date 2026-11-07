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
 * 確認していただく件の候補：その日報の件（状態は問わない）＋その現場の見積中・対応中の件。やり直しの件は除き、同じ件は 1 つ。
 * 並びは件を書いた日報の日付 → 件番号。
 */
export function clientConfirmCandidates<T extends ConfirmCandidateIssue>(reportIssues: readonly T[], openIssues: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (i: T) => {
    if (i.kind === 'rework' || seen.has(i.id)) return;
    seen.add(i.id);
    out.push(i);
  };
  reportIssues.forEach(add);
  openIssues.filter((i) => i.status === 'estimating' || i.status === 'open').forEach(add);
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
