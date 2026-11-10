import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { jpDateTime } from '@/lib/calc/format';
import { ClientConfirmationBoxes, Footer, InfoGrid, MUTED, RULE, s, SectionHead, Signature, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import { NO_REPORTS, type SectionTable } from '@/lib/reports/cost-sections';
import {
  CHANGE_TOTALS_TITLE,
  changeTotalsText,
  CLIENT_CONFIRMATION_TITLE,
  clientConfirmationBoxes,
  DAILY_REPORT_TITLE,
  DAILY_SECTION_TITLES,
  dailyDateLabel,
  dailyHeaderRows,
  dailyTables,
  LINE_KIND_LABELS,
  NONE,
  visitText,
} from '@/lib/reports/daily-sections';
import type { DailyReportModel } from '@/lib/reports/types';

// 日報の PDF（A4 縦・余白 15mm・本文 9pt。見た目と部品は common.tsx で工事原価集計表と共通）。
// 1 日分は 1〜2 ページ、月まとめは渡した順に日ごとに改ページする（日ごとに <Page> を分ける）。
// 並びは雛形の日報：見出し → 作業員・車両・リース・現金購入・買掛 → 本日原価集計・本日出来高 → 作業内容 → 重要事項 →
// 連絡事項 → 客先確認・署名欄（横に並べる）。行の無い表・空の欄は「なし」の 1 行を出す（どの欄も省かない）。日報の無い日は「日報がありません」だけ。
// 作業内容の追加・増・変更・減の行は太字・施工内容の頭に【区分】で、表の下に「本日の追加・増・変更・減」（保存値の合計）を出す。

const d = StyleSheet.create({
  date: { fontSize: 10.5, fontWeight: 700, textAlign: 'right' },
  textBox: { borderWidth: 0.5, borderColor: RULE, paddingVertical: 3, paddingHorizontal: 4 },
  none: { color: MUTED },
  gap: { marginTop: 4 },
  changeTotals: { marginTop: 3, fontSize: 8.5, fontWeight: 700, textAlign: 'right' },
  // 署名欄の行：左に客先確認、右に社内の署名欄（高さは署名欄と同じにし、今まで 1 ページに収まった日が 2 ページにならないようにする）。
  signRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 10 },
  clientNote: { marginTop: 4 },
});

/** 欄の間隔（工事原価集計表より詰め、明細の少ない日は 1 ページに収める）。 */
const SECTION_GAP = 6;

/** 列の多い表（作業員の 11 列）は文字を少し小さくする。 */
const fontSizeFor = (t: SectionTable) => (t.columns.length >= 10 ? 8 : 9);

/** これ以下の行数の表は見出しごと 1 ページに収める（見出しと列見出しだけがページ末尾に残らないように）。 */
const KEEP_TOGETHER_ROWS = 10;

function TableSection({ title, note, table }: { title: string; note?: string; table: SectionTable }) {
  return (
    <View wrap={table.rows.length > KEEP_TOGETHER_ROWS}>
      <SectionHead title={title} note={note} marginTop={SECTION_GAP} />
      <Table table={table} fontSize={fontSizeFor(table)} emptyText={NONE} />
    </View>
  );
}

/** 本文（改行はそのまま）。空なら「なし」。 */
function TextBox({ text }: { text: string }) {
  const empty = text.trim() === '';
  return <Text style={[d.textBox, ...(empty ? [d.none] : [])]}>{empty ? NONE : text}</Text>;
}

function DayPage({ model, outputAt }: { model: DailyReportModel; outputAt: string }) {
  const h = model.header;
  const date = dailyDateLabel(h.date);
  const visit = visitText(h);
  const t = model.isEmpty ? null : dailyTables(model);
  const sig = model.signature;
  const header = dailyHeaderRows(model);
  return (
    <Page size="A4" orientation="portrait" style={s.page}>
      <View style={s.titleBar}>
        <View>
          <Text style={s.title}>{DAILY_REPORT_TITLE}</Text>
          <Text style={s.titleSite}>{h.siteName}</Text>
        </View>
        <View>
          <Text style={d.date}>{date}</Text>
          {visit ? <Text style={s.titleMeta}>{visit}</Text> : null}
        </View>
      </View>

      {t === null ? (
        <Text style={s.empty}>{NO_REPORTS}</Text>
      ) : (
        <>
          <InfoGrid lines={[header.slice(0, 2), header.slice(2, 4)]} />
          <TableSection title={LINE_KIND_LABELS.labor} table={t.workers} />
          <TableSection title={LINE_KIND_LABELS.fuel} table={t.vehicles} />
          <TableSection title={LINE_KIND_LABELS.lease} table={t.leases} />
          <TableSection title={LINE_KIND_LABELS.cash} table={t.cash} />
          <TableSection title={LINE_KIND_LABELS.credit} table={t.credit} />
          {/* 本日原価集計と本日出来高は横に並べる。 */}
          <View style={s.pair} wrap={false}>
            <View style={s.pairItem}>
              <TableSection title={DAILY_SECTION_TITLES.costs} note="合計は明細の保存値の合計" table={t.costs} />
            </View>
            <View style={s.pairItem}>
              <TableSection title={`${DAILY_SECTION_TITLES.output}・進捗率`} note="進捗率 = 累計出来高 ÷ 請負金額" table={t.output} />
            </View>
          </View>
          <View wrap={t.work.rows.length > KEEP_TOGETHER_ROWS}>
            <TableSection title={LINE_KIND_LABELS.work} table={t.work} />
            {model.work.changes ? (
              <Text style={d.changeTotals} wrap={false}>
                {`${CHANGE_TOTALS_TITLE}　${changeTotalsText(model.work.changes)}`}
              </Text>
            ) : null}
          </View>
          <View>
            <SectionHead title={DAILY_SECTION_TITLES.issues} marginTop={SECTION_GAP} />
            {model.issues.text.trim() !== '' || model.issues.items.length === 0 ? <TextBox text={model.issues.text} /> : null}
            {model.issues.items.length > 0 ? (
              <View style={model.issues.text.trim() !== '' ? d.gap : undefined}>
                <Table table={t.issues} />
              </View>
            ) : null}
          </View>
          <View>
            <SectionHead title={DAILY_SECTION_TITLES.notes} marginTop={SECTION_GAP} />
            <TextBox text={model.notes} />
          </View>
          <View wrap={false}>
            <View style={d.signRow}>
              <ClientConfirmationBoxes title={CLIENT_CONFIRMATION_TITLE} boxes={clientConfirmationBoxes(model.clientConfirmation)} />
              <Signature
                compact
                marginTop={0}
                boxes={[
                  ['作成者', sig.createdBy ?? ''],
                  ['確認者', sig.reviewedBy ?? ''],
                  ['承認者', sig.approvedBy ?? ''],
                  ['承認日', sig.approvedAt ? jpDateTime(sig.approvedAt).slice(0, 10) : ''],
                ]}
              />
            </View>
            {model.clientConfirmation && model.clientConfirmation.note.trim() !== '' ? (
              <Text style={[d.textBox, d.clientNote]}>{`${CLIENT_CONFIRMATION_TITLE}のメモ：${model.clientConfirmation.note}`}</Text>
            ) : null}
          </View>
        </>
      )}

      <Footer text={`現場日報アプリ ― ${h.siteName} ${date} ― 出力日時 ${jpDateTime(outputAt)}`} />
    </Page>
  );
}

function DailyReportDocument({ models, outputAt }: { models: DailyReportModel[]; outputAt: string }) {
  const first = models[0];
  const title = first ? `${first.header.siteName} ${DAILY_REPORT_TITLE}` : DAILY_REPORT_TITLE;
  return (
    <Document title={title} author="現場日報アプリ" creator="現場日報アプリ" producer="現場日報アプリ">
      {models.map((m) => (
        <DayPage key={m.header.date} model={m} outputAt={outputAt} />
      ))}
    </Document>
  );
}

/**
 * 日報の PDF を作る（Node で実行。フォントは初回だけ登録）。models は 1 日分なら 1 件、月まとめなら日付の昇順で全日分。
 * 日報が 1 件も無いときは buildEmptyDailyReport の 1 件を渡す（「日報がありません」の 1 ページ）。outputAt は脚注の出力日時（ISO）。
 */
export async function renderDailyPdf(models: DailyReportModel[], outputAt: string = new Date().toISOString()): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(<DailyReportDocument models={models} outputAt={outputAt} />);
}
