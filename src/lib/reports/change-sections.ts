import { jpDateTime } from '@/lib/calc/format';
import type { Site } from '@/lib/db/sites';
import { clientSettlement } from '@/lib/reports/change-model';
import { CHANGE_KIND_LABELS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS, SETTLEMENT_METHOD_LABELS } from '@/lib/report/change-labels';
import { cell, col, formatCell, slashDate, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { ChangeIssueSettlement, ChangeLedgerKind, ChangeLedgerModel, ChangeLedgerRow } from '@/lib/reports/types';

// 変更増減 社内確認用の中身（見出し・サマリー表・注記・件ごとの精算・明細・末尾）を PDF・Excel 共通の形にする（純関数）。
// 客先に渡す「精算のご提案（案）」は client-change-sections.ts（原価・見込み額・提案額を出さない）。宛先（addressee）・
// 発行者（senderRows）・NO_CHANGES などはそちらでも使う。
// セルの形（Cell・NumFmt）と文字列化（formatCell）は工事原価集計表（cost-sections.ts）と同じ。

export const CHANGE_REPORT_TITLE = '変更増減 社内確認用';
export const CHANGE_SUBJECT = '追加・変更の精算 社内確認';
export const CHANGE_SHEET_NAME = '変更増減_社内確認用';
/** 社内確認用のサマリーで、精算提案額の下に出す客先用の精算提案額（clientSettlement）の行の名前。 */
export const CLIENT_PROPOSED_LABEL = '客先提示額（見積中を除く）';
export const NO_CHANGES = '追加・増・変更・減の記録はありません';
export const NO_BASE_NOTE = '当初金額が未設定のため算出できません';
export const ISSUES_TITLE = '件ごとの精算';
export const UNLINKED_LABEL = '件なし（根拠の件を選んでいない行）';
export const SETTLED_NOTE =
  '精算額＝一式・見積の件は確定額、常用の件は人工×常用単価、未定の件と件に紐づかない行は提案額。やり直しの件は参考で合計に入れません。';
/** 客先確認欄の 3 つの枠（どれも空欄）。 */
export const CLIENT_CHECK_BOXES = ['確認者', '確認日', 'サイン'] as const;

/** モデル以外に帳票が使う情報（ルートが作る）。 */
export interface ChangeReportMeta {
  site: Site;
  /** 設定の自社名・連絡先（未設定は null → 空欄）。 */
  company: { name: string | null; contact: string | null };
  /** 出力日時（ISO 8601）。 */
  outputAt: string;
  /** 出力した人（末尾の「担当者」）。 */
  by: string;
  /** 現場の最初・最後の日報日（工期全体の期間の表示。日報が無ければ null）。 */
  reportSpan: { from: string | null; to: string | null };
}

/** 日報日の最初と最後（reportSpan）。 */
export function reportSpan(reports: { reportDate: string }[]): ChangeReportMeta['reportSpan'] {
  const dates = reports.map((r) => r.reportDate).sort();
  return { from: dates[0] ?? null, to: dates.at(-1) ?? null };
}

const COMPANY_MARKS = ['株式会社', '有限会社', '合同会社', '（株）', '(株)', '（有）'];

/**
 * 宛先の敬称：客先名が「様」「御中」で終わればそのまま、会社名（株式会社・有限会社・合同会社・（株）・(株)・（有）を
 * 含む）なら「客先名 御中」、それ以外は「客先名 様」。客先名が無ければ「お客様 各位」。
 */
export function addressee(site: Pick<Site, 'clientName'>): string {
  const name = site.clientName?.trim();
  if (!name) return 'お客様 各位';
  if (name.endsWith('様') || name.endsWith('御中')) return name;
  return COMPANY_MARKS.some((m) => name.includes(m)) ? `${name} 御中` : `${name} 様`;
}

function periodText(model: ChangeLedgerModel, meta: ChangeReportMeta): string {
  const { month } = model.period;
  if (model.period.kind === 'month' && month) return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
  const { from, to } = meta.reportSpan;
  return from && to ? `工期全体（${slashDate(from)}〜${slashDate(to)}）` : '工期全体';
}

/** 見出しの項目（ラベル, 値）。客先用（精算のご提案）も同じ。値の null は「—」。工事名は入っているときだけ。 */
export function changeInfoRows(model: ChangeLedgerModel, meta: ChangeReportMeta): [string, string | null][] {
  const site = meta.site;
  return [
    ['現場名', site.name],
    ...(site.projectName ? [['工事名', site.projectName] as [string, string]] : []),
    ['工事番号', site.projectNo],
    ['期間', periodText(model, meta)],
    ['出力日時', jpDateTime(meta.outputAt)],
  ];
}

const KINDS: ChangeLedgerKind[] = ['extra', 'increase', 'change', 'minus'];

/** 率の表示（0.15 → '15'、0.125 → '12.5'）。 */
function ratePercent(rate: number): string {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(Math.round(rate * 1000) / 10);
}

/**
 * サマリー表（当初／契約内出来高／追加・増・変更・減（件数・申告額・提案額・精算額）／精算提案額）と注記。
 * 月の期間では、件数・申告額・提案額・契約内出来高は当月分、精算額と精算提案額は月末までの累計（モデルの summary[区分].settled・
 * settlement）。精算額の列見出しも「精算額（累計）」にする。精算提案額の下に、客先用の精算提案額（見積中の件を除く。
 * clientSettlement）を「客先提示額（見積中を除く）」として 1 行足す（社内で客先用と突き合わせるため）。
 */
export function changeSummary(model: ChangeLedgerModel): { table: SectionTable; notes: string[] } {
  const st = model.settlement;
  const blank: Cell[] = ['', '', ''];
  const table: SectionTable = {
    columns: [
      col.text('項目', 4.2),
      col.num('件数', 1),
      col.num('申告額(円)', 2),
      col.num('提案額(円)', 2),
      col.num(st.through ? '精算額（累計）(円)' : '精算額(円)', 2.4),
    ],
    rows: [
      [st.baseBasis === 'estimate' ? '当初見積（概算）' : '当初請負金額', ...blank, cell.yen(st.base)],
      ['契約内出来高', ...blank, cell.yen(model.contractOutput)],
      ...KINDS.map((k): Cell[] => {
        const s = model.summary[k];
        return [CHANGE_KIND_LABELS[k], cell.int(s.count), cell.yen(s.declared), cell.yen(s.proposal), cell.yen(s.settled)];
      }),
    ],
    total: [st.through ? `精算提案額（${slashDate(st.through)} までの累計）` : '精算提案額', ...blank, cell.yen(st.proposed)],
    after: [[CLIENT_PROPOSED_LABEL, ...blank, cell.yen(clientSettlement(model).proposed)]],
  };
  const { overheadRate, profitRate } = model.rates;
  const notes = [
    `提案額＝実績原価×(1＋経費率 ${ratePercent(overheadRate)}%)×(1＋利益率 ${ratePercent(profitRate)}%)、円未満切り上げ。減は申告額。` +
      '実績原価＝投入人工×その日の平均日当＋その日の材料・リース・燃料を人工比で按分。',
    SETTLED_NOTE,
    // 契約内出来高も当月分（精算額の列に出すが累計ではない）
    ...(st.through ? ['件数・申告額・提案額と契約内出来高は当月分。精算額と精算提案額は月末までの累計です。'] : []),
    ...(st.proposed === null ? [NO_BASE_NOTE] : []),
  ];
  return { table, notes };
}

/** 確定額・単価の欄：一式・見積は確定額（見積額。減は負）、常用は「常用 N人工 × ¥単価」、未定は「—」。 */
function settlementTerms(i: ChangeIssueSettlement): Cell {
  switch (i.settlementMethod) {
    case 'lump_sum':
    case 'estimate':
      return cell.yen(i.fixedAmount === null ? null : i.category === 'minus' ? -i.fixedAmount : i.fixedAmount);
    case 'daily_rate': {
      const rate = i.dailyRate === null ? '単価未入力' : `¥${formatCell(cell.yen(i.dailyRate))}`;
      return `常用 ${formatCell(cell.dec1(i.manDays))}人工 × ${rate}`;
    }
    case 'undecided':
      return null;
  }
}

/**
 * 件ごとの精算（件・見込み額・精算方法・確定額・単価・確定日・行数・投入人工・提案額・精算額）。件の日付順に 1 行ずつ、
 * 件に紐づかない行があれば最後に「件なし」の 1 行（精算額は提案額）。やり直しの件は精算額を「（参考）¥額」と出し、合計に入れない。
 * 行数・人工・提案額は期間末までの累計（件の精算額と同じ範囲）。件も件なしの行も無ければ null（表を出さない）。
 */
export function changeIssues(model: ChangeLedgerModel): SectionTable | null {
  const { issues, unlinked } = model;
  if (issues.length === 0 && unlinked.lineCount === 0) return null;
  const counted = issues.filter((i) => i.countsToward);
  const sum = (pick: (i: ChangeIssueSettlement) => number, extra: number) => counted.reduce((s, i) => s + pick(i), 0) + extra;
  return {
    // 列幅の比 w は PDF（8pt）での mm の目安（合計 180）。見出し・「常用 N人工 × ¥単価」・「（参考）¥額」が 1 行に収まる幅
    columns: [
      col.text('件', 36),
      col.num('見込み額(円)', 18),
      col.text('精算方法', 13),
      col.num('確定額・単価', 35),
      col.text('確定日', 18),
      col.num('行数', 7),
      col.num('投入人工', 13),
      col.num('提案額(円)', 16),
      col.num('精算額(円)', 24),
    ],
    rows: [
      ...issues.map((i): Cell[] => [
        `${i.reportDate.slice(5).replace('-', '/')}-${i.number} ${ISSUE_KIND_LABELS[i.kind]} ${i.bodyHead}`.trim(),
        cell.yen(i.amountEstimate),
        SETTLEMENT_METHOD_LABELS[i.settlementMethod],
        settlementTerms(i),
        i.fixedOn ? slashDate(i.fixedOn) : '',
        cell.int(i.lineCount),
        cell.dec1(i.manDays),
        cell.yen(i.proposal),
        i.countsToward ? cell.yen(i.settled) : `（参考）¥${formatCell(cell.yen(i.settled))}`,
      ]),
      ...(unlinked.lineCount > 0
        ? [
            [
              UNLINKED_LABEL, '', '', '', '',
              cell.int(unlinked.lineCount), cell.dec1(unlinked.manDays), cell.yen(unlinked.proposal), cell.yen(unlinked.proposal),
            ] satisfies Cell[],
          ]
        : []),
    ],
    total: [
      '合計', '', '', '', '',
      cell.int(sum((i) => i.lineCount, unlinked.lineCount)),
      cell.dec1(sum((i) => i.manDays, unlinked.manDays)),
      cell.yen(sum((i) => i.proposal, unlinked.proposal)),
      cell.yen(sum((i) => i.settled, unlinked.proposal)),
    ],
  };
}

/** 件ごとの精算の見出しの補足（月の期間は「YYYY/MM/DD までの累計」、工期全体は無し）。 */
export function changeIssuesNote(model: ChangeLedgerModel): string | undefined {
  const { through } = model.settlement;
  return through ? `${slashDate(through)} までの累計` : undefined;
}

function issueText(row: ChangeLedgerRow): string {
  const i = row.issue;
  if (!i) return '';
  return `${i.reportDate.slice(5).replace('-', '/')}-${i.number} ${ISSUE_KIND_LABELS[i.kind]} ${i.bodyHead}`.trim();
}

/**
 * 明細一覧（15 列）。PDF は 1 件を 2 段（上段：区分〜提案額、下段：指示者〜客先確認。日付は 2 段をまたぐ）、
 * Excel は 1 行に並べる。列幅の比 w は PDF の各段の中での比（mm の目安。上段・下段とも合計 162、日付 18 と合わせて 180）。
 * 減の数量は負で表示する（提案額は申告額）。社内確認用の明細なので実績原価の列がある。未入力の文字は空欄。
 */
export function changeDetail(model: ChangeLedgerModel): SectionTable {
  return {
    columns: [
      col.text('日付（当月N回目）', 18),
      col.text('区分', 8),
      col.text('工種', 16),
      col.text('施工内容', 50),
      col.num('数量', 12),
      col.text('単位', 8),
      col.num('単価(円)', 16),
      col.num('申告額(円)', 19.5),
      col.num('投入人工', 13),
      col.num('提案額(円)', 19.5),
      col.text('指示者', 30),
      col.text('指示方法', 14),
      col.text('指示日', 18),
      col.text('根拠の件', 86),
      col.text('客先確認', 14),
    ],
    rows: model.rows.map((r) => [
      `${slashDate(r.date)}\n当月${r.monthIndex}回目`,
      CHANGE_KIND_LABELS[r.changeKind],
      r.trade,
      r.description,
      cell.qty(r.qty === null ? null : r.changeKind === 'minus' ? -r.qty : r.qty),
      r.unit,
      cell.yen(r.unitPrice),
      cell.yen(r.declared),
      cell.dec1(r.manDays),
      cell.yen(r.proposal),
      r.instructedBy ?? '',
      r.instructionMethod ? INSTRUCTION_METHOD_LABELS[r.instructionMethod] : '',
      r.instructedOn ? slashDate(r.instructedOn) : '',
      issueText(r),
      r.clientConfirmed ? 'あり' : 'なし',
    ]),
  };
}

/** 末尾の発行者欄（会社名・担当者・連絡先。未設定は ''）。担当者は出力した人。 */
export function senderRows(meta: ChangeReportMeta): [string, string][] {
  return [
    ['会社名', meta.company.name ?? ''],
    ['担当者', meta.by],
    ['連絡先', meta.company.contact ?? ''],
  ];
}

/** 脚注の左側「現場日報アプリ ― 変更増減 社内確認用 YYYY/MM/DD HH:mm」。 */
export function changeFooterText(meta: ChangeReportMeta): string {
  return `現場日報アプリ ― ${CHANGE_REPORT_TITLE} ${jpDateTime(meta.outputAt)}`;
}
