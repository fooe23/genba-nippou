import { jpDateTime } from '@/lib/calc/format';
import type { Attachment } from '@/lib/db/attachments-schemas';
import type { Issue } from '@/lib/db/reports';
import { CHANGE_KIND_LABELS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS } from '@/lib/report/change-labels';
import { cell, col, formatCell, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import { clientConfirmationBoxes, dailyDateLabel } from '@/lib/reports/daily-sections';
import type { DailyReportModel } from '@/lib/reports/types';

// 現場日報（お客様用）の見出しと表（純関数。PDF は src/lib/pdf/client-daily-report.tsx）。
// 出すもの：現場名・日付・天候・作業責任者・作業時間、本日の作業（区分・工種・施工内容・数量・単位・人工）、作業員の人数と人工の合計、
// 追加・変更のご連絡（その日報の件。やり直しを除く）、写真（その日に付けた「お客様用 PDF に載せる」写真）、お客様確認
// （確認者名・日付の枠と大きなサイン欄）、作成者。
// 出さないもの：作業員の氏名・時間・日当・労務費、車両・リース・現金・買掛、本日原価集計、出来高・進捗率、金額、連絡事項、
// 重要事項の本文（issues.text）。

export const CLIENT_DAILY_TITLE = '現場日報（お客様用）';
export const CLIENT_DAILY_WORK_TITLE = '本日の作業';
export const CLIENT_DAILY_ISSUES_TITLE = '追加・変更のご連絡';
export const CLIENT_DAILY_CHECK_TITLE = 'お客様確認';
export const CLIENT_DAILY_PHOTOS_TITLE = '写真';
/** サイン欄の見出し。 */
export const CLIENT_DAILY_SIGN_LABEL = 'サイン';
/** 写真を Storage から読めなかったときに写真の枠に出す文。 */
export const PHOTO_LOAD_FAILED = '写真を読み込めませんでした';
/** 載せる件が無い日に表の代わりに出す 1 行。 */
export const NO_ISSUES_TODAY = 'ありません';

/** 'YYYY-MM-DD' → 'MM/DD'。 */
const md = (date: string) => date.slice(5).replace('-', '/');

/** 見出しの項目（ラベル, 値）。値の null は「—」。作業時間は共通時間の開始〜終了だけ（休憩・中抜は出さない）。 */
export function clientDailyHeaderRows(m: DailyReportModel): [string, string | null][] {
  const h = m.header;
  const { start, end } = h.common;
  return [
    ['現場名', h.siteName],
    ['日付', dailyDateLabel(h.date)],
    ['天候', h.weather],
    ['作業責任者', h.supervisor],
    ['作業時間', start === null && end === null ? null : `${start ?? ''}〜${end ?? ''}`],
  ];
}

/**
 * お客様用の表。
 * - work：区分／工種／施工内容／数量（減は負）／単位／人工。金額・単価・歩掛は出さない。追加・増・変更・減の行は太字。
 * - workersLine：「作業員 N 名・合計 M.M 人工」（作業員の行が無ければ null）。氏名・時間は出さない。
 * - issues：件（MM/DD-番号）／種別／ご指示（指示者／方法）／内容。やり直しの件は出さない。載せる件が無ければ rows は空
 *   （PDF は「ありません」の 1 行）。
 */
export function clientDailyTables(m: DailyReportModel): { work: SectionTable; workersLine: string | null; issues: SectionTable } {
  const n = m.workers.rows.length;
  const day = md(m.header.date);
  return {
    work: {
      columns: [col.text('区分', 1.1), col.text('工種', 1.8), col.text('施工内容', 5.2), col.num('数量', 1.2), col.text('単位', 1), col.num('人工', 1.1)],
      rows: m.work.rows.map((r): Cell[] => [
        CHANGE_KIND_LABELS[r.changeKind],
        r.trade,
        r.description,
        cell.qty(r.qty === null ? null : r.changeKind === 'minus' ? -r.qty : r.qty),
        r.unit,
        cell.dec1(r.manDays),
      ]),
      boldRows: m.work.rows.flatMap((r, i) => (r.changeKind !== 'contract' ? [i] : [])),
    },
    workersLine: n === 0 ? null : `作業員 ${n} 名・合計 ${formatCell(cell.dec1(m.workers.total.manDays))} 人工`,
    issues: {
      columns: [col.text('件', 1.3), col.text('種別', 2.4), col.text('ご指示（指示者／方法）', 2.8), col.text('内容', 5.6)],
      rows: m.issues.items
        .filter((i) => i.kind !== 'rework')
        .map((i): Cell[] => [
          `${day}-${i.number}`,
          ISSUE_KIND_LABELS[i.kind],
          [i.instructedBy?.trim() || null, i.instructionMethod ? INSTRUCTION_METHOD_LABELS[i.instructionMethod] : null]
            .filter((v): v is string => v !== null)
            .join('／'),
          i.body,
        ]),
    },
  };
}

/**
 * お客様確認の枠とメモ。記録済みなら 確認者名・確認日時とメモ（空なら null）、未記録なら 確認者名／日付 の空欄とメモなし。
 * 枠の中身は社内用の日報と同じ（clientConfirmationBoxes）だが、サインは小さな枠ではなく、その下の大きなサイン欄に出す
 * （signLabel。サインの画像があれば欄の中に、無ければ空欄＝印刷して手書き）。
 */
export function clientDailyConfirmation(m: DailyReportModel): { boxes: [string, string][]; note: string | null; signLabel: string } {
  const c = m.clientConfirmation;
  return {
    boxes: clientConfirmationBoxes(c).filter(([label]) => label !== CLIENT_DAILY_SIGN_LABEL),
    note: c && c.note.trim() !== '' ? c.note : null,
    signLabel: CLIENT_DAILY_SIGN_LABEL,
  };
}

// ─── 写真（その日に付けた「お客様用 PDF に載せる」写真） ───

/** お客様用日報に載せる写真 1 枚（並びは件の番号順 → 日報の写真）。caption は写真の下の文。 */
export interface ClientPhoto {
  attachmentId: string;
  caption: string;
}

/** 写真の件の番号付け用（件を書いた日報の日付と、その日報の件の中での番号）。 */
export type ClientPhotoIssue = Pick<Issue, 'id' | 'reportDate' | 'kind' | 'body'> & { number: number };

/** 写真の下の文に件の本文を使うときの長さ（文字）。 */
const ISSUE_BODY_HEAD = 20;

function bodyHead(body: string): string {
  const t = body.trim().replace(/\s+/g, ' ');
  const chars = [...t];
  return chars.length > ISSUE_BODY_HEAD ? `${chars.slice(0, ISSUE_BODY_HEAD).join('')}…` : t;
}

/**
 * お客様用日報に載せる写真。attachments はその日報の添付と、その現場で件に付けた添付（呼び出し側がその日に付けたものを
 * 読む。ここでも付けた日で絞る）。載せるのは「お客様用 PDF に載せる」にチェックした写真で、付けた日がその日報の日付のもの
 * だけ（ファイル・リンク・チェックなし・別の日に付けた写真は出さない）。件の写真は、件がやり直しなら出さない（issues に
 * 無い件の写真も出さない）。件が前の日の日報で作られていても、その日に付けた写真なら載せる。
 * 並び：件の写真（件を書いた日報の日付 → 件の番号の順。同じ件の中は attachments の並び）→ 日報の写真（attachments の並び）。
 * 写真の下の文：件の写真は「MM/DD-番号 ひと言」（ひと言が空なら件の本文の先頭 20 字）、日報の写真はひと言（空なら空）。
 */
export function clientDailyPhotos(m: DailyReportModel, attachments: Attachment[], issues: ClientPhotoIssue[]): ClientPhoto[] {
  if (m.isEmpty) return [];
  const day = m.header.date;
  const photos = attachments.filter((a) => a.kind === 'photo' && a.clientVisible && a.attachedOn === day);
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const issuePhotos = photos
    .map((a, order) => ({ a, order, issue: a.issueId ? issueById.get(a.issueId) : undefined }))
    .filter((x): x is { a: Attachment; order: number; issue: ClientPhotoIssue } => x.issue !== undefined && x.issue.kind !== 'rework')
    .sort((x, y) => x.issue.reportDate.localeCompare(y.issue.reportDate) || x.issue.number - y.issue.number || x.order - y.order)
    .map(({ a, issue }): ClientPhoto => {
      const words = a.caption.trim() || bodyHead(issue.body);
      return { attachmentId: a.id, caption: `${md(issue.reportDate)}-${issue.number}${words ? ` ${words}` : ''}` };
    });
  const reportPhotos = photos
    .filter((a) => !a.issueId && a.reportId !== undefined)
    .map((a): ClientPhoto => ({ attachmentId: a.id, caption: a.caption.trim() }));
  return [...issuePhotos, ...reportPhotos];
}

/** 写真の節の見出しの横に出す枚数「N 枚」。 */
export function clientPhotosNote(count: number): string {
  return `${count} 枚`;
}

/** 脚注の左側「現場日報アプリ ― 現場日報（お客様用） 出力日時 YYYY/MM/DD HH:mm」。 */
export function clientDailyFooterText(outputAt: string): string {
  return `現場日報アプリ ― ${CLIENT_DAILY_TITLE} 出力日時 ${jpDateTime(outputAt)}`;
}
