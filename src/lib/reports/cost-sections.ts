import { STATUS_LABELS } from '@/components/sites/labels';
import { jpDateTime } from '@/lib/calc/format';
import type { CostReportModel, LeaseRow, TrendRow } from '@/lib/reports/types';

// 工事原価集計表の中身（見出し・①〜⑦の表）を PDF・Excel・CSV 共通の形にする（純関数）。
// 値は数値のまま持ち、書式（NumFmt）だけ決める。数値の文字列化は各レンダラー（PDF は formatCell）。

export const COST_REPORT_TITLE = '工事原価集計表';
export const NO_REPORTS = '日報がありません';
/**
 * ④-2 の見出しの補足（PDF では見出しの横に 1 行で出すので短く）。請負労務費は請負の日の人工 × 設定日当（残業を含む）、
 * 請負金額は現場の協力会社の欄の額（現場全体。月の帳票でもそのまま）。
 */
export const AFFILIATION_NOTES = ['繰越初期値は自社の常用', '差額＝請負金額−請負労務費'] as const;

/** yen・int = #,##0、dec1 = 0.0（人工・歩掛・距離・残業 H）、qty = 小数 2 桁まで、pct = 0.0%（値は 0..1）。 */
export type NumFmt = 'yen' | 'int' | 'dec1' | 'qty' | 'pct';
/** 文字列はそのまま（'' は空欄）、null は「—」、数値は書式つき（value が null なら「—」）。 */
export type Cell = string | null | { value: number | null; fmt: NumFmt };

export interface Column {
  label: string;
  /** 数値の列（右寄せ）。 */
  num: boolean;
  /** PDF の列幅の比。 */
  w: number;
}

export interface SectionTable {
  columns: Column[];
  rows: Cell[][];
  /** 合計行（太字）。 */
  total?: Cell[];
  /** 合計行の下に続ける行（普通の太さ。変更増減 社内確認用の「客先提示額」）。 */
  after?: Cell[][];
  /** 太字にする行（rows の添字。日報の作業内容の追加・増・変更・減の行）。PDF だけが使う。 */
  boldRows?: number[];
  /**
   * 行のまとまり（変更増減の明細の「件ごと」）。あれば rows の代わりにこれを描く（rows はまとまりの行を順に並べたものと同じ）。
   * まとまりごとに、表の幅いっぱいの見出し行（太字・帯）→ 行 → 小計の行（太字。subtotal.at の列の右端に揃える）。
   */
  groups?: TableGroup[];
}

export interface TableGroup {
  title: string;
  rows: Cell[][];
  /** 小計の文（「小計 2 日・3.5 人工」）と、右端を揃える列の番号。 */
  subtotal: { label: string; at: number };
}

export interface CostSection {
  title: string;
  /** 見出しの横に小さく出す補足（集計の範囲など）。 */
  note?: string;
  tables: SectionTable[];
}

const yen = (value: number | null): Cell => ({ value, fmt: 'yen' });
const int = (value: number | null): Cell => ({ value, fmt: 'int' });
const dec1 = (value: number | null): Cell => ({ value, fmt: 'dec1' });
const qty = (value: number | null): Cell => ({ value, fmt: 'qty' });
const pct = (value: number | null): Cell => ({ value, fmt: 'pct' });

const text = (label: string, w = 3): Column => ({ label, num: false, w });
const num = (label: string, w = 2): Column => ({ label, num: true, w });

/** セル・列の作り方（日報の表 daily-sections.ts でも使う）。 */
export const cell = { yen, int, dec1, qty, pct };
export const col = { text, num };

/** 'YYYY-MM-DD' → 'YYYY/MM/DD'。 */
export function slashDate(date: string): string {
  return date.replaceAll('-', '/');
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${month.slice(5, 7)}月`;
}

/** 出力日時（ISO があれば JST の 'YYYY/MM/DD HH:mm'、無ければ日付だけ）。 */
export function outputDateTime(date: string, at: string | null): string {
  return at ? jpDateTime(at) : slashDate(date);
}

function range(from: string | null, to: string | null): string {
  return `${from ? slashDate(from) : '—'}〜${to ? slashDate(to) : '—'}`;
}

/** 見出しの項目（ラベル, 値）。値の null は「—」（CSV は空欄）。 */
export function headerRows(model: CostReportModel): [string, string | null][] {
  const h = model.header;
  const term = h.startDate || h.endDate ? range(h.startDate, h.endDate) : null;
  const elapsed = h.elapsedDays !== null ? `経過 ${h.elapsedDays} 日` : null;
  const p = h.period;
  const span = p.from || p.to ? `（${range(p.from, p.to)}）` : '';
  return [
    ['現場名', h.siteName],
    ...(h.projectName ? [['工事名', h.projectName] as [string, string]] : []),
    ['客先名', h.clientName],
    ['工事番号', h.projectNo],
    ['請負の種類', h.contractType],
    ['工事概要', h.overview],
    ['工期', term && elapsed ? `${term}（${elapsed}）` : (term ?? elapsed)],
    ['現場状態', STATUS_LABELS[h.siteStatus]],
    ['日報件数', `${h.reportCount} 件（承認済み ${h.approvedCount} 件）`],
    ['集計期間', `${p.kind === 'month' && p.month ? monthLabel(p.month) : '工期全体'}${span}`],
    ['出力日時', outputDateTime(h.outputDate, h.outputAt)],
  ];
}

/** 脚注の左側「現場日報アプリ ― 日報 N 件（承認済み M 件）から自動集計 YYYY/MM/DD HH:mm」。 */
export function footerText(model: CostReportModel): string {
  const f = model.footer;
  return `現場日報アプリ ― 日報 ${f.reportCount} 件（承認済み ${f.approvedCount} 件）から自動集計 ${outputDateTime(f.outputDate, f.outputAt)}`;
}

const withManual = (name: string, manual: boolean) => (manual ? `${name}（手入力）` : name);

function trendLabel(unit: 'month' | 'week', r: TrendRow): string {
  return unit === 'month' ? monthLabel(r.key) : `${r.from.slice(5).replace('-', '/')}〜${r.to.slice(5).replace('-', '/')}`;
}

function leaseQty(r: LeaseRow): Cell[] {
  return [qty(r.qty), r.qty === null ? '' : (r.unit ?? '')];
}

/** ①〜⑦。日報が無い（isEmpty）ときは空（レンダラーは「日報がありません」の 1 行を出す）。 */
export function costSections(model: CostReportModel): CostSection[] {
  if (model.isEmpty) return [];
  const { costs, profit, trend, workers, affiliations, vendors, equipment, trades } = model;
  const period = model.header.period;
  const upTo = period.kind === 'month' && period.month ? `${monthLabel(period.month)}末までの累計` : null;
  // 契約未確定の現場：粗利・進捗率は概算金額に対する見込み
  const estimate = profit.basis === 'estimate';

  const costRows: [string, number, number][] = [
    ['労務費', costs.labor, costs.shares.labor],
    ['車両費（燃料）', costs.fuel, costs.shares.fuel],
    ['リース費', costs.lease, costs.shares.lease],
    ['現金購入費', costs.cash, costs.shares.cash],
    ['買掛費', costs.credit, costs.shares.credit],
  ];

  const kv = (rows: [string, Cell][]): SectionTable => ({
    columns: [text('項目', 3.6), num('値', 1.6)],
    rows: rows.map(([k, v]) => [k, v]),
  });

  const t = trend.total;
  return [
    {
      title: '① 原価合計',
      tables: [
        {
          columns: [text('費目', 3), num('金額(円)', 2), num('構成比(%)', 1.5)],
          rows: costRows.map(([k, v, s]) => [k, yen(v), pct(s)]),
          total: ['原価合計', yen(costs.total), pct(costs.total !== 0 ? 1 : 0)],
        },
      ],
    },
    {
      title: '② 採算',
      note: [estimate ? '概算に対する見込み' : null, upTo].filter((v) => v !== null).join('・') || undefined,
      tables: [
        kv([
          ['工事総請負金額(円)', yen(profit.contractTotal)],
          ...(estimate ? [['概算金額(円)', yen(profit.estimatedAmount)] as [string, Cell]] : []),
          ['総原価(円)', yen(profit.totalCost)],
          ['粗利益(円)', yen(profit.grossProfit)],
          ['粗利率(%)', pct(profit.grossMargin)],
          ['累計出来高(円)', yen(profit.cumulativeOutput)],
          [estimate ? '進捗率（累計原価÷概算）(%)' : '進捗率（出来高÷請負）(%)', pct(profit.progress)],
          ['総人工', dec1(profit.totalManDays)],
          ['1 人工あたり原価(円)', yen(profit.costPerManDay)],
          [`1 日あたり原価（日報日数 ${profit.dayCount} 日）(円)`, yen(profit.costPerDay)],
          ['追加・増・変更・減の精算額（円）', yen(profit.changeProposal)],
        ]),
      ],
    },
    {
      title: trend.unit === 'month' ? '③ 月別推移' : '③ 週別推移',
      note: trend.unit === 'week' ? '月曜始まり。累計原価・進捗率は現場の最初の日報からの累計' : '累計原価・進捗率は現場の最初の日報からの累計',
      tables: [
        {
          // 幅は A4 縦（本文幅 180mm・7.5pt）で 9 桁の金額（太字の合計行）と「MM/DD〜MM/DD」が 1 行に収まる比。
          columns: [
            text(trend.unit === 'month' ? '年月' : '週', 2.4),
            num('日報件数', 1.6),
            num('労務費', 2.05),
            num('車両費', 2.05),
            num('リース費', 2.05),
            num('現金購入', 2.05),
            num('買掛', 2.05),
            num('原価合計', 2.3),
            num('出来高', 2.3),
            num('累計原価', 2.3),
            num('進捗率(%)', 1.8),
          ],
          rows: trend.rows.map((r) => [
            trendLabel(trend.unit, r),
            int(r.reportCount),
            yen(r.labor),
            yen(r.fuel),
            yen(r.lease),
            yen(r.cash),
            yen(r.credit),
            yen(r.cost),
            yen(r.output),
            yen(r.cumulativeCost),
            pct(r.progress),
          ]),
          total: ['合計', int(t.reportCount), yen(t.labor), yen(t.fuel), yen(t.lease), yen(t.cash), yen(t.credit), yen(t.cost), yen(t.output), yen(t.cumulativeCost), pct(t.progress)],
        },
      ],
    },
    {
      title: '④ 作業員別累計',
      note: upTo ? `${upTo}（繰越初期値を含む）` : '繰越初期値を含む',
      tables: [
        {
          columns: [
            text('作業員名', 4),
            text('職種', 2.2),
            text('所属', 3),
            num('出勤日数', 1.5),
            num('人工', 1.5),
            num('残業H', 1.5),
            num('労務費(円)', 2.5),
          ],
          rows: workers.rows.map((r) => [
            withManual(r.workerName, r.manual),
            r.trade,
            r.affiliationLabel,
            int(r.workDays),
            dec1(r.manDays),
            dec1(r.overtimeHours),
            yen(r.cost),
          ]),
          total: ['合計', '', '', int(workers.total.workDays), dec1(workers.total.manDays), dec1(workers.total.overtimeHours), yen(workers.total.cost)],
        },
      ],
    },
    {
      title: '④-2 所属別の人工・労務費',
      note: [upTo, ...AFFILIATION_NOTES].filter((v) => v !== null).join('・'),
      tables: [
        {
          // 幅は A4 縦（本文幅 180mm・7.5pt。9 列以上の表は文字を小さくする）で 9 桁の金額（太字の合計行）と列見出しが
          // 1 行に収まる比。請負労務費は請負の日の人工 × 設定日当（請負金額と比べる）。
          columns: [
            text('所属', 2.6),
            num('常用人工', 1.3),
            num('常用労務費(円)', 2.1),
            num('請負人工', 1.3),
            num('請負労務費(円)', 2.1),
            num('合計人工', 1.3),
            num('合計労務費(円)', 2.1),
            num('請負金額(円)', 2.1),
            num('差額(円)', 2.1),
          ],
          rows: affiliations.rows.map((r) => [
            r.label,
            dec1(r.jouyouManDays),
            yen(r.jouyouCost),
            dec1(r.ukeoiManDays),
            yen(r.ukeoiCost),
            dec1(r.manDays),
            yen(r.cost),
            // 請負金額が未入力・協力会社以外は空欄
            r.partnerAmount === null ? '' : yen(r.partnerAmount),
            r.difference === null ? '' : yen(r.difference),
          ]),
          total: [
            '合計',
            dec1(affiliations.total.jouyouManDays),
            yen(affiliations.total.jouyouCost),
            dec1(affiliations.total.ukeoiManDays),
            yen(affiliations.total.ukeoiCost),
            dec1(affiliations.total.manDays),
            yen(affiliations.total.cost),
            affiliations.total.partnerAmount === null ? '' : yen(affiliations.total.partnerAmount),
            affiliations.total.difference === null ? '' : yen(affiliations.total.difference),
          ],
        },
      ],
    },
    {
      title: '⑤ 取引先別累計',
      tables: [
        {
          columns: [text('取引先名', 4), num('現金購入(円)', 2), num('買掛(円)', 2), num('合計(円)', 2)],
          rows: vendors.rows.map((r) => [r.name === '' ? '（取引先なし）' : withManual(r.name, r.manual), yen(r.cash), yen(r.credit), yen(r.total)]),
          total: ['合計', yen(vendors.total.cash), yen(vendors.total.credit), yen(vendors.total.total)],
        },
      ],
    },
    {
      title: '⑥ 車両・リース',
      tables: [
        {
          columns: [text('車両', 4), num('走行距離(km)', 2), num('燃料費(円)', 2)],
          rows: equipment.vehicles.map((r) => [withManual(r.name, r.manual), dec1(r.distanceKm), yen(r.fuelCost)]),
          total: ['合計', dec1(equipment.total.distanceKm), yen(equipment.total.fuelCost)],
        },
        {
          columns: [text('リース品', 4), num('数量合計', 1.6), text('単位', 1), num('リース費(円)', 2)],
          rows: equipment.leases.map((r) => [withManual(r.name, r.manual), ...leaseQty(r), yen(r.leaseCost)]),
          total: ['合計', '', '', yen(equipment.total.leaseCost)],
        },
      ],
    },
    {
      title: '⑦ 工種別出来高',
      tables: [
        {
          columns: [
            text('工種', 2.4),
            text('主な施工内容', 3.4),
            num('施工数量', 1.6),
            text('単位', 1),
            num('投入人工', 1.4),
            num('歩掛', 1.3),
            num('出来高(円)', 2.2),
            num('構成比(%)', 1.5),
          ],
          rows: trades.rows.map((r) => [
            r.trade === '' ? '（工種なし）' : r.trade,
            r.mainDescription,
            qty(r.qty),
            r.qty === null ? '' : (r.unit ?? ''),
            dec1(r.manDays),
            dec1(r.productivity),
            yen(r.output),
            pct(r.share),
          ]),
          total: ['合計', '', '', '', dec1(trades.total.manDays), '', yen(trades.total.output), pct(trades.total.output !== 0 ? 1 : 0)],
        },
      ],
    },
  ];
}

// ─── 数値の文字列化（PDF・見出し用） ───

/** 四捨五入（0.5 は絶対値側へ）。-0 は 0。 */
function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  const r = (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
  return r === 0 ? 0 : r;
}

const NF = {
  int: new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }),
  dec1: new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  qty: new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }),
};

/** セルの表示文字列（null・value null は「—」、金額は ¥ なしの #,##0、比率は % の数値 0.0。単位は列見出しに書く）。 */
export function formatCell(c: Cell): string {
  if (c === null) return '—';
  if (typeof c === 'string') return c;
  const { value, fmt } = c;
  if (value === null) return '—';
  switch (fmt) {
    case 'yen':
    case 'int':
      return NF.int.format(roundTo(value, 0));
    case 'dec1':
      return NF.dec1.format(roundTo(value, 1));
    case 'qty':
      return NF.qty.format(roundTo(value, 2));
    case 'pct':
      return NF.dec1.format(roundTo(value * 100, 1));
  }
}

/** CSV・Excel に書く数値（金額は整数、人工・数量は小数 2 桁まで、比率は CSV なら % の数値・Excel なら 0..1）。 */
export function cellNumber(value: number, fmt: NumFmt, pctAsPercent: boolean): number {
  switch (fmt) {
    case 'yen':
    case 'int':
      return roundTo(value, 0);
    case 'dec1':
    case 'qty':
      return roundTo(value, 2);
    case 'pct':
      return pctAsPercent ? roundTo(value * 100, 1) : value;
  }
}
