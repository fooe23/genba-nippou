import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { c, LOGO, Tail } from '@/lib/pdf/change-ledger';
import { Footer, InfoGrid, RULE, s, SectionHead, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import { clientSettlement } from '@/lib/reports/change-model';
import { addressee, NO_CHANGES, type ChangeReportMeta } from '@/lib/reports/change-sections';
import {
  CLIENT_CHANGE_TITLE,
  CLIENT_CHECK_TITLE,
  CLIENT_DETAIL_TITLE,
  CLIENT_ISSUES_TITLE,
  CLIENT_SUMMARY_TITLE,
  clientChangeDetail,
  clientChangeFooterText,
  clientChangeInfoRows,
  clientChangeIssues,
  clientChangeSummary,
  clientNotes,
} from '@/lib/reports/client-change-sections';
import { formatCell, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { ChangeLedgerModel } from '@/lib/reports/types';

// 客先に渡す「追加・変更工事 精算のご提案（案）」の PDF（A4 縦・余白 15mm・本文 9pt・明細 8pt）。見た目と部品は common.tsx と
// 社内確認用（change-ledger.tsx）と同じ。1 ページ目：ロゴ・宛先・件名・見出し・精算のまとめ・注記・件ごとの内容。
// 次のページから：作業の明細（11 列を 1 段。行は途中で切らず、列見出しはページごとに繰り返す）・発行者とお客様確認欄。
// 原価・見込み額・提案額・率・単価・申告額、やり直しの件と行は出さない（client-change-sections.ts）。

const DETAIL_FONT = 8;

// 明細の左と上の罫線は行に付ける（表の枠に付けると、行を次のページへ送ったときに縦線だけがページ末尾まで残る。change-ledger.tsx と同じ）
const d = StyleSheet.create({
  detail: { fontSize: DETAIL_FONT },
  row: { flexDirection: 'row', borderLeftWidth: 0.5, borderLeftColor: RULE },
  head: { borderTopWidth: 0.5, borderTopColor: RULE },
});

/** 明細の 1 行（または列見出し）。行の途中では改ページしない。列見出しはページごとに繰り返す。 */
function DetailRow({ table, cells, head }: { table: SectionTable; cells: Cell[]; head: boolean }) {
  return (
    // fixed は列見出しにだけ付ける（fixed={false} でも付いていると react-pdf は行を途中で切る。common.tsx の TableRow と同じ）
    <View style={[d.row, ...(head ? [s.headRow, d.head] : [])]} wrap={false} {...(head ? { fixed: true } : {})}>
      {cells.map((value, i) => {
        const column = table.columns[i];
        return (
          <Text
            key={i}
            style={[
              s.cell,
              { flexGrow: column.w, flexShrink: 1, flexBasis: 0, paddingHorizontal: 2 },
              ...(column.num ? [s.right] : []),
              ...(head ? [s.bold] : []),
            ]}
          >
            {formatCell(value)}
          </Text>
        );
      })}
    </View>
  );
}

function DetailTable({ table }: { table: SectionTable }) {
  return (
    <View style={d.detail}>
      <DetailRow table={table} cells={table.columns.map((c) => c.label)} head />
      {table.rows.map((r, i) => (
        <DetailRow key={i} table={table} cells={r} head={false} />
      ))}
    </View>
  );
}

function ClientChangeDocument({ model, meta }: { model: ChangeLedgerModel; meta: ChangeReportMeta }) {
  const cs = clientSettlement(model);
  const info = clientChangeInfoRows(model, meta);
  const summary = clientChangeSummary(model, cs);
  const notes = clientNotes(model, cs);
  const issues = clientChangeIssues(model, cs);
  const detail = clientChangeDetail(model);
  return (
    <Document
      title={`${meta.site.name} ${CLIENT_CHANGE_TITLE}`}
      author="現場日報アプリ"
      creator="現場日報アプリ"
      producer="現場日報アプリ"
    >
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={c.top}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf の Image（PDF 内の画像。alt は無い） */}
          <Image src={LOGO} style={c.logo} />
          <View>
            <Text style={s.titleMeta}>出力日時：{info.find(([label]) => label === '出力日時')?.[1]}</Text>
          </View>
        </View>

        {/* 下線は View の罫線で引く（Text の borderBottom は文字に重なる） */}
        <View style={c.addressee}>
          <Text>{addressee(meta.site)}</Text>
        </View>
        <Text style={c.subject}>{CLIENT_CHANGE_TITLE}</Text>

        <InfoGrid lines={info.filter(([label]) => label !== '出力日時').map((item) => [item])} />

        {model.isEmpty ? (
          <Text style={s.empty}>{NO_CHANGES}</Text>
        ) : (
          <>
            <SectionHead title={CLIENT_SUMMARY_TITLE} />
            <Table table={summary} />
            {notes.map((n) => (
              <Text key={n} style={c.note}>
                ※ {n}
              </Text>
            ))}

            {issues ? (
              <>
                <SectionHead title={CLIENT_ISSUES_TITLE} />
                <Table table={issues} />
              </>
            ) : null}

            {detail.rows.length > 0 ? (
              <View break>
                <SectionHead title={CLIENT_DETAIL_TITLE} note={`${detail.rows.length} 件`} marginTop={0} />
                <DetailTable table={detail} />
              </View>
            ) : null}
            <Tail meta={meta} checkTitle={CLIENT_CHECK_TITLE} />
          </>
        )}

        <Footer text={clientChangeFooterText(meta)} />
      </Page>
    </Document>
  );
}

/** 精算のご提案（案）客先用の PDF を作る（Node で実行。フォントは初回だけ登録）。 */
export async function renderClientChangePdf(model: ChangeLedgerModel, meta: ChangeReportMeta): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<ClientChangeDocument model={model} meta={meta} />);
}
