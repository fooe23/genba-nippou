import type { ChangeTotals } from '@/lib/calc/change';
import { weekday } from '@/lib/calc/calendar';
import { jpDateTime } from '@/lib/calc/format';
import { ISSUE_STATUS_LABELS, withChangeKindPrefix } from '@/lib/report/change-labels';
import { outputBreakdown } from '@/lib/report/contract-work';
import { cell, col, formatCell, slashDate, type Cell, type SectionTable } from '@/lib/reports/cost-sections';
import type { DailyClientConfirmation, DailyHeader, DailyReportModel, DailyWorkerRow, DailyWorkRow } from '@/lib/reports/types';
import type { LineKind, TimeSpec } from '@/lib/types';

// 日報の帳票（PDF・CSV）で共通に使うラベル。並びは雛形の日報シートと同じ。

/** 明細の種別（CSV の「種別」列、PDF の表の見出し）。 */
export const LINE_KIND_LABELS: Record<LineKind, string> = {
  labor: '作業員',
  fuel: '車両',
  lease: 'リース',
  cash: '現金購入',
  credit: '買掛',
  work: '作業内容',
};

/** 明細以外の欄の見出し。 */
export const DAILY_SECTION_TITLES = {
  costs: '本日原価集計',
  output: '本日出来高',
  issues: '重要事項',
  notes: '連絡事項',
} as const;

/** 重要事項の件の状態（日報画面と同じ言い方）。 */
export { ISSUE_STATUS_LABELS };

/** マスターの参照が無い（手入力の）名前に付ける。 */
export const MANUAL_SUFFIX = '（手入力）';

export function withManual(name: string, manual: boolean): string {
  return manual ? `${name}${MANUAL_SUFFIX}` : name;
}

/**
 * 作業内容の施工内容。追加・増・変更・減の行は頭に【追加】【増】【変更】【減】を付ける（PDF の表と CSV の「施工内容」で共通。
 * CSV の列は増やさない）。契約内はそのまま。
 */
export function workDescription(r: Pick<DailyWorkRow, 'changeKind' | 'description'>): string {
  return withChangeKindPrefix(r.changeKind, r.description);
}

/** 契約が未確定の現場で、請負金額の行に付ける見出し（進捗率の「—」の理由を示す。概算金額の行を続けて出す）。 */
export const CONTRACT_TENTATIVE_LABEL = '請負金額（未確定）(円)';

/** 作業内容の表の下に出す小計の見出し。 */
export const CHANGE_TOTALS_TITLE = '本日の追加・増・変更・減';

/** 符号つきの金額（+1,000・−1,000・0）。 */
function signedYen(n: number): string {
  const abs = formatCell(cell.yen(Math.abs(n)));
  if (abs === '0') return '0';
  return n > 0 ? `+${abs}` : `−${abs}`;
}

/** 「追加 +x／増 +y／変更 +z／減 −w」（保存値の合計。DailyReportModel.work.changes）。 */
export function changeTotalsText(t: ChangeTotals): string {
  return `追加 ${signedYen(t.extra)}／増 ${signedYen(t.increase)}／変更 ${signedYen(t.change)}／減 ${signedYen(t.minus)}`;
}

/** 本日出来高の表の、契約外（追加・増・変更・減）の合計の見出し。 */
export const SETTLEMENT_OUTPUT_LABEL = '追加・変更（精算が必要）(円)';

/** 0 でない区分の [表示名, 金額]（追加・増・変更・減の順。null は空）。 */
function changeParts(t: ChangeTotals | null): [string, number][] {
  if (!t) return [];
  const parts: [string, number][] = [
    ['追加', t.extra],
    ['増', t.increase],
    ['変更', t.change],
    ['減', t.minus],
  ];
  return parts.filter(([, v]) => v !== 0);
}

/** 客先確認の欄の見出し。 */
export const CLIENT_CONFIRMATION_TITLE = '客先確認';

/**
 * 客先確認の枠（ラベル, 値）。記録が無ければ 確認者名／日付／サイン の空欄（印刷してサインをもらう）。
 * 記録があれば確認者名と確認日時（日本時間の YYYY/MM/DD HH:mm）を入れ、サインの枠は空のまま。メモは枠の下に別に出す。
 */
export function clientConfirmationBoxes(c: DailyClientConfirmation | null): [string, string][] {
  if (c === null) return [['確認者名', ''], ['日付', ''], ['サイン', '']];
  return [['確認者名', c.by], ['確認日時', jpDateTime(c.at)], ['サイン', '']];
}

/** CSV の列（明細 1 行 1 レコード）。 */
export const DAILY_CSV_COLUMNS = [
  '日付', '回目(当月)', '通算', '種別', '名前', '規格', '単位', '数量', '単価', '金額',
  '開始', '終了', '休憩分', '中抜分', '実働H', '人工', '残業H', '取引先', '工種', '施工内容', '備考',
] as const;

// ─── PDF の見出しと表（純関数）。セル・書式は工事原価集計表と同じ（cost-sections.ts の Cell・formatCell） ───

export const DAILY_REPORT_TITLE = '現場日報';
/** 行の無い表・空の欄に出す文。 */
export const NONE = 'なし';

/** 'YYYY-MM-DD' → 'YYYY/MM/DD（曜）'。日報の無い月（buildEmptyDailyReport(site, 'YYYY-MM')）は 'YYYY年MM月'。 */
export function dailyDateLabel(date: string): string {
  if (date.length === 7) return `${date.slice(0, 4)}年${date.slice(5, 7)}月`;
  return `${slashDate(date)}（${weekday(date)}）`;
}

/** 「当月 N 回目／通算 M 回目」（日報の無い日は null）。 */
export function visitText(h: DailyHeader): string | null {
  if (h.monthIndex === null || h.totalIndex === null) return null;
  return `当月 ${h.monthIndex} 回目／通算 ${h.totalIndex} 回目`;
}

/** 共通時間「08:00〜17:30　休憩 90分　中抜 0分」。空の休憩・中抜は書かない。全部空なら null。 */
export function commonTimeText(t: TimeSpec): string | null {
  const parts: string[] = [];
  if (t.start !== null || t.end !== null) parts.push(`${t.start ?? ''}〜${t.end ?? ''}`);
  if (t.breakMin !== null) parts.push(`休憩 ${t.breakMin}分`);
  if (t.gapMin !== null) parts.push(`中抜 ${t.gapMin}分`);
  return parts.length > 0 ? parts.join('　') : null;
}

/** 見出しの項目（ラベル, 値）。値の null は「—」。 */
export function dailyHeaderRows(m: DailyReportModel): [string, string | null][] {
  const h = m.header;
  return [
    ['工事番号', h.projectNo],
    ['天候', h.weather],
    ['作業責任者', h.supervisor],
    ['共通時間', commonTimeText(h.common)],
  ];
}

const { yen, int, qty, pct } = cell;
const { text, num } = col;
/** 空欄にする値（休憩・中抜・備考など）。null は「—」ではなく ''。 */
const blankInt = (v: number | null): Cell => (v === null ? '' : int(v));

const kv = (rows: [string, Cell][], total?: [string, Cell]): SectionTable => ({
  columns: [text('費目', 3), num('金額(円)', 2)],
  rows: rows.map(([k, v]) => [k, v]),
  total,
});

/**
 * 日報の表（雛形の並び）。金額・人工・残業・実働は保存値のまま。本日原価集計の合計は明細の保存値の和（外注の買掛を含む）。
 * 手入力の名前には「（手入力）」。作業内容の追加・増・変更・減の行は【区分】つきで太字（boldRows）。行が無い表は rows が空（PDF は「なし」の 1 行を出す）。
 */
/**
 * 作業員の行の備考。請負の行は頭に【請負】（うち常用の時間があれば【請負・うち常用 4H】）を付ける（2026-11-17。労務費は
 * うち常用の分だけ）。
 */
export function workerNote(r: Pick<DailyWorkerRow, 'contract' | 'jouyouHours' | 'note'>): string {
  if (r.contract !== 'ukeoi') return r.note;
  const tag = r.jouyouHours !== null && r.jouyouHours > 0 ? `【請負・うち常用 ${Math.round(r.jouyouHours * 100) / 100}H】` : '【請負】';
  return r.note ? `${tag}${r.note}` : tag;
}

export function dailyTables(m: DailyReportModel): Record<
  'workers' | 'vehicles' | 'leases' | 'cash' | 'credit' | 'costs' | 'output' | 'work' | 'issues',
  SectionTable
> {
  // 買掛は外注（2026-11-17）も入るので、列名は「支払金額」「支払先」。
  const purchase = (kind: 'cash' | 'credit', vendorLabel: string, amountLabel: string): SectionTable => ({
    columns: [text('品名', 3), text('規格', 2), num('数量', 1.2), text('単位', 1), num('単価(円)', 1.6), num(amountLabel, 1.8), text(vendorLabel, 2.6)],
    rows: m[kind].rows.map((r) => [r.name, r.spec, qty(r.qty), r.unit, yen(r.unitPrice), yen(r.amount), withManual(r.vendor, r.vendorManual)]),
    total: ['合計', '', '', '', '', yen(m[kind].total.amount), ''],
  });
  const w = m.workers;
  const c = m.costs;
  const split = outputBreakdown(m.output.today, m.work.changes);
  return {
    workers: {
      columns: [
        text('名前', 4),
        text('開始', 1.3),
        text('終了', 1.3),
        num('休憩(分)', 1.3),
        num('中抜(分)', 1.3),
        num('実働H', 1.2),
        num('人工', 1.1),
        num('残業H', 1.2),
        num('日当(円)', 1.6),
        num('労務費(円)', 1.8),
        text('備考', 2.2),
      ],
      rows: w.rows.map((r) => [
        withManual(r.name, r.manual),
        r.start ?? '',
        r.end ?? '',
        blankInt(r.breakMin),
        blankInt(r.gapMin),
        qty(r.hours),
        qty(r.manDays),
        qty(r.overtimeHours),
        yen(r.dailyRate),
        yen(r.cost),
        workerNote(r),
      ]),
      total: ['合計', '', '', '', '', qty(w.total.hours), qty(w.total.manDays), qty(w.total.overtimeHours), '', yen(w.total.cost), ''],
    },
    vehicles: {
      columns: [text('車両', 3.4), num('燃費(km/L)', 1.5), num('走行距離(km)', 1.7), num('燃料単価(円/L)', 1.8), num('燃料費(円)', 1.8), text('備考', 2.8)],
      rows: m.vehicles.rows.map((r) => [withManual(r.name, r.manual), qty(r.kmPerL), qty(r.distanceKm), qty(r.pricePerL), yen(r.cost), r.note]),
      total: ['合計', '', qty(m.vehicles.total.distanceKm), '', yen(m.vehicles.total.cost), ''],
    },
    leases: {
      columns: [text('品名', 3), text('規格', 2), num('数量', 1.2), text('単位', 1), num('単価(円)', 1.6), num('リース費(円)', 1.8), text('備考', 2.6)],
      rows: m.leases.rows.map((r) => [withManual(r.name, r.manual), r.spec, qty(r.qty), r.unit, yen(r.unitPrice), yen(r.amount), r.note]),
      total: ['合計', '', '', '', '', yen(m.leases.total.amount), ''],
    },
    cash: purchase('cash', '購入先', '金額(円)'),
    credit: purchase('credit', '支払先', '支払金額(円)'),
    costs: kv(
      [
        ['労務費', yen(c.labor)],
        // 請負の作業員の人工（うち常用の時間の外。2026-11-17）は出面だけで労務費に入れない。無い日は出さない。
        ...(w.total.ukeoiManDays > 0 ? [['　うち請負の人工（原価に数えない）', `${Math.round(w.total.ukeoiManDays * 100) / 100}人工`] as [string, Cell]] : []),
        ['車両費（燃料）', yen(c.fuel)],
        ['リース費', yen(c.lease)],
        ['現金購入費', yen(c.cash)],
        ['買掛費', yen(c.credit)],
        // 買掛のうち外注（2026-11-17）。外注の無い日は出さない。
        ...(c.subcontract !== 0 ? [['　うち外注', yen(c.subcontract)] as [string, string]] : []),
      ],
      ['合計', yen(c.total)],
    ),
    output: {
      columns: [text('項目', 3), num('値', 2)],
      // 本日出来高は「契約内」と「追加・変更（精算が必要。減は負）」に分け、区分ごとの内訳（0 の区分は出さない）と合計を出す（日報画面と同じ）。
      rows: [
        ['契約内の出来高(円)', yen(split.contract)],
        [SETTLEMENT_OUTPUT_LABEL, signedYen(split.changes)],
        ...changeParts(m.work.changes).map(([label, v]): Cell[] => [`　うち${label}`, signedYen(v)]),
        ['本日出来高 合計(円)', yen(split.total)],
        ['累計出来高(円)', yen(m.output.cumulative)],
        ...(m.output.tentative
          ? [
              [CONTRACT_TENTATIVE_LABEL, yen(m.output.contractAmount)],
              ['概算金額(円)', yen(m.output.estimatedAmount)],
            ]
          : [['請負金額(円)', yen(m.output.contractAmount)]]),
        ['進捗率(%)', pct(m.output.progress)],
      ],
    },
    work: {
      columns: [
        text('工種', 1.8),
        text('施工内容', 3.6),
        num('数量', 1.2),
        text('単位', 1),
        num('投入人工', 1.3),
        num('歩掛', 1.1),
        num('単価(円)', 1.6),
        num('金額(円)', 1.9),
      ],
      rows: m.work.rows.map((r) => [r.trade, workDescription(r), qty(r.qty), r.unit, qty(r.manDays), qty(r.productivity), yen(r.unitPrice), yen(r.amount)]),
      total: ['合計', '', '', '', qty(m.work.total.manDays), '', '', yen(m.work.total.amount)],
      boldRows: m.work.rows.flatMap((r, i) => (r.changeKind !== 'contract' ? [i] : [])),
    },
    issues: {
      columns: [text('件', 6), text('状態', 1.4)],
      rows: m.issues.items.map((i) => [i.body, ISSUE_STATUS_LABELS[i.status]]),
    },
  };
}
