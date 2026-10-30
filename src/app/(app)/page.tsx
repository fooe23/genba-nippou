import Link from 'next/link';
import { todayJst } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { listTodayStatus } from '@/lib/db/reports';
import { listMySites } from '@/lib/db/sites';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from '@/components/site/status';

export const metadata = { title: 'ホーム' };

export default async function HomePage() {
  await requireProfile();
  const sites = (await listMySites()).filter((s) => s.status === 'active');
  const today = todayJst();
  const statuses = await listTodayStatus(
    sites.map((s) => s.id),
    today,
  );
  // 未入力 → 下書き → 差戻し → 提出済 → 承認済。同じ状態の中は listMySites の順（名前順）のまま。
  const cards = sites
    .map((site) => ({ site, status: statuses[site.id] ?? 'none' }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-bold">担当の現場</h1>
      {cards.length === 0 ? (
        <p className="rounded-lg border border-gray-300 p-4 text-base dark:border-gray-700">
          担当している現場がありません。管理者に現場の割り当てを依頼してください。
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map(({ site, status }) => (
            <li key={site.id} className="rounded-lg border border-gray-300 dark:border-gray-700">
              <Link href={`/sites/${site.id}`} className="block min-h-14 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold">{site.name}</p>
                    {site.clientName && (
                      <p className="truncate text-sm text-gray-600 dark:text-gray-400">{site.clientName}</p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 text-xs font-bold ${STATUS_COLOR[status]}`}
                  >
                    今日: {STATUS_LABEL[status]}
                  </span>
                </div>
              </Link>
              <div className="px-3 pb-3">
                <Link
                  href={`/sites/${site.id}/reports/${today}`}
                  className="flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-700 text-base font-bold text-white"
                >
                  今日の日報を書く
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
