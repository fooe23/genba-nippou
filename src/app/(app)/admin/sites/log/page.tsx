import Link from 'next/link';
import { jpDateTime } from '@/lib/calc/format';
import { requireAdmin } from '@/lib/db/profile';
import { listSiteAuditLog, type SiteAuditEntry } from '@/lib/db/sites';
import { AdminNav } from '@/components/accounts/AdminNav';
import { EmptyText } from '@/components/masters/common';

export const metadata = { title: '現場の削除ログ' };

const ACTION_LABELS: Record<SiteAuditEntry['action'], string> = { archive: '削除', restore: '復元' };
const ACTION_COLORS: Record<SiteAuditEntry['action'], string> = {
  archive: 'border-red-400 bg-red-50 text-red-900 dark:border-red-600 dark:bg-red-950 dark:text-red-50',
  restore: 'border-green-400 bg-green-50 text-green-900 dark:border-green-600 dark:bg-green-950 dark:text-green-50',
};

function actor(e: SiteAuditEntry): string {
  if (e.actorName && e.actorEmail) return `${e.actorName}（${e.actorEmail}）`;
  return e.actorName || e.actorEmail || '（不明）';
}

export default async function SiteAuditLogPage() {
  await requireAdmin();
  const entries = await listSiteAuditLog();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <AdminNav current="sites" />
      <Link href="/admin/sites" className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← 現場一覧
      </Link>
      <h1 className="mb-1 text-xl font-bold">現場の削除ログ</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        誰が・いつ・どの現場を削除（復元）したかの記録です。新しい順に最大200件まで表示します。
      </p>

      {entries.length === 0 ? (
        <EmptyText>削除・復元の記録はありません。</EmptyText>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-gray-300 p-3 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`rounded border px-2 py-0.5 text-sm font-bold ${ACTION_COLORS[e.action]}`}>
                  {ACTION_LABELS[e.action]}
                </span>
                <span className="text-sm tabular-nums">{jpDateTime(e.createdAt)}</span>
              </div>
              <p className="mt-1 break-words font-bold">{e.siteName}</p>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-sm">
                <dt className="text-gray-600 dark:text-gray-400">実行者</dt>
                <dd className="min-w-0 break-words">{actor(e)}</dd>
                <dt className="text-gray-600 dark:text-gray-400">理由</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words">{e.reason ?? '（なし）'}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
