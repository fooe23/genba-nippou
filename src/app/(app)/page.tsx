import Link from 'next/link';
import { todayJst } from '@/lib/calc/format';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { listTodayStatus } from '@/lib/db/reports';
import { listMyMemberSiteIds, listMySites, type Site } from '@/lib/db/sites';
import { siteForViewer, siteSubline, siteTitle } from '@/lib/sites/display';
import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, type DayStatus } from '@/components/site/status';
import { Chevron, linkTitleClass, rowLinkClass } from '@/components/ui/tappable';

export const metadata = { title: 'ホーム' };

interface SiteCard {
  site: Site;
  status: DayStatus;
}

function SiteCards({ cards, today, showAmount }: { cards: SiteCard[]; today: string; showAmount: boolean }) {
  return (
    <ul className="space-y-3">
      {cards.map(({ site, status }) => (
        <li key={site.id} className="rounded-lg border border-gray-300 dark:border-gray-700">
          <Link href={`/sites/${site.id}`} className={`block min-h-14 rounded-t-lg p-3 ${rowLinkClass}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`truncate text-lg font-bold ${linkTitleClass}`}>{siteTitle(site)}</p>
                <p className="truncate text-sm text-gray-600 dark:text-gray-400">{siteSubline(site, { showAmount })}</p>
                <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">現場の詳細・カレンダーを開く</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className={`rounded border px-2 py-0.5 text-xs font-bold ${STATUS_COLOR[status]}`}>
                  今日: {STATUS_LABEL[status]}
                </span>
                <Chevron />
              </div>
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
  );
}

export default async function HomePage() {
  const profile = await requireProfile();
  const today = todayJst();
  // RLS により、社員・管理者は全現場、協力会社は割り当て現場だけが返る。
  const [allSites, memberIds] = await Promise.all([listMySites(), listMyMemberSiteIds(profile.id)]);
  // 請負金額などのお金の項目は社員・管理者だけ。協力会社には画面に渡す前に落とす。
  const showAmount = isEmployeeOrAdmin(profile);
  const sites = allSites.filter((s) => s.status === 'active').map((s) => siteForViewer(s, showAmount));
  const statuses = await listTodayStatus(
    sites.map((s) => s.id),
    today,
  );
  // 未入力 → 下書き → 差戻し → 提出済 → 承認済。同じ状態の中は listMySites の順（名前順）のまま。
  const cards: SiteCard[] = sites
    .map((site) => ({ site, status: statuses[site.id] ?? 'none' }))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  const memberSet = new Set(memberIds);
  const mine = cards.filter((c) => memberSet.has(c.site.id));
  const others = cards.filter((c) => !memberSet.has(c.site.id));

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-bold">担当している現場</h1>
      {cards.length === 0 ? (
        <p className="rounded-lg border border-gray-300 p-4 text-base dark:border-gray-700">
          {profile.accountType === 'partner' && !profile.isAdmin
            ? '担当している現場がありません。管理者に現場の割り当てを依頼してください。'
            : '表示できる現場がありません。'}
        </p>
      ) : (
        <>
          {mine.length > 0 ? (
            <SiteCards cards={mine} today={today} showAmount={showAmount} />
          ) : (
            <p className="rounded-lg border border-gray-300 p-4 text-base dark:border-gray-700">
              担当の割り当てがありません。下の『その他の現場』から入力できます。
            </p>
          )}
          {others.length > 0 && (
            <details className="mt-6" open={mine.length === 0}>
              <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold">
                その他の現場（{others.length}件）
              </summary>
              <div className="mt-3">
                <SiteCards cards={others} today={today} showAmount={showAmount} />
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}
