import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { buildBudgetModel, unmappedTradeTextsOf } from '@/lib/budget/budget-model';
import { canOverrideProgress, canViewBudget, manDaysText } from '@/lib/budget/budget-view';
import { jpDate, todayJst } from '@/lib/calc/format';
import { loadBudgetModelInput, loadProgressHistory } from '@/lib/db/budget';
import { requireProfile } from '@/lib/db/profile';
import { getMySiteRole } from '@/lib/db/reports';
import { getSite } from '@/lib/db/sites';
import { AliasMapper } from '@/components/budget/AliasMapper';
import { BudgetView } from '@/components/budget/BudgetCards';

export const metadata = { title: '予算と実績' };

/**
 * 現場の「予算と実績」：工種ごとに 内訳の金額・実行予算・実績・進み具合・このままの見込み・見込みの粗利・判定。
 * 社員・管理者だけ（協力会社は notFound。金額の表は RLS でも読めない）。% の上書きは管理者と、その現場の確認・承認の人（社員）。
 * 完了現場は閲覧のみ（読み替え表・% の上書きは変えられない）。
 */
export default async function BudgetPage({ params }: PageProps<'/sites/[siteId]/budget'>) {
  const profile = await requireProfile();
  if (!canViewBudget(profile)) notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const readOnly = site.status === 'done';
  const asOf = todayJst();

  const [input, role, history] = await Promise.all([
    loadBudgetModelInput(siteId, asOf),
    getMySiteRole(siteId),
    loadProgressHistory(siteId),
  ]);
  if (!input) notFound();
  // 割り当てていない工種の文字は、読み込んだ集計の入力（asOf までの日報）から数える（日報を読み直さない）
  const unmapped = unmappedTradeTextsOf(input);
  const model = buildBudgetModel(input);
  const canOverride = canOverrideProgress(profile, role);
  const unmappedManDays = unmapped.reduce((s, u) => s + u.manDays, 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <div>
        <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
          ← {site.name}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h1 className="text-xl font-bold">予算と実績</h1>
          <Link
            href={`/sites/${siteId}/budget/setup`}
            className="inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400"
          >
            実行予算・元請けの内訳 →
          </Link>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          工期全体・{jpDate(asOf)} 時点（{jpDate(asOf)} までの日報）。社内用です（協力会社のアカウントには見えません）。
        </p>
        {readOnly && (
          <p role="status" className="mt-3 rounded-lg border border-blue-500 bg-blue-50 p-3 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-50">
            この現場は完了しているため閲覧のみです。
          </p>
        )}
      </div>

      {model.trades.length === 0 && (
        <p role="status" className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-50">
          まだ工種がありません。「
          <Link href={`/sites/${siteId}/budget/setup`} className="font-bold underline">
            実行予算・元請けの内訳
          </Link>
          」で工種・実行予算・内訳を入れると、工種ごとに比べられます（いまの実績はすべて予算外の作業に入っています）。
        </p>
      )}

      {unmapped.length > 0 && (
        <section className="rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          <p className="font-bold">
            工種に割り当てていない日報の工種の文字が {unmapped.length} 件あります（{manDaysText(Math.round(unmappedManDays * 100) / 100)}）。
          </p>
          <p className="text-sm">いまは「予算外の作業」に数えています。どの工種の作業かを選ぶと、その工種の実績に入ります。</p>
          <details className="mt-2 rounded-lg bg-background p-3 text-foreground">
            <summary className="flex min-h-11 cursor-pointer items-center font-bold text-blue-700 dark:text-blue-400">
              工種の読み替えを開く
            </summary>
            <div className="mt-2">
              <AliasMapper siteId={siteId} trades={input.data.trades} aliases={input.data.aliases} unmapped={unmapped} readOnly={readOnly} />
            </div>
          </details>
        </section>
      )}

      <BudgetView siteId={siteId} model={model} history={history} canOverride={canOverride} readOnly={readOnly} />

      <p className="text-sm text-gray-700 dark:text-gray-300">
        進み具合の棒：青＝使っている進み具合（管理者・確認者・承認者が入れた % があればそれ、なければ数量から）。赤い線＝数量からの %。
        ずれが大きいときは「内訳の数量が違うかも」の合図です。このままの見込み＝実績 ÷ 進み具合。見込みの粗利＝内訳の金額 − 見込み。
        工種名を押すと、自社・協力会社の行と、その工種の日報の作業が開きます。
      </p>
    </main>
  );
}
