import { Document, Page, renderToBuffer, Text, View } from '@react-pdf/renderer';
import type { BudgetModel } from '@/lib/budget/budget-model';
import { budgetReportHeader, budgetReportSections, BUDGET_REPORT_TITLE, type BudgetReportMeta } from '@/lib/budget/report-sections';
import { Footer, InfoGrid, s, SectionHead, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import type { CostSection } from '@/lib/reports/cost-sections';

// 予算と実績の PDF（社内用。A4 縦・余白 15mm）。表は集計 Excel の ① ② と同じ（report-sections.ts）。
// 列の多い表（① の 11 列・② の 8 列）は文字を小さくして横 1 枚に収める（A4 縦で金額 9 桁が入る。横向きにはしない：
// 脚注の位置が A4 縦の高さで決まっているため、ほかの帳票とそろえる）。行は途中で切らない（common.tsx の Table）。

/** 2 項目ずつ並べる見出しの格子（現場名だけ 1 行）。 */
export function pairLines(items: [string, string | null][]): [string, string | null][][] {
  const lines: [string, string | null][][] = [];
  let pending: [string, string | null] | null = null;
  for (const item of items) {
    if (item[0] === '現場名') {
      lines.push([item]);
    } else if (pending) {
      lines.push([pending, item]);
      pending = null;
    } else {
      pending = item;
    }
  }
  if (pending) lines.push([pending]);
  return lines;
}

/** 欄（見出し・表）。列の数で文字の大きさを決める。 */
export function PdfSection({ section }: { section: CostSection }) {
  const fontSize = (cols: number) => (cols >= 10 ? 7 : cols >= 7 ? 7.5 : 9);
  return (
    <View>
      {/* 見出しと表の初めの数行が離れないよう、残りが少なければ次のページへ */}
      <View minPresenceAhead={72}>
        <SectionHead title={section.title} note={section.note} />
      </View>
      {section.tables.map((t, i) => (
        <View key={i} style={i > 0 ? s.subTable : undefined}>
          <Table table={t} fontSize={fontSize(t.columns.length)} emptyText="行がありません" />
        </View>
      ))}
    </View>
  );
}

export function TitleBar({ title, siteName, meta }: { title: string; siteName: string; meta: [string, string][] }) {
  return (
    <View style={s.titleBar}>
      <View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.titleSite}>{siteName}</Text>
      </View>
      <View>
        {meta.map(([label, value]) => (
          <Text key={label} style={s.titleMeta}>
            {label}：{value}
          </Text>
        ))}
      </View>
    </View>
  );
}

function BudgetReportDocument({ model, meta }: { model: BudgetModel; meta: BudgetReportMeta }) {
  const header = budgetReportHeader(model, meta);
  const at = header.find(([k]) => k === '作成日時')?.[1] ?? '';
  return (
    <Document title={`${meta.siteName} ${BUDGET_REPORT_TITLE}`} author="現場日報アプリ" creator="現場日報アプリ" producer="現場日報アプリ">
      <Page size="A4" orientation="portrait" style={s.page}>
        <TitleBar title={BUDGET_REPORT_TITLE} siteName={meta.siteName} meta={[['作成日時', at], ['区分', '社内用']]} />
        <InfoGrid lines={pairLines(header)} />
        {budgetReportSections(model).map((sec) => (
          <PdfSection key={sec.title} section={sec} />
        ))}
        <Footer text={`現場日報アプリ ― ${BUDGET_REPORT_TITLE}（社内用）${model.asOf.replaceAll('-', '/')} までの日報から集計 ${at}`} />
      </Page>
    </Document>
  );
}

/** 予算と実績の PDF を作る（Node で実行。フォントは初回だけ登録）。 */
export async function renderBudgetReportPdf(model: BudgetModel, meta: BudgetReportMeta): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<BudgetReportDocument model={model} meta={meta} />);
}
