// 件ごとのお客様確認（gn_issue_client_confirmations）の読み取りの形と、件ごとの最新の確認を選ぶ純関数。
// 行を入れる・取り消すのは DB の gn_save_client_signature / gn_revoke_client_signature だけ（2026-11-13）。

/** 件の印「お客様の確認：確認済み MM/DD」に使う、件ごとの最新の確認。 */
export interface IssueConfirmation {
  /** 確認していただいた日（その日報の日付。YYYY-MM-DD）。 */
  confirmedOn: string;
  confirmedBy: string;
}

/** gn_issue_client_confirmations の読む列。 */
export interface IssueConfirmationRow {
  issue_id: string;
  confirmed_on: string;
  confirmed_by: string;
  signed_at: string;
  revoked_at: string | null;
}

export const ISSUE_CONFIRMATION_COLUMNS = 'issue_id, confirmed_on, confirmed_by, signed_at, revoked_at';

/**
 * 件ごとの最新の確認（取り消された行は除く）。最新＝確認した日（日報の日付）が新しいもの、同じ日ならサインした日時が新しいもの。
 * 確認の無い件はキーが無い。
 */
export function latestConfirmations(rows: readonly IssueConfirmationRow[]): Map<string, IssueConfirmation> {
  const best = new Map<string, IssueConfirmationRow>();
  for (const r of rows) {
    if (r.revoked_at !== null) continue;
    const cur = best.get(r.issue_id);
    if (
      !cur ||
      r.confirmed_on > cur.confirmed_on ||
      (r.confirmed_on === cur.confirmed_on && Date.parse(r.signed_at) > Date.parse(cur.signed_at))
    ) {
      best.set(r.issue_id, r);
    }
  }
  return new Map([...best].map(([id, r]) => [id, { confirmedOn: r.confirmed_on, confirmedBy: r.confirmed_by }]));
}
