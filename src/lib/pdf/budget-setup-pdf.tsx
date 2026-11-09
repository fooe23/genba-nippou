import { Document, Page, renderToBuffer } from '@react-pdf/renderer';
import type { BudgetReportMeta } from '@/lib/budget/report-sections';
import { budgetSetupHeader, budgetSetupSections, BUDGET_SETUP_TITLE } from '@/lib/budget/setup-sections';
import type { BudgetData } from '@/lib/budget/types';
import { PdfSection, pairLines, TitleBar } from '@/lib/pdf/budget-report-pdf';
import { Footer, InfoGrid, s } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';

// 実行予算・元請けの内訳の PDF（社内用。A4 縦・余白 15mm）。実行予算（工種ごとの施工者の行・小計、予算外、現場全体、合計）、
// 元請けの内訳（当初・変更・工種の識別）、工種ごとの内訳の金額。行は途中で切らない。

function BudgetSetupDocument({
  data,
  supplierNames,
  dailyRate,
  meta,
}: {
  data: BudgetData;
  supplierNames: Readonly<Record<string, string>>;
  dailyRate: number;
  meta: BudgetReportMeta;
}) {
  const header = budgetSetupHeader(meta, dailyRate);
  const at = header.find(([k]) => k === '作成日時')?.[1] ?? '';
  return (
    <Document title={`${meta.siteName} ${BUDGET_SETUP_TITLE}`} author="現場日報アプリ" creator="現場日報アプリ" producer="現場日報アプリ">
      <Page size="A4" orientation="portrait" style={s.page}>
        <TitleBar title={BUDGET_SETUP_TITLE} siteName={meta.siteName} meta={[['作成日時', at], ['区分', '社内用']]} />
        <InfoGrid lines={pairLines(header)} />
        {budgetSetupSections(data, supplierNames).map((sec) => (
          <PdfSection key={sec.title} section={sec} />
        ))}
        <Footer text={`現場日報アプリ ― ${BUDGET_SETUP_TITLE}（社内用） ${at}`} />
      </Page>
    </Document>
  );
}

/** 実行予算・元請けの内訳の PDF を作る（Node で実行）。 */
export async function renderBudgetSetupPdf(
  data: BudgetData,
  supplierNames: Readonly<Record<string, string>>,
  dailyRate: number,
  meta: BudgetReportMeta,
): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<BudgetSetupDocument data={data} supplierNames={supplierNames} dailyRate={dailyRate} meta={meta} />);
}
