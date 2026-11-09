import { downloadHref, pdfViewerHref } from '@/lib/pdf-viewer';

const linkClass =
  'inline-flex min-h-11 items-center rounded-lg border border-blue-700 px-4 font-bold text-blue-700 dark:border-blue-400 dark:text-blue-400';

/** 予算の PDF（/api/budget/pdf）の src。 */
export function budgetPdfSrc(siteId: string, kind: 'setup' | 'report'): string {
  return `/api/budget/pdf?site=${encodeURIComponent(siteId)}&kind=${kind}`;
}

/**
 * 「PDF で見る」（アプリの PDF ビューアー。同じタブで開き、「戻る」で back に戻る）と「PDF を保存」（ダウンロード）。
 * 実行予算・元請けの内訳（kind=setup）と予算と実績（kind=report）の画面で使う。
 */
export function BudgetPdfLinks({ siteId, kind, title, back }: { siteId: string; kind: 'setup' | 'report'; title: string; back: string }) {
  const src = budgetPdfSrc(siteId, kind);
  const view = pdfViewerHref({ src: `${src}&disposition=inline`, title, back }) ?? src;
  const save = downloadHref(src) ?? src;
  return (
    <>
      <a href={view} className={linkClass}>
        PDF で見る
      </a>
      <a href={save} download className={linkClass}>
        PDF を保存
      </a>
    </>
  );
}
