import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_FONT } from '@/lib/pdf/fonts';
import { formatCell, type Cell, type SectionTable } from '@/lib/reports/cost-sections';

// 帳票 PDF（工事原価集計表・日報）で共通の見た目と部品。A4 縦・余白 15mm・本文 9pt。
// 濃紺の見出し、細い罫線、見出し帯、数字は右寄せ。表の行は wrap={false} でページの途中で切らず、列見出しは改ページ後も繰り返す。

export const MM = 72 / 25.4;
const A4_HEIGHT = 841.89;
export const NAVY = '#1f3a5f';
export const RULE = '#c9d1dc';
export const BAND = '#eef2f7';
const TOTAL_BAND = '#f6f8fb';
export const MUTED = '#5b6573';

export const s = StyleSheet.create({
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
  noneCell: { flex: 1, color: MUTED },
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

/** 見出しの格子。lines の 1 要素が 1 行（項目 1 つなら行いっぱい、2 つなら左右に並べる）。値の null は「—」。 */
export function InfoGrid({ lines }: { lines: [string, string | null][][] }) {
  return (
    <View style={s.grid}>
      {lines.map((items) => (
        <View key={items[0][0]} style={s.gridRow} wrap={false}>
          {items.map(([label, value]) => (
            <View key={label} style={{ flexDirection: 'row', flex: 1 }}>
              <Text style={s.gridLabel}>{label}</Text>
              <Text style={s.gridValue}>{value ?? '—'}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function TableRow({
  table,
  cells,
  kind,
  compact,
  bold = false,
}: {
  table: SectionTable;
  cells: Cell[];
  kind: 'head' | 'body' | 'total';
  compact: boolean;
  /** 本文の行を太字にする（table.boldRows）。 */
  bold?: boolean;
}) {
  const rowStyle = [s.row, ...(kind === 'head' ? [s.headRow] : kind === 'total' ? [s.totalRow] : [])];
  return (
    // fixed は列見出しにだけ付ける（fixed={false} でも props に fixed があると react-pdf は改ページ送りをせず、行を途中で切る）
    <View style={rowStyle} wrap={false} {...(kind === 'head' ? { fixed: true } : {})}>
      {cells.map((c, i) => {
        const col = table.columns[i];
        const style = [
          s.cell,
          { flexGrow: col.w, flexShrink: 1, flexBasis: 0, ...(compact ? { paddingHorizontal: 2 } : {}) },
          ...(col.num ? [s.right] : []),
          ...(kind !== 'body' || bold ? [s.bold] : []),
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

/**
 * 表（列見出し・行・合計行）。行が無いとき、emptyText があれば行の代わりにその 1 行を出し、合計行は出さない。
 * fontSize が 9 未満なら左右の余白を詰める（列の多い表）。
 */
export function Table({ table, fontSize = 9, emptyText }: { table: SectionTable; fontSize?: number; emptyText?: string }) {
  const compact = fontSize < 9;
  const none = table.rows.length === 0 && emptyText !== undefined;
  return (
    <View style={[s.table, { fontSize }]}>
      <TableRow table={table} cells={table.columns.map((c) => c.label)} kind="head" compact={compact} />
      {table.rows.map((r, i) => (
        <TableRow key={i} table={table} cells={r} kind="body" compact={compact} bold={table.boldRows?.includes(i) ?? false} />
      ))}
      {none ? (
        <View style={s.row} wrap={false}>
          <Text style={[s.cell, s.noneCell]}>{emptyText}</Text>
        </View>
      ) : table.total ? (
        <TableRow table={table} cells={table.total} kind="total" compact={compact} />
      ) : null}
    </View>
  );
}

/**
 * 欄の見出し（左に濃紺の線）。次の内容と離れないよう、ページ末尾に 48pt 未満しか残らなければ次のページへ送る。
 * marginTop は欄の間隔（既定 12pt）。
 */
export function SectionHead({ title, note, marginTop }: { title: string; note?: string; marginTop?: number }) {
  return (
    <View style={[s.sectionHead, ...(marginTop !== undefined ? [{ marginTop }] : [])]} minPresenceAhead={48} wrap={false}>
      <Text style={s.sectionTitle}>{title}</Text>
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
    </View>
  );
}

/**
 * 署名欄（右寄せの枠。ラベル, 名前）。compact は上の間隔と押印欄を小さくする（日報）。marginTop は上の間隔の指定
 * （欄の見出しの直後に置くときなど）。
 */
export function Signature({ boxes, compact = false, marginTop }: { boxes: [string, string][]; compact?: boolean; marginTop?: number }) {
  const top = marginTop ?? (compact ? 10 : undefined);
  return (
    <View style={[s.signature, ...(top !== undefined ? [{ marginTop: top }] : [])]} wrap={false}>
      {boxes.map(([label, name]) => (
        <View key={label} style={s.sigBox}>
          <Text style={s.sigLabel}>{label}</Text>
          <View style={[s.sigName, ...(compact ? [{ height: 12 * MM }] : [])]}>
            <Text>{name}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** 各ページの脚注（左に文、右に「ページ n / N」）。 */
export function Footer({ text }: { text: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{text}</Text>
      <Text render={({ pageNumber, totalPages }) => `ページ ${pageNumber} / ${totalPages}`} />
    </View>
  );
}
