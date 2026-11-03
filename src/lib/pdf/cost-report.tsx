import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_FONT, registerPdfFonts } from '@/lib/pdf/fonts';
import {
  costSections,
  COST_REPORT_TITLE,
  footerText,
  formatCell,
  headerRows,
  NO_REPORTS,
  type Cell,
  type CostSection,
  type SectionTable,
} from '@/lib/reports/cost-sections';
import type { CostReportModel } from '@/lib/reports/types';

// 工事原価集計表の PDF（A4 縦・余白 15mm・本文 9pt）。見た目はデザイン案：濃紺の見出し、細い罫線、見出し帯、数字は右寄せ。
// 表の行は wrap={false} でページの途中で切らない。列見出しは改ページ後も繰り返す。

const MM = 72 / 25.4;
const A4_HEIGHT = 841.89;
const NAVY = '#1f3a5f';
const RULE = '#c9d1dc';
const BAND = '#eef2f7';
const TOTAL_BAND = '#f6f8fb';
const MUTED = '#5b6573';

const s = StyleSheet.create({
  page: {
    fontFamily: PDF_FONT,
    fontSize: 9,
    lineHeight: 1.35,
    color: '#1a1a1a',
    paddingTop: 15 * MM,
    paddingHorizontal: 15 * MM,
    paddingBottom: 22 * MM,
  },
  titleBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    marginBottom: 8,
  },
  title: { fontSize: 17, lineHeight: 1.3, fontWeight: 700, color: NAVY, letterSpacing: 2 },
  titleSite: { fontSize: 10.5, lineHeight: 1.3, fontWeight: 700, marginTop: 2 },
  titleMeta: { fontSize: 8, color: MUTED, textAlign: 'right' },
  grid: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: RULE },
  gridRow: { flexDirection: 'row' },
  gridLabel: {
    width: 22 * MM,
    backgroundColor: BAND,
    fontWeight: 700,
    paddingVertical: 2.5,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: RULE,
  },
  gridValue: { flex: 1, paddingVertical: 2.5, paddingHorizontal: 4, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: RULE },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 12,
    marginBottom: 4,
    paddingLeft: 5,
    borderLeftWidth: 3,
    borderLeftColor: NAVY,
  },
  sectionTitle: { fontSize: 10.5, fontWeight: 700, color: NAVY },
  sectionNote: { fontSize: 7.5, color: MUTED, marginLeft: 6, marginBottom: 1 },
  table: { borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: RULE },
  subTable: { marginTop: 6 },
  row: { flexDirection: 'row' },
  headRow: { backgroundColor: BAND },
  totalRow: { backgroundColor: TOTAL_BAND, borderTopWidth: 1, borderTopColor: NAVY },
  cell: { paddingVertical: 2.5, paddingHorizontal: 4, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: RULE },
  bold: { fontWeight: 700 },
  right: { textAlign: 'right' },
  pair: { flexDirection: 'row', justifyContent: 'space-between' },
  pairItem: { width: '48.5%' },
  empty: {
    marginTop: 16,
    paddingVertical: 12,
    textAlign: 'center',
    fontSize: 10,
    borderWidth: 0.5,
    borderColor: RULE,
    color: MUTED,
  },
  signature: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  sigBox: { width: 26 * MM, borderWidth: 0.5, borderColor: RULE, marginLeft: -0.5 },
  sigLabel: { backgroundColor: BAND, textAlign: 'center', fontWeight: 700, paddingVertical: 2, borderBottomWidth: 0.5, borderColor: RULE },
  sigName: { height: 16 * MM, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 2 },
  // bottom 指定だと react-pdf 4.9 では位置がずれる（ページの外に出る）ので top で置く。
  footer: {
    position: 'absolute',
    left: 15 * MM,
    right: 15 * MM,
    top: A4_HEIGHT - 12 * MM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: MUTED,
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 3,
  },
});

/** 見出しで 1 行を占める項目（長くなりやすい）。それ以外は 2 項目ずつ並べる。 */
const WIDE = new Set(['現場名', '工事名', '工事概要', '工期', '集計期間']);

function HeaderGrid({ model }: { model: CostReportModel }) {
  const lines: [string, string][][] = [];
  let pending: [string, string] | null = null;
  for (const [label, value] of headerRows(model)) {
    const item: [string, string] = [label, value ?? '—'];
    if (WIDE.has(label)) {
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
  return (
    <View style={s.grid}>
      {lines.map((items) => (
        <View key={items[0][0]} style={s.gridRow} wrap={false}>
          {items.map(([label, value]) => (
            <View key={label} style={{ flexDirection: 'row', flex: 1 }}>
              <Text style={s.gridLabel}>{label}</Text>
              <Text style={s.gridValue}>{value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function TableRow({ table, cells, kind, compact }: { table: SectionTable; cells: Cell[]; kind: 'head' | 'body' | 'total'; compact: boolean }) {
  const rowStyle = [s.row, ...(kind === 'head' ? [s.headRow] : kind === 'total' ? [s.totalRow] : [])];
  return (
    <View style={rowStyle} wrap={false} fixed={kind === 'head'}>
      {cells.map((c, i) => {
        const col = table.columns[i];
        const style = [
          s.cell,
          { flexGrow: col.w, flexShrink: 1, flexBasis: 0, ...(compact ? { paddingHorizontal: 2 } : {}) },
          ...(col.num ? [s.right] : []),
          ...(kind !== 'body' ? [s.bold] : []),
        ];
        return (
          <Text key={i} style={style}>
            {formatCell(c)}
          </Text>
        );
      })}
    </View>
  );
}

function Table({ table, fontSize }: { table: SectionTable; fontSize: number }) {
  const compact = fontSize < 9;
  return (
    <View style={[s.table, { fontSize }]}>
      <TableRow table={table} cells={table.columns.map((c) => c.label)} kind="head" compact={compact} />
      {table.rows.map((r, i) => (
        <TableRow key={i} table={table} cells={r} kind="body" compact={compact} />
      ))}
      {table.total ? <TableRow table={table} cells={table.total} kind="total" compact={compact} /> : null}
    </View>
  );
}

function Section({ section }: { section: CostSection }) {
  // 列の多い表（③ 推移の 11 列）は 9 桁の金額が収まるよう文字を少し小さくする。
  const fontSize = (cols: number) => (cols >= 10 ? 7.5 : 9);
  return (
    <View>
      <View style={s.sectionHead} minPresenceAhead={48} wrap={false}>
        <Text style={s.sectionTitle}>{section.title}</Text>
        {section.note ? <Text style={s.sectionNote}>{section.note}</Text> : null}
      </View>
      {section.tables.map((t, i) => (
        <View key={i} style={i > 0 ? s.subTable : undefined}>
          <Table table={t} fontSize={fontSize(t.columns.length)} />
        </View>
      ))}
    </View>
  );
}

function Signature({ model }: { model: CostReportModel }) {
  const sig = model.signature;
  const boxes: [string, string][] = [
    ['作成者', sig.createdBy],
    ['確認者', sig.checkedBy ?? ''],
    ['承認者', sig.approvedBy ?? ''],
  ];
  return (
    <View style={s.signature} wrap={false}>
      {boxes.map(([label, name]) => (
        <View key={label} style={s.sigBox}>
          <Text style={s.sigLabel}>{label}</Text>
          <View style={s.sigName}>
            <Text>{name}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function CostReportDocument({ model }: { model: CostReportModel }) {
  const sections = costSections(model);
  const [first, second, ...rest] = sections;
  const h = model.header;
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

        <HeaderGrid model={model} />

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
            <Signature model={model} />
          </>
        )}

        <View style={s.footer} fixed>
          <Text>{footerText(model)}</Text>
          <Text render={({ pageNumber, totalPages }) => `ページ ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** 工事原価集計表の PDF を作る（Node で実行。フォントは初回だけ登録）。 */
export async function renderCostPdf(model: CostReportModel): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<CostReportDocument model={model} />);
}
