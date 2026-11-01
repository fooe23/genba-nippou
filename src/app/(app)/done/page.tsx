import Link from 'next/link';
import { jpDate } from '@/lib/calc/format';
import { requireProfile } from '@/lib/db/profile';
import { countReportsBySite } from '@/lib/db/reports';
import { listMySites } from '@/lib/db/sites';

export const metadata = { title: '完了現場' };

function period(start: string | null, end: string | null): string {
  return `${start ? jpDate(start) : '未設定'} 〜 ${end ? jpDate(end) : '未設定'}`;
}

export default async function DoneSitesPage() {
  await requireProfile();
  // RLS により、社員・管理者は全現場、協力会社は割り当て現場だけが返る（削除済みは listMySites が除く）。
  const sites = (await listMySites()).filter((s) => s.status === 'done');
  const counts = await countReportsBySite(sites.map((s) => s.id));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 text-xl font-bold">完了現場（閲覧のみ）</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        完了した現場の日報は閲覧だけできます。直す必要があるときは管理者が『進行中に戻す』を押してください。
      </p>
      {sites.length === 0 ? (
        <p className="rounded-lg border border-gray-300 p-4 text-base dark:border-gray-700">完了した現場はありません。</p>
      ) : (
        <ul className="space-y-3">
          {sites.map((site) => (
            <li key={site.id} className="rounded-lg border border-gray-300 dark:border-gray-700">
              <Link href={`/sites/${site.id}`} className="block min-h-14 p-3">
                <p className="truncate text-lg font-bold">{site.name}</p>
                {site.clientName && (
                  <p className="truncate text-sm text-gray-600 dark:text-gray-400">{site.clientName}</p>
                )}
                <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm">
                  <span>工期 {period(site.startDate, site.endDate)}</span>
                  <span className="font-medium">日報 {counts[site.id] ?? 0} 件</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
