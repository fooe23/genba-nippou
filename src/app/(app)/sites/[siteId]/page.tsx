import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { todayJst } from '@/lib/calc/format';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { listOpenIssues, listReportHeads } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { siteForViewer, siteSubline, siteTitle } from '@/lib/sites/display';
import { ReportCalendar } from '@/components/site/ReportCalendar';
import { SiteStatusButton } from '@/components/site/SiteStatusButton';
import { SiteSummary } from '@/components/site/SiteSummary';

export const metadata = { title: '現場' };

const siteLinkClass =
  'flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-lg border border-blue-700 px-2 text-center text-base font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400';

export default async function SiteDetailPage({ params }: PageProps<'/sites/[siteId]'>) {
  const profile = await requireProfile();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const found = await getSite(siteId);
  // 削除済みの現場は管理者にも出さない（管理 → 現場 → 「削除済み」でだけ扱う）。
  if (!found || found.deletedAt !== null) notFound();
  // 請負金額などのお金の項目は社員・管理者だけ。協力会社には画面に渡す前に落とす（サマリーの進捗率も「—」になる）。
  const showAmount = isEmployeeOrAdmin(profile);
  const site = siteForViewer(found, showAmount);
  const done = site.status === 'done';
  const [heads, issues] = await Promise.all([listReportHeads(siteId), listOpenIssues(siteId)]);
  const today = todayJst();

  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <Link
        href={done ? '/done' : '/'}
        className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400"
      >
        {done ? '← 完了現場' : '← ホーム'}
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">{siteTitle(site)}</h1>
        {done && (
          <span className="rounded border border-blue-400 bg-blue-50 px-2 py-0.5 text-sm font-bold text-blue-900 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-50">
            完了（閲覧のみ）
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{siteSubline(site, { showAmount })}</p>

      <div className="mt-4">
        <SiteSummary site={site} heads={heads} today={today} issues={issues} />
        <ReportCalendar siteId={siteId} heads={heads} today={today} />
      </div>

      {/* 3 つ並んでも 375px に収まるよう、幅を等分して文字が折り返さない大きさにする */}
      <div className="mt-6 flex gap-2">
        <Link href={`/sites/${siteId}/summary`} className={siteLinkClass}>
          集計を見る
        </Link>
        {/* 協力会社は出力しない（/api/export も 403）。追加・変更の一覧（実績原価・精算額）も社内だけ */}
        {profile.accountType !== 'partner' && (
          <>
            <Link href={`/sites/${siteId}/export`} className={siteLinkClass}>
              出力
            </Link>
            <Link href={`/sites/${siteId}/changes`} className={siteLinkClass}>
              追加・変更
            </Link>
          </>
        )}
      </div>
      {/* 協力会社と作業員の登録・予算と実績・実行予算と元請けの内訳は社員・管理者だけ（協力会社には出さない） */}
      {isEmployeeOrAdmin(profile) && (
        <Link
          href={`/sites/${siteId}/budget`}
          className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border-2 border-blue-700 px-4 py-2 text-blue-700 dark:border-blue-400 dark:text-blue-400"
        >
          <span className="min-w-0">
            <span className="block text-base font-bold">予算と実績</span>
            <span className="block text-sm text-gray-700 dark:text-gray-300">工種ごとの内訳の金額・実行予算・実績・進み具合・見込み</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-xl font-bold">
            →
          </span>
        </Link>
      )}
      {isEmployeeOrAdmin(profile) && (
        <Link
          href={`/sites/${siteId}/budget/setup`}
          className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border-2 border-blue-700 px-4 py-2 text-blue-700 dark:border-blue-400 dark:text-blue-400"
        >
          <span className="min-w-0">
            <span className="block text-base font-bold">実行予算・元請けの内訳</span>
            <span className="block text-sm text-gray-700 dark:text-gray-300">工種・実行予算・内訳の入力、Excel の取り込みと書き出し</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-xl font-bold">
            →
          </span>
        </Link>
      )}
      {isEmployeeOrAdmin(profile) && (
        <Link
          href={`/sites/${siteId}/partners`}
          className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border-2 border-blue-700 px-4 py-2 text-blue-700 dark:border-blue-400 dark:text-blue-400"
        >
          <span className="min-w-0">
            <span className="block text-base font-bold">協力会社と作業員</span>
            <span className="block text-sm text-gray-700 dark:text-gray-300">協力会社の追加・作業員の登録</span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-xl font-bold">
            →
          </span>
        </Link>
      )}

      {profile.isAdmin && <SiteStatusButton siteId={siteId} status={site.status} />}
    </main>
  );
}
