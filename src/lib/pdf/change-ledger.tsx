import path from 'node:path';
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Footer, InfoGrid, MM, MUTED, NAVY, RULE, s, SectionHead, Signature, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import {
  CHANGE_REPORT_TITLE,
  CHANGE_SUBJECT,
  changeDetail,
  changeFooterText,
  changeInfoRows,
  changeIssues,
  changeIssuesNote,
  changeSummary,
  CLIENT_CHECK_BOXES,
  ISSUES_TITLE,
  NO_CHANGES,
  senderRows,
  type ChangeReportMeta,
} from '@/lib/reports/change-sections';
import { formatCell, type Cell, type Column, type SectionTable } from '@/lib/reports/cost-sections';
import type { ChangeLedgerModel } from '@/lib/reports/types';

// 変更増減 社内確認用の PDF（A4 縦・余白 15mm・本文 9pt・明細 8pt）。見た目と部品は common.tsx。
// 1 ページ目：ロゴ・件名・見出し・サマリー表・注記、続けて件ごとの精算（入りきらない行は次のページへ）。宛先は出さない。
// 次のページから：明細一覧（1 件を 2 段で表示）・末尾。客先用の「精算のご提案（案）」は client-change-ledger.tsx（ロゴ・
// 件名・注記・末尾の部品はここから使う）。

export const LOGO = path.join(process.cwd(), 'public/logo.png');

/** 明細の段組み（changeDetail の列番号）：日付は 2 段をまたぎ、上段は区分〜提案額（9 列）、下段は指示者〜客先確認（5 列）。 */
const LEAD = 0;
const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const LOWER = [10, 11, 12, 13, 14];
const DETAIL_FONT = 8;

export const c = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 18 * MM },
  addressee: {
    alignSelf: 'flex-start',
    minWidth: 80 * MM,
    marginTop: 8,
    paddingBottom: 2,
    fontSize: 13,
    lineHeight: 1.4, // 大きい文字は行の高さを明示する（本文の 1.35 を 9pt で受け継ぐと文字が罫線に重なる）
    fontWeight: 700,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  subject: { marginTop: 14, marginBottom: 12, textAlign: 'center', fontSize: 15, lineHeight: 1.4, fontWeight: 700, color: NAVY, letterSpacing: 1 },
  note: { marginTop: 3, fontSize: 8, color: MUTED },
  // 左と上の罫線は行に付ける（表の枠に付けると、行を次のページへ送ったときに縦線だけがページ末尾まで残る）
  ledger: { fontSize: DETAIL_FONT },
  record: { flexDirection: 'row', borderLeftWidth: 0.5, borderLeftColor: RULE, borderBottomWidth: 0.75, borderBottomColor: '#8f9bab' },
  headRecord: { borderTopWidth: 0.5, borderTopColor: RULE },
  lower: { backgroundColor: '#fafbfc' },
  tail: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16 },
  sender: { width: '52%' },
  check: { alignItems: 'flex-end' },
});

/** 1 セル（列の比 w で幅を決める）。 */
function LedgerCell({ column, value, head }: { column: Column; value: Cell; head: boolean }) {
  return (
    <Text
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
}

/** 1 件（または列見出し）：左に日付（2 段をまたぐ）、右に上段と下段。行の途中では改ページしない。 */
function LedgerRecord({ table, cells, head }: { table: SectionTable; cells: Cell[]; head: boolean }) {
  const lead = table.columns[LEAD];
  const part = (idx: number[]) => idx.map((i) => <LedgerCell key={i} column={table.columns[i]} value={cells[i]} head={head} />);
  const width = (idx: number[]) => idx.reduce((sum, i) => sum + table.columns[i].w, 0);
  return (
    // fixed は列見出しにだけ付ける（fixed={false} でも付いていると react-pdf は行を途中で切る。common.tsx の TableRow と同じ）
    <View style={[c.record, ...(head ? [s.headRow, c.headRecord] : [])]} wrap={false} {...(head ? { fixed: true } : {})}>
      <View style={{ flexGrow: lead.w, flexShrink: 1, flexBasis: 0, flexDirection: 'row' }}>
        <LedgerCell column={lead} value={cells[LEAD]} head={head} />
      </View>
      <View style={{ flexGrow: width(UPPER), flexShrink: 1, flexBasis: 0 }}>
        <View style={s.row}>{part(UPPER)}</View>
        <View style={[s.row, ...(head ? [] : [c.lower])]}>{part(LOWER)}</View>
      </View>
    </View>
  );
}

function Ledger({ table }: { table: SectionTable }) {
  return (
    <View style={c.ledger}>
      <LedgerRecord table={table} cells={table.columns.map((col) => col.label)} head />
      {table.rows.map((r, i) => (
        <LedgerRecord key={i} table={table} cells={r} head={false} />
      ))}
    </View>
  );
}

/** 末尾：発行者（会社名・担当者・連絡先。未設定は空の枠）と確認欄（確認者・確認日・サイン。見出しは checkTitle）。 */
export function Tail({ meta, checkTitle = '客先確認欄' }: { meta: ChangeReportMeta; checkTitle?: string }) {
  return (
    <View style={c.tail} wrap={false}>
      <View style={c.sender}>
        <SectionHead title="発行者" marginTop={0} />
        {/* 空の値は全角空白にして枠の高さを保つ */}
        <InfoGrid lines={senderRows(meta).map(([label, value]) => [[label, value || '\u3000']])} />
      </View>
      <View style={c.check}>
        <SectionHead title={checkTitle} marginTop={0} />
        <View style={{ marginTop: -16 }}>
          <Signature boxes={CLIENT_CHECK_BOXES.map((label) => [label, ''])} />
        </View>
      </View>
    </View>
  );
}

function ChangeLedgerDocument({ model, meta }: { model: ChangeLedgerModel; meta: ChangeReportMeta }) {
  const info = changeInfoRows(model, meta);
  const { table, notes } = changeSummary(model);
  const issues = changeIssues(model);
  const detail = changeDetail(model);
  return (
    <Document
      title={`${meta.site.name} ${CHANGE_REPORT_TITLE}`}
      author="現場日報アプリ"
      creator="現場日報アプリ"
      producer="現場日報アプリ"
    >
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={c.top}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf の Image（PDF 内の画像。alt は無い） */}
          <Image src={LOGO} style={c.logo} />
          <View>
            <Text style={s.titleMeta}>{CHANGE_REPORT_TITLE}</Text>
            <Text style={s.titleMeta}>出力日時：{info.find(([label]) => label === '出力日時')?.[1]}</Text>
          </View>
        </View>

        <Text style={c.subject}>{CHANGE_SUBJECT}</Text>

        <InfoGrid lines={info.filter(([label]) => label !== '出力日時').map((item) => [item])} />

        {model.isEmpty ? (
          <Text style={s.empty}>{NO_CHANGES}</Text>
        ) : (
          <>
            <SectionHead title="精算のサマリー" />
            <Table table={table} />
            {notes.map((n) => (
              <Text key={n} style={c.note}>
                ※ {n}
              </Text>
            ))}

            {issues ? (
              <>
                <SectionHead title={ISSUES_TITLE} note={changeIssuesNote(model)} />
                <Table table={issues} fontSize={DETAIL_FONT} />
              </>
            ) : null}

            <View break>
              <SectionHead title="明細一覧" note={`${detail.rows.length} 件`} marginTop={0} />
              <Ledger table={detail} />
            </View>
            <Tail meta={meta} />
          </>
        )}

        <Footer text={changeFooterText(meta)} />
      </Page>
    </Document>
  );
}

/** 変更増減 社内確認用の PDF を作る（Node で実行。フォントは初回だけ登録）。 */
export async function renderChangePdf(model: ChangeLedgerModel, meta: ChangeReportMeta): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<ChangeLedgerDocument model={model} meta={meta} />);
}
