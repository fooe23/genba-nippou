import { Document, Page, renderToBuffer, Text, View } from '@react-pdf/renderer';
import { Footer, InfoGrid, s, SectionHead, Signature, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import {
  costSections,
  COST_REPORT_TITLE,
  footerText,
  headerRows,
  NO_REPORTS,
  type CostSection,
} from '@/lib/reports/cost-sections';
import type { CostReportModel } from '@/lib/reports/types';

// 工事原価集計表の PDF（A4 縦・余白 15mm・本文 9pt）。見た目と部品は common.tsx（日報 PDF と共通）。

/** 見出しで 1 行を占める項目（長くなりやすい）。それ以外は 2 項目ずつ並べる。 */
const WIDE = new Set(['現場名', '工事名', '工事概要', '工期', '集計期間']);

function headerLines(model: CostReportModel): [string, string | null][][] {
  const lines: [string, string | null][][] = [];
  let pending: [string, string | null] | null = null;
  for (const item of headerRows(model)) {
    if (WIDE.has(item[0])) {
      if (pending) lines.push([pending]);
      pending = null;
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

function Section({ section }: { section: CostSection }) {
  // 列の多い表（③ 推移の 11 列・④-2 所属別の 9 列）は 9 桁の金額と列見出しが収まるよう文字を少し小さくする。
  const fontSize = (cols: number) => (cols >= 9 ? 7.5 : 9);
  return (
    <View>
      <SectionHead title={section.title} note={section.note} />
      {section.tables.map((t, i) => (
        <View key={i} style={i > 0 ? s.subTable : undefined}>
          <Table table={t} fontSize={fontSize(t.columns.length)} />
        </View>
      ))}
    </View>
  );
}

function CostReportDocument({ model }: { model: CostReportModel }) {
  const sections = costSections(model);
  const [first, second, ...rest] = sections;
  const h = model.header;
  const sig = model.signature;
  return (
    <Document title={`${h.siteName} ${COST_REPORT_TITLE}`} author="現場日報アプリ" creator="現場日報アプリ" producer="現場日報アプリ">
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={s.titleBar}>
          <View>
            <Text style={s.title}>{COST_REPORT_TITLE}</Text>
            <Text style={s.titleSite}>{h.siteName}</Text>
          </View>
          <View>
            {headerRows(model)
              .filter(([label]) => label === '集計期間' || label === '出力日時')
              .map(([label, value]) => (
                <Text key={label} style={s.titleMeta}>
                  {label}：{value ?? '—'}
                </Text>
              ))}
          </View>
        </View>

        <InfoGrid lines={headerLines(model)} />

        {sections.length === 0 ? (
          <Text style={s.empty}>{NO_REPORTS}</Text>
        ) : (
          <>
            {/* ① 原価合計と ② 採算は横に並べる。 */}
            <View style={s.pair} wrap={false}>
              <View style={s.pairItem}>{first ? <Section section={first} /> : null}</View>
              <View style={s.pairItem}>{second ? <Section section={second} /> : null}</View>
            </View>
            {rest.map((sec) => (
              <Section key={sec.title} section={sec} />
            ))}
            <Signature
              boxes={[
                ['作成者', sig.createdBy],
                ['確認者', sig.checkedBy ?? ''],
                ['承認者', sig.approvedBy ?? ''],
              ]}
            />
          </>
        )}

        <Footer text={footerText(model)} />
      </Page>
    </Document>
  );
}

/** 工事原価集計表の PDF を作る（Node で実行。フォントは初回だけ登録）。 */
export async function renderCostPdf(model: CostReportModel): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<CostReportDocument model={model} />);
}
