import { withIssueTag } from '@/lib/report/change-labels';
import type { PurchaseKind } from '@/lib/types';

// 買掛の区分（仕入・外注。2026-11-17）の表示と入力の可否（純関数。画面・サーバー・帳票から使う）。

export const PURCHASE_KIND_LABELS: Record<PurchaseKind, string> = { material: '仕入', subcontract: '外注' };

export const MSG_SUBCONTRACT_STAFF_ONLY = '外注の買掛は社員だけが入力できます';
export const MSG_SUBCONTRACT_NOT_READY =
  '外注の買掛は、データベースの更新（update_2026-11-17_subcontract.sql）の後に使えます。管理者に確認してください';

/**
 * 外注の買掛の行を保存してよいか。協力会社のアカウントは外注の行を入れられない（RLS でも断る）。
 * DB に区分の列が無い（SQL の前）ときは、外注の行が黙って仕入として保存されないよう止める。
 */
export function subcontractInputError(
  lines: readonly { kind: string; purchaseKind?: PurchaseKind }[],
  opts: { isStaff: boolean; ready: boolean },
): string | null {
  if (!lines.some((l) => l.kind === 'credit' && l.purchaseKind === 'subcontract')) return null;
  if (!opts.isStaff) return MSG_SUBCONTRACT_STAFF_ONLY;
  if (!opts.ready) return MSG_SUBCONTRACT_NOT_READY;
  return null;
}

/**
 * 帳票の買掛の品名：外注の行は頭に【外注・工種名】（工種が無ければ【外注】）。仕入の行はそのまま。
 * 根拠の件を選んだ行（2026-11-20）は件の区分（issueTag。issueTagLabel）も付ける：外注は【外注・タイル・増】、仕入は【増】。
 */
export function creditItemLabel(
  line: { itemName: string; purchaseKind: PurchaseKind },
  tradeName: string | null,
  issueTag: string | null = null,
): string {
  if (line.purchaseKind !== 'subcontract') return withIssueTag(issueTag, line.itemName);
  return withIssueTag(['外注', tradeName, issueTag].filter((v): v is string => !!v).join('・'), line.itemName);
}
