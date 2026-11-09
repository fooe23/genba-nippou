import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '@/lib/uuid';
import { loadBudgetData, loadUnmappedTradeTexts, loadUsedTradeIds } from '@/lib/db/budget';
import { listSuppliers } from '@/lib/db/masters';
import { isEmployeeOrAdmin, requireProfile } from '@/lib/db/profile';
import { getSettings } from '@/lib/db/settings';
import { getSite } from '@/lib/db/sites';
import { AliasMapper } from '@/components/budget/AliasMapper';
import { BudgetLinesEditor } from '@/components/budget/BudgetLinesEditor';
import { BudgetPdfLinks } from '@/components/budget/PdfLinks';
import { ContractItemsEditor } from '@/components/budget/ContractItemsEditor';
import { ImportDialog } from '@/components/budget/ImportDialog';
import { PdfImport } from '@/components/budget/PdfImport';
import { TradesEditor } from '@/components/budget/TradesEditor';

export const metadata = { title: '実行予算・元請けの内訳' };

/**
 * 現場の「実行予算・元請けの内訳」：工種、実行予算（工種 × 施工者）、元請けの内訳を画面で入れる・Excel で取り込む・書き出す。
 * 社員・管理者だけ（協力会社は notFound。金額の表は RLS でも読めない）。完了現場は閲覧と書き出しだけ。
 */
export default async function BudgetSetupPage({ params }: PageProps<'/sites/[siteId]/budget/setup'>) {
  const profile = await requireProfile();
  if (!isEmployeeOrAdmin(profile)) notFound();
  const { siteId } = await params;
  if (!isUuid(siteId)) notFound();
  const site = await getSite(siteId);
  if (!site || site.deletedAt !== null) notFound();
  const readOnly = site.status === 'done';

  const [data, suppliers, settings] = await Promise.all([loadBudgetData(siteId), listSuppliers(), getSettings()]);
  // 自社の労務の単価の初期値は全社の設定「予算の標準日当」（現場の常用単価の既定は客先への請求の単価なので使わない）
  const dailyRate = settings.budgetDailyRate;
  const [usedTradeIds, unmapped] = await Promise.all([
    loadUsedTradeIds(data.trades.map((t) => t.id)),
    loadUnmappedTradeTexts(siteId, { trades: data.trades, aliases: data.aliases }),
  ]);
  const allPartners = suppliers.filter((s) => s.isPartner);
  const usedSuppliers = new Set(data.budgetLines.map((l) => l.supplierId).filter((v): v is string => v !== null));
  // 選べるのは有効な協力会社と、いまの予算で使っている会社（無効にした会社も行が消えないように）
  const choosable = allPartners.filter((s) => s.active || usedSuppliers.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
  const partners = allPartners.map((s) => ({ id: s.id, name: s.name }));

  // 保存・取り込みで中身が変わったら、その欄の編集中の状態を作り直す（key を変えて作り直す）。
  // 工種だけを保存したときは予算・内訳の欄を作り直さない（保存していない編集を消さない。まとまりは props の工種から作る）
  const tradesKey = data.trades.map((t) => `${t.id}:${t.name}:${t.sortOrder}`).join('|');
  const linesKey = data.budgetLines.map((l) => l.id).join('|');
  const itemsKey = data.contractItems.map((i) => i.id).join('|');

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-4">
      <div>
        <Link href={`/sites/${siteId}`} className="mb-2 inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
          ← {site.name}
        </Link>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
          <h1 className="text-xl font-bold">実行予算・元請けの内訳</h1>
          <Link href={`/sites/${siteId}/budget`} className="inline-flex min-h-11 items-center text-base font-medium text-blue-700 dark:text-blue-400">
            予算と実績を見る →
          </Link>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          社内用です（協力会社のアカウントには見えません）。画面で直接入れても、Excel の雛形から取り込んでも同じ中身になります。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {/* 保存済みの実行予算・内訳の PDF（画面で編集中の内容は入らない） */}
          <BudgetPdfLinks siteId={siteId} kind="setup" title={`実行予算・元請けの内訳 ${site.name}`} back={`/sites/${siteId}/budget/setup`} />
        </div>
        {readOnly && (
          <p role="status" className="mt-3 rounded-lg border border-blue-500 bg-blue-50 p-3 font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-50">
            この現場は完了しているため閲覧のみです（Excel の書き出しはできます）。
          </p>
        )}
      </div>
      <ImportDialog
        siteId={siteId}
        current={data}
        usedTradeIds={usedTradeIds}
        partners={partners}
        dailyRate={dailyRate}
        readOnly={readOnly}
      />
      {/* 元請けの内訳だけを文字 PDF から読み取る（完了現場では出さない） */}
      <PdfImport siteId={siteId} trades={data.trades} readOnly={readOnly} />
      <TradesEditor key={tradesKey} siteId={siteId} trades={data.trades} readOnly={readOnly} />
      <BudgetLinesEditor
        key={linesKey}
        siteId={siteId}
        trades={data.trades}
        lines={data.budgetLines}
        partners={choosable}
        dailyRate={dailyRate}
        readOnly={readOnly}
      />
      <ContractItemsEditor key={itemsKey} siteId={siteId} trades={data.trades} items={data.contractItems} readOnly={readOnly} />
      <section aria-labelledby="budget-aliases" className="space-y-3">
        <h2 id="budget-aliases" className="text-lg font-bold">
          日報の工種の読み替え
        </h2>
        <AliasMapper siteId={siteId} trades={data.trades} aliases={data.aliases} unmapped={unmapped} readOnly={readOnly} />
      </section>
    </main>
  );
}
