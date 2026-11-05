import { jpDateTime } from '@/lib/calc/format';
import { CHANGE_KIND_LABELS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS } from '@/lib/report/change-labels';
import { clientSettlement } from '@/lib/reports/change-model';
import { changeInfoRows, NO_BASE_NOTE, type ChangeReportMeta } from '@/lib/reports/change-sections';
import { cell, col, formatCell, slashDate, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { ChangeIssueSettlement, ChangeLedgerKind, ChangeLedgerModel, ClientSettlement } from '@/lib/reports/types';

// 客先に渡す「追加・変更工事 精算のご提案（案）」の中身（見出し・精算のまとめ・注記・件ごとの内容・作業の明細）を
// PDF・Excel 共通の形にする（純関数）。金額は clientSettlement（見積中の件を除く）。実績原価・見込み額・原価からの提案額・
// 経費率と利益率・単価・申告額、やり直しの件とその行は出さない。宛先・発行者・空のときの文は社内確認用（change-sections.ts）と同じ。

export const CLIENT_CHANGE_TITLE = '追加・変更工事 精算のご提案（案）';
export const CLIENT_CHANGE_SHORT_TITLE = '精算のご提案（案）';
export const CLIENT_CHANGE_SHEET_NAME = '精算のご提案';
export const CLIENT_SUMMARY_TITLE = '精算のまとめ';
export const CLIENT_ISSUES_TITLE = '件ごとの内容';
export const CLIENT_DETAIL_TITLE = '作業の明細';
/** お客様確認欄の見出し（枠は CLIENT_CHECK_BOXES）。 */
export const CLIENT_CHECK_TITLE = 'お客様確認欄';
export const MONTH_CUMULATIVE_NOTE = '件数・金額は月末までの累計です。';
/** 見積中の件の注記（N > 0 のときだけ出す。「※ 」は描画側で付ける）。 */
export const PENDING_NOTE = (n: number) => `見積中の件（${n} 件）は金額に含めていません。確定しだい改めてご提示します。`;

const KINDS: ChangeLedgerKind[] = ['extra', 'increase', 'change', 'minus'];

/** 'YYYY-MM-DD' → 'MM/DD'。 */
const md = (date: string) => date.slice(5).replace('-', '/');

/** 見出しの項目（社内確認用と同じ：現場名・工事名・工事番号・期間・出力日時）。 */
export function clientChangeInfoRows(model: ChangeLedgerModel, meta: ChangeReportMeta): [string, string | null][] {
  return changeInfoRows(model, meta);
}

/**
 * 精算のまとめ：項目／件数／金額(円)（月は「金額（累計）(円)」）。当初（請負金額または概算）・追加・増・変更・減（負）、
 * 合計行「精算提案額」（当初が無ければ「—」）。件数・金額は clientSettlement（確定した件と件なしの行。見積中を除く）。
 */
export function clientChangeSummary(model: ChangeLedgerModel, cs: ClientSettlement = clientSettlement(model)): SectionTable {
  const { through } = model.settlement;
  return {
    columns: [col.text('項目', 5), col.num('件数', 1.2), col.num(through ? '金額（累計）(円)' : '金額(円)', 2.6)],
    rows: [
      [cs.baseBasis === 'estimate' ? '当初見積（概算）' : '当初請負金額', '', cell.yen(cs.base)],
      ...KINDS.map((k): Cell[] => [CHANGE_KIND_LABELS[k], cell.int(cs.kinds[k].count), cell.yen(cs.kinds[k].amount)]),
    ],
    total: [through ? `精算提案額（${slashDate(through)} までの累計）` : '精算提案額', '', cell.yen(cs.proposed)],
  };
}

/** まとめの注記（「※ 」は付けない）：見積中の件の数（0 なら無し）、月の累計、当初金額なし。 */
export function clientNotes(model: ChangeLedgerModel, cs: ClientSettlement = clientSettlement(model)): string[] {
  return [
    ...(cs.pendingCount > 0 ? [PENDING_NOTE(cs.pendingCount)] : []),
    ...(model.settlement.through ? [MONTH_CUMULATIVE_NOTE] : []),
    ...(cs.proposed === null ? [NO_BASE_NOTE] : []),
  ];
}

/** ご指示：「指示者／方法 MM/DD」（日付は件を登録した日報の日。無い部分は省く）。 */
function instruction(i: ChangeIssueSettlement): string {
  const who = [i.instructedBy?.trim() || null, i.instructionMethod ? INSTRUCTION_METHOD_LABELS[i.instructionMethod] : null]
    .filter((v): v is string => v !== null)
    .join('／');
  return who ? `${who} ${md(i.reportDate)}` : md(i.reportDate);
}

/** 精算：「一式（見積 MM/DD）」「一式」「常用 N人工 × ¥単価」、見積中は「見積中」。 */
function terms(i: ChangeIssueSettlement, pending: boolean): string {
  if (pending) return '見積中';
  if (i.settlementMethod === 'lump_sum') return i.fixedOn ? `一式（見積 ${md(i.fixedOn)}）` : '一式';
  return `常用 ${formatCell(cell.dec1(i.manDays))}人工 × ¥${formatCell(cell.yen(i.dailyRate))}`;
}

/**
 * 件ごとの内容：件（MM/DD-番号 種別 本文の先頭）／ご指示／精算／金額(円)（見積中は「—」、減は負）／確認（件を登録した
 * 日報の客先確認）。やり直しの件と件なしの行は載せない（件なしの金額はまとめに入っている）。載せる件が無ければ null。
 */
export function clientChangeIssues(model: ChangeLedgerModel, cs: ClientSettlement = clientSettlement(model)): SectionTable | null {
  if (cs.issues.length === 0) return null;
  return {
    // 列幅の比 w は PDF（9pt）での mm の目安（合計 180）
    columns: [col.text('件', 62), col.text('ご指示', 38), col.text('精算', 46), col.num('金額(円)', 22), col.text('確認', 12)],
    rows: cs.issues.map((i): Cell[] => {
      const pending = cs.pendingIds.has(i.id);
      return [
        `${md(i.reportDate)}-${i.number} ${ISSUE_KIND_LABELS[i.kind]} ${i.bodyHead}`.trim(),
        instruction(i),
        terms(i, pending),
        pending ? null : cell.yen(i.settled),
        i.reportClientConfirmed ? 'あり' : 'なし',
      ];
    }),
  };
}

/**
 * 作業の明細（11 列を 1 段）：日付／区分／工種／施工内容／数量（減は負）／単位／人工／指示者／方法／件（MM/DD-番号）／確認。
 * 集計期間の行のうち、やり直しの件に紐づく行は出さない。列幅の比 w は PDF（8pt）での mm の目安（合計 180）。
 */
export function clientChangeDetail(model: ChangeLedgerModel): SectionTable {
  return {
    columns: [
      col.text('日付', 18),
      col.text('区分', 8),
      col.text('工種', 14),
      col.text('施工内容', 50),
      col.num('数量', 12),
      col.text('単位', 8),
      col.num('人工', 10),
      col.text('指示者', 27),
      col.text('方法', 10),
      col.text('件', 14),
      col.text('確認', 9),
    ],
    rows: model.rows
      .filter((r) => r.issue?.kind !== 'rework')
      .map((r): Cell[] => [
        slashDate(r.date),
        CHANGE_KIND_LABELS[r.changeKind],
        r.trade,
        r.description,
        cell.qty(r.qty === null ? null : r.changeKind === 'minus' ? -r.qty : r.qty),
        r.unit,
        cell.dec1(r.manDays),
        r.instructedBy ?? '',
        r.instructionMethod ? INSTRUCTION_METHOD_LABELS[r.instructionMethod] : '',
        r.issue ? `${md(r.issue.reportDate)}-${r.issue.number}` : '',
        r.clientConfirmed ? 'あり' : 'なし',
      ]),
  };
}

/** 脚注の左側「現場日報アプリ ― 精算のご提案（案） YYYY/MM/DD HH:mm」。 */
export function clientChangeFooterText(meta: ChangeReportMeta): string {
  return `現場日報アプリ ― ${CLIENT_CHANGE_SHORT_TITLE} ${jpDateTime(meta.outputAt)}`;
}
