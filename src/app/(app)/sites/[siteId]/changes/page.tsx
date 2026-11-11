import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { SITE_CLOSED_NOTICE } from '@/lib/constants';
import { todayJst } from '@/lib/calc/format';
import { loadChangesPage } from '@/lib/db/changes-data';
import { requireProfile } from '@/lib/db/profile';
import { getSite } from '@/lib/db/sites';
import { ChangesTable } from '@/components/changes/ChangesTable';

export const metadata = { title: '追加・変更の一覧' };

export default async function ChangesPage({ params }: PageProps<'/sites/[siteId]/changes'>) {
  const profile = await requireProfile();
  // 協力会社には出さない（実績原価・精算額は社内だけ。updateIssueSettlement も協力会社はエラー）。
  if (profile.accountType === 'partner') notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const readOnly = site.status === 'done';

  const { rows, total, defaultDailyRate, duplicates, rates } = await loadChangesPage(site);

  return (
    <main className="mx-auto w-full max-w-[96rem] p-4">
      <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
        ← {site.name}
      </Link>
      <h1 className="mb-2 text-xl font-bold">追加・変更の一覧</h1>
      <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
        件ごとに精算の方法と確定額（一式）・見積額（見積）または常用単価（常用）を入れます。未定の件は、根拠にその件を選んだ行（作業内容の施工金額・材料・リース・燃料・外注）からの提案額で仮に数えます。
      </p>
      {readOnly && (
        <p role="status" className="mb-4 rounded-lg border border-blue-500 bg-blue-50 p-3 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-50">
          {SITE_CLOSED_NOTICE}
        </p>
      )}
      <ChangesTable
        siteId={siteId}
        rows={rows}
        total={total}
        defaultDailyRate={defaultDailyRate}
        duplicates={duplicates}
        rates={rates}
        readOnly={readOnly}
        today={todayJst()}
      />
    </main>
  );
}
