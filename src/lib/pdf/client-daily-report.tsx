import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { ClientConfirmationBoxes, Footer, InfoGrid, RULE, s, SectionHead, Signature, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import {
  CLIENT_DAILY_CHECK_TITLE,
  CLIENT_DAILY_ISSUES_TITLE,
  CLIENT_DAILY_TITLE,
  CLIENT_DAILY_WORK_TITLE,
  clientDailyConfirmation,
  clientDailyFooterText,
  clientDailyHeaderRows,
  clientDailyTables,
  NO_ISSUES_TODAY,
} from '@/lib/reports/client-daily-sections';
import { NO_REPORTS, type SectionTable } from '@/lib/reports/cost-sections';
import { dailyDateLabel, NONE } from '@/lib/reports/daily-sections';
import type { DailyReportModel } from '@/lib/reports/types';

// 現場日報（お客様用）の PDF（A4 縦・余白 15mm・本文 9pt。見た目と部品は common.tsx で社内用の日報と共通）。
// 並び：題名・現場名・日付 → 見出し（現場名・日付・天候・作業責任者・作業時間）→ 本日の作業（＋作業員の人数と人工）→
// 本日の追加・変更のご連絡 → お客様確認と作成者（横に並べる）・お客様確認のメモ。日報の無い日は「日報がありません」だけ。
// 金額・作業員の氏名・時間・車両・購入・原価・出来高・連絡事項は出さない（client-daily-sections.ts）。

const d = StyleSheet.create({
  date: { fontSize: 10.5, fontWeight: 700, textAlign: 'right' },
  workers: { marginTop: 3, fontSize: 9, fontWeight: 700, textAlign: 'right' },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 14 },
  note: { marginTop: 4, borderWidth: 0.5, borderColor: RULE, paddingVertical: 3, paddingHorizontal: 4 },
});

/** これ以下の行数の表は見出しごと 1 ページに収める。 */
const KEEP_TOGETHER_ROWS = 10;

function TableSection({ title, table, emptyText }: { title: string; table: SectionTable; emptyText: string }) {
  return (
    <View wrap={table.rows.length > KEEP_TOGETHER_ROWS}>
      <SectionHead title={title} />
      <Table table={table} emptyText={emptyText} />
    </View>
  );
}

function ClientDailyDocument({ model, outputAt }: { model: DailyReportModel; outputAt: string }) {
  const h = model.header;
  const date = dailyDateLabel(h.date);
  const t = model.isEmpty ? null : clientDailyTables(model);
  const header = clientDailyHeaderRows(model);
  const confirmation = clientDailyConfirmation(model);
  return (
    <Document title={`${h.siteName} ${CLIENT_DAILY_TITLE}`} author="現場日報アプリ" creator="現場日報アプリ" producer="現場日報アプリ">
      <Page size="A4" orientation="portrait" style={s.page}>
        <View style={s.titleBar}>
          <View>
            <Text style={s.title}>{CLIENT_DAILY_TITLE}</Text>
            <Text style={s.titleSite}>{h.siteName}</Text>
          </View>
          <Text style={d.date}>{date}</Text>
        </View>

        {t === null ? (
          <Text style={s.empty}>{NO_REPORTS}</Text>
        ) : (
          <>
            <InfoGrid lines={[header.slice(0, 2), header.slice(2, 4), header.slice(4, 5)]} />
            <View wrap={t.work.rows.length > KEEP_TOGETHER_ROWS}>
              <TableSection title={CLIENT_DAILY_WORK_TITLE} table={t.work} emptyText={NONE} />
              {t.workersLine ? (
                <Text style={d.workers} wrap={false}>
                  {t.workersLine}
                </Text>
              ) : null}
            </View>
            <TableSection title={CLIENT_DAILY_ISSUES_TITLE} table={t.issues} emptyText={NO_ISSUES_TODAY} />
            <View wrap={false}>
              <View style={d.signRow}>
                <ClientConfirmationBoxes title={CLIENT_DAILY_CHECK_TITLE} boxes={confirmation.boxes} />
                <Signature compact marginTop={0} boxes={[['作成者', model.signature.createdBy ?? '']]} />
              </View>
              {confirmation.note !== null ? <Text style={d.note}>{`${CLIENT_DAILY_CHECK_TITLE}のメモ：${confirmation.note}`}</Text> : null}
            </View>
          </>
        )}

        <Footer text={clientDailyFooterText(outputAt)} />
      </Page>
    </Document>
  );
}

/**
 * 現場日報（お客様用）の PDF を作る（Node で実行。フォントは初回だけ登録）。model は 1 日分（日報が無い日は buildEmptyDailyReport）。
 * outputAt は脚注の出力日時（ISO）。
 */
export async function renderClientDailyPdf(model: DailyReportModel, outputAt: string = new Date().toISOString()): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<ClientDailyDocument model={model} outputAt={outputAt} />);
}
