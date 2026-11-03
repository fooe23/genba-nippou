import { jpDateTime } from '@/lib/calc/format';
import type { Site } from '@/lib/db/sites';
import { CHANGE_KIND_LABELS, INSTRUCTION_METHOD_LABELS, ISSUE_KIND_LABELS } from '@/lib/report/change-labels';
import { cell, col, slashDate, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { ChangeLedgerKind, ChangeLedgerModel, ChangeLedgerRow } from '@/lib/reports/types';

// 変更増減 精算資料（案）の中身（宛先・見出し・サマリー表・注記・明細・末尾）を PDF・Excel 共通の形にする（純関数）。
// セルの形（Cell・NumFmt）と文字列化（formatCell）は工事原価集計表（cost-sections.ts）と同じ。

export const CHANGE_REPORT_TITLE = '変更増減 精算資料（案）';
export const CHANGE_SUBJECT = '追加・変更工事 精算のご提案（案）';
export const CHANGE_SHEET_NAME = '変更増減精算資料';
export const NO_CHANGES = '追加・変更・減の記録はありません';
export const NO_BASE_NOTE = '当初金額が未設定のため算出できません';
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

/** 宛先：「客先名 御中」。客先名が無ければ「（客先名未設定）」（御中は付けない）。 */
export function addressee(site: Pick<Site, 'clientName'>): string {
  const name = site.clientName?.trim();
  return name ? `${name} 御中` : '（客先名未設定）';
}

function periodText(model: ChangeLedgerModel, meta: ChangeReportMeta): string {
  const { month } = model.period;
  if (model.period.kind === 'month' && month) return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
  const { from, to } = meta.reportSpan;
  return from && to ? `工期全体（${slashDate(from)}〜${slashDate(to)}）` : '工期全体';
}

/** 見出しの項目（ラベル, 値）。値の null は「—」。工事名は入っているときだけ。 */
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

const KINDS: ChangeLedgerKind[] = ['extra', 'change', 'minus'];

/** 率の表示（0.15 → '15'、0.125 → '12.5'）。 */
function ratePercent(rate: number): string {
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(Math.round(rate * 1000) / 10);
}

/**
 * サマリー表（当初／契約内出来高／追加・変更・減（件数・申告額・提案額）／精算提案額）と注記。
 * 月の期間では、追加・変更・減・契約内出来高は当月分、精算提案額は月末までの累計（モデルの settlement）。
 */
export function changeSummary(model: ChangeLedgerModel): { table: SectionTable; notes: string[] } {
  const st = model.settlement;
  const blank: Cell[] = ['', ''];
  const table: SectionTable = {
    columns: [col.text('項目', 4.2), col.num('件数', 1), col.num('申告額(円)', 2), col.num('提案額・金額(円)', 2.2)],
    rows: [
      [st.baseBasis === 'estimate' ? '当初見積（概算）' : '当初請負金額', ...blank, cell.yen(st.base)],
      ['契約内出来高', ...blank, cell.yen(model.contractOutput)],
      ...KINDS.map((k): Cell[] => {
        const s = model.summary[k];
        return [CHANGE_KIND_LABELS[k], cell.int(s.count), cell.yen(s.declared), cell.yen(s.proposal)];
      }),
    ],
    total: [st.through ? `精算提案額（${slashDate(st.through)} までの累計）` : '精算提案額', ...blank, cell.yen(st.proposed)],
  };
  const { overheadRate, profitRate } = model.rates;
  const notes = [
    `提案額＝実績原価×(1＋経費率 ${ratePercent(overheadRate)}%)×(1＋利益率 ${ratePercent(profitRate)}%)、円未満切り上げ。減は申告額。` +
      '実績原価＝投入人工×その日の平均日当＋その日の材料・リース・燃料を人工比で按分。',
    ...(st.through
      ? ['追加・変更・減と契約内出来高は当月分。精算提案額は最初の日報から月末までの累計で計算しています。']
      : []),
    ...(st.proposed === null ? [NO_BASE_NOTE] : []),
  ];
  return { table, notes };
}

function issueText(row: ChangeLedgerRow): string {
  const i = row.issue;
  if (!i) return '';
  return `${i.reportDate.slice(5).replace('-', '/')}-${i.number} ${ISSUE_KIND_LABELS[i.kind]} ${i.bodyHead}`.trim();
}

/**
 * 明細一覧（16 列）。PDF は 1 件を 2 段（上段：区分〜提案額、下段：指示者〜客先確認。日付は 2 段をまたぐ）、
 * Excel は 1 行に並べる。列幅の比 w は PDF の各段の中での比（mm の目安）。
 * 減の数量は負で表示し、実績原価は積み上げないので「—」（提案額は申告額）。未入力の文字は空欄。
 */
export function changeDetail(model: ChangeLedgerModel): SectionTable {
  return {
    columns: [
      col.text('日付（当月N回目）', 18),
      col.text('区分', 8),
      col.text('工種', 14),
      col.text('施工内容', 37.5),
      col.num('数量', 12),
      col.text('単位', 8),
      col.num('単価(円)', 14),
      col.num('申告額(円)', 18),
      col.num('投入人工', 13),
      col.num('実績原価(円)', 19.5),
      col.num('提案額(円)', 18),
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
      r.proposalBasis === 'declared' ? null : cell.yen(r.actualCost.total),
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

/** 脚注の左側「現場日報アプリ ― 変更増減 精算資料（案） YYYY/MM/DD HH:mm」。 */
export function changeFooterText(meta: ChangeReportMeta): string {
  return `現場日報アプリ ― ${CHANGE_REPORT_TITLE} ${jpDateTime(meta.outputAt)}`;
}
