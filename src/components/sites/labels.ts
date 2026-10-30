import type { SiteRole } from '@/lib/types';

export const ROLE_LABELS: Record<SiteRole, string> = {
  staff: '担当',
  reviewer: '確認',
  approver: '承認',
};

export const STATUS_LABELS = { active: '進行中', done: '完了' } as const;
