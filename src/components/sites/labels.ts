import type { SiteRole } from '@/lib/types';

export const ROLE_LABELS: Record<SiteRole, string> = {
  staff: '担当',
  reviewer: '確認',
  approver: '承認',
};

export const STATUS_LABELS = { active: '進行中', done: '完了' } as const;

/** 契約の状態（未確定は概算・見積提示額で扱う）。 */
export const CONTRACT_STATUS_LABELS = { fixed: '確定', tentative: '未確定（概算）' } as const;

/** 管理 → 現場 の絞り込み。削除済みは現場の状態（SITE_STATUSES）ではないので別に持つ。 */
export const LIST_FILTER_LABELS = { active: '進行中', done: '完了', deleted: '削除済み' } as const;
export type ListFilter = keyof typeof LIST_FILTER_LABELS;
