import { Document, Image as PdfImage, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { chunk } from '@/lib/calc/paging';
import { BAND, ClientConfirmationBoxes, Footer, InfoGrid, MM, MUTED, NAVY, RULE, s, SectionHead, Signature, Table } from '@/lib/pdf/common';
import { registerPdfFonts } from '@/lib/pdf/fonts';
import {
  CLIENT_DAILY_CHECK_TITLE,
  CLIENT_DAILY_ISSUES_TITLE,
  CLIENT_DAILY_PHOTOS_TITLE,
  CLIENT_DAILY_TITLE,
  CLIENT_DAILY_WORK_TITLE,
  clientDailyConfirmation,
  clientDailyFooterText,
  clientDailyHeaderRows,
  clientDailyTables,
  clientPhotosNote,
  NO_ISSUES_TODAY,
  PHOTO_LOAD_FAILED,
} from '@/lib/reports/client-daily-sections';
import { NO_REPORTS, type SectionTable } from '@/lib/reports/cost-sections';
import { dailyDateLabel, NONE } from '@/lib/reports/daily-sections';
import type { DailyReportModel } from '@/lib/reports/types';

// 現場日報（お客様用）の PDF（A4 縦・余白 15mm・本文 9pt。見た目と部品は common.tsx で社内用の日報と共通）。
// 並び：題名・現場名・日付 → 見出し（現場名・日付・天候・作業責任者・作業時間）→ 本日の作業（＋作業員の人数と人工）→
// 追加・変更のご連絡 → 写真（1 行 2 枚・4:3 の枠に収める・写真の下に文。行の途中で切らず、多ければ次のページへ）→
// お客様確認と作成者（横に並べる）・お客様確認のメモ・サイン欄（高さ 30mm。サインの画像があれば中に出す）。
// お客様確認の塊はページの途中で切らない。日報の無い日は「日報がありません」だけ。
// react-pdf の Image は PdfImage の名前で使う（PDF の画像に alt は無い。HTML の img 用の lint の対象外にする）。
// 金額・作業員の氏名・時間・車両・購入・原価・出来高・連絡事項は出さない（client-daily-sections.ts）。

/** 写真：本文の幅 180mm に 2 枚、間 6mm。枠は 4:3（写真は枠に収める。縦長・横長でも切らない）。 */
const PHOTO_GAP = 6 * MM;
const PHOTO_WIDTH = (180 * MM - PHOTO_GAP) / 2;
const PHOTO_HEIGHT = (PHOTO_WIDTH * 3) / 4;
const PHOTO_ROW_GAP = 4 * MM;
const PHOTOS_PER_ROW = 2;
/** サイン欄の高さ（約 3cm）。 */
const SIGN_HEIGHT = 30 * MM;
const SIGN_RULE = '#6b7280';

/** 写真 1 枚分の画像（Storage から読んだ JPEG・PNG）。読めなかった写真は image が null（枠に「写真を読み込めませんでした」）。 */
export interface ClientPhotoImage {
  caption: string;
  image: { data: Buffer; format: 'png' | 'jpg' } | null;
}

/** renderClientDailyReportPdf の追加の入力。 */
export interface ClientDailyPdfOptions {
  /** 脚注の出力日時（ISO）。既定は今。 */
  outputAt?: string;
  /** 載せる写真（clientDailyPhotos の並び）。無ければ写真の節を出さない。 */
  photos?: ClientPhotoImage[];
  /** お客様のサインの画像（PNG）。あればサイン欄の中に出す。無ければ空欄（印刷して手書き）。 */
  signaturePng?: Buffer;
}

const d = StyleSheet.create({
  date: { fontSize: 10.5, fontWeight: 700, textAlign: 'right' },
  workers: { marginTop: 3, fontSize: 9, fontWeight: 700, textAlign: 'right' },
  signRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 14 },
  note: { marginTop: 4, borderWidth: 0.5, borderColor: RULE, paddingVertical: 3, paddingHorizontal: 4 },
  photoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: PHOTO_ROW_GAP },
  photo: { width: PHOTO_WIDTH },
  photoFrame: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    backgroundColor: BAND,
    borderWidth: 0.5,
    borderColor: RULE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoImage: { width: PHOTO_WIDTH - 1, height: PHOTO_HEIGHT - 1, objectFit: 'contain' },
  photoMissing: { color: MUTED, fontSize: 8.5 },
  caption: { marginTop: 2, fontSize: 8.5, lineHeight: 1.3 },
  signBox: { flexDirection: 'row', marginTop: 6, height: SIGN_HEIGHT, borderWidth: 0.75, borderColor: SIGN_RULE },
  signLabel: {
    width: 8 * MM,
    backgroundColor: BAND,
    color: NAVY,
    fontWeight: 700,
    textAlign: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: SIGN_RULE,
    paddingHorizontal: 1,
  },
  signArea: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 2 * MM },
  signImage: { width: '100%', height: '100%', objectFit: 'contain' },
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

function PhotoCell({ photo }: { photo: ClientPhotoImage }) {
  return (
    <View style={d.photo}>
      <View style={d.photoFrame}>
        {photo.image ? <PdfImage style={d.photoImage} src={photo.image} /> : <Text style={d.photoMissing}>{PHOTO_LOAD_FAILED}</Text>}
      </View>
      {photo.caption ? <Text style={d.caption}>{photo.caption}</Text> : null}
    </View>
  );
}

function PhotoRow({ photos }: { photos: ClientPhotoImage[] }) {
  return (
    <View style={d.photoRow} wrap={false}>
      {photos.map((p, i) => (
        <PhotoCell key={i} photo={p} />
      ))}
      {photos.length < PHOTOS_PER_ROW ? <View style={d.photo} /> : null}
    </View>
  );
}

/** 写真の節。見出しと 1 行目は離さない（同じページに置く）。行は途中で切らず、入らなければ次のページへ。 */
function PhotoSection({ photos }: { photos: ClientPhotoImage[] }) {
  const [first, ...rest] = chunk(photos, PHOTOS_PER_ROW);
  return (
    <View>
      <View wrap={false}>
        <SectionHead title={CLIENT_DAILY_PHOTOS_TITLE} note={clientPhotosNote(photos.length)} />
        <PhotoRow photos={first} />
      </View>
      {rest.map((row, i) => (
        <PhotoRow key={i} photos={row} />
      ))}
    </View>
  );
}

function ClientDailyDocument({
  model,
  outputAt,
  photos,
  signaturePng,
}: {
  model: DailyReportModel;
  outputAt: string;
  photos: ClientPhotoImage[];
  signaturePng?: Buffer;
}) {
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
            {photos.length > 0 ? <PhotoSection photos={photos} /> : null}
            {/* お客様確認の塊（枠・メモ・サイン欄）はページの途中で切らない（入らなければ塊ごと次のページ）。
                minPresenceAhead は塊の「後ろ」の高さを測るので使わない（余分なページができる）。 */}
            <View wrap={false}>
              <View style={d.signRow}>
                <ClientConfirmationBoxes title={CLIENT_DAILY_CHECK_TITLE} boxes={confirmation.boxes} />
                <Signature compact marginTop={0} boxes={[['作成者', model.signature.createdBy ?? '']]} />
              </View>
              {confirmation.note !== null ? <Text style={d.note}>{`${CLIENT_DAILY_CHECK_TITLE}のメモ：${confirmation.note}`}</Text> : null}
              <View style={d.signBox}>
                <View style={d.signLabel}>
                  <Text>{confirmation.signLabel}</Text>
                </View>
                <View style={d.signArea}>
                  {signaturePng ? <PdfImage style={d.signImage} src={{ data: signaturePng, format: 'png' }} /> : null}
                </View>
              </View>
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
 * 写真とサインの画像は呼び出し側が読んで渡す（src/lib/reports/client-daily-render.ts の renderClientDailyPdf）。
 */
export async function renderClientDailyReportPdf(model: DailyReportModel, opts: ClientDailyPdfOptions = {}): Promise<Buffer> {
  registerPdfFonts();
  return renderToBuffer(
    <ClientDailyDocument
      model={model}
      outputAt={opts.outputAt ?? new Date().toISOString()}
      photos={model.isEmpty ? [] : (opts.photos ?? [])}
      signaturePng={opts.signaturePng}
    />,
  );
}
