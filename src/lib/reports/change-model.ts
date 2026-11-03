import { monthEnd } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import { visitNumbers } from '@/lib/calc/visit';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import { settlementCategory } from '@/lib/report/change-labels';
import type {
  AllocatedCost,
  ChangeIssueRef,
  ChangeIssueSettlement,
  ChangeKindSummary,
  ChangeLedgerInput,
  ChangeLedgerKind,
  ChangeLedgerModel,
  ChangeLedgerRow,
  ChangeRates,
  CostReportPeriod,
  ReportWithLines,
} from '@/lib/reports/types';

// 変更増減（追加・増・変更・減）の一覧と実績原価の積み上げ（純関数。DB・Next に依存しない）。
// 金額・人工はすべて保存値（明細の amount・man_days）から計算する。減の amount は DB のトリガーが負で保存している。
//
//   実績原価 = 行の投入人工 × その日の平均日当 ＋ その日の材料等の按分（allocateDayCost）。減の行は 0
//              （減の行の人工も、その日の按分の分母には入れる。現場で人工を使っているため）
//   提案金額 = 追加・増・変更：実績原価 ×（1＋経費率）×（1＋利益率）を円未満切り上げ（proposalFromCost）
//              減：申告額（入力の施工単価 × 数量。負）そのまま。減は原価を積み上げるものではないため
//   件ごとの精算額 = 一式：確定額、常用：ceil(紐づく行の人工の合計 × 常用単価)、未定：紐づく行の提案額の合計（settleIssue）
//              区分は件の種別から（settlementCategory）。減の区分の一式・常用は負。やり直しは参考で合計に入れない
//   区分ごとの精算額 = その区分の件の精算額 ＋ 件に紐づかない行の提案額（一式・常用の件に紐づく行の提案額は数えない）
//   精算提案額 = 当初（契約確定なら請負金額、未確定なら概算金額）＋ 追加 ＋ 増 ＋ 変更 ＋ 減（各区分の精算額。減は負）
//   増（同じ流れの中で数量が増えたもの）の計算・集計は追加（新しく別の仕事が増えたもの）と同じ。
//
// 期間が月のときは、一覧（rows）・区分ごとの件数・申告額・提案額・契約内の出来高はその月の日報の行だけ（回目は現場の
// 全日報で数える）。件ごとの精算・区分ごとの精算額・精算提案額（settlement）はその月末までの全部の行と、月末までに
// 載せる件で計算する（工事原価集計表 ② と同じ範囲）。一式・常用の件は件の日報日が月末以前なら載せる（確定日は見ない）。

/** 1 日（日報 1 件）の、実績原価の按分に使う合計（すべて保存値）。 */
export interface DayCostBasis {
  /** 労務費（労務の行の amount の合計）。 */
  laborCost: number;
  /** 労務の人工（労務の行の man_days の合計）。 */
  laborManDays: number;
  /** 燃料・リース・現金購入・買掛の amount の合計。 */
  otherCost: number;
  /** その日の作業内容の全行（契約内を含む）の投入人工の合計。 */
  workManDays: number;
}

export function dayCostBasis(report: ReportWithLines): DayCostBasis {
  const day: DayCostBasis = { laborCost: 0, laborManDays: 0, otherCost: 0, workManDays: 0 };
  for (const l of report.lines) {
    switch (l.kind) {
      case 'labor':
        day.laborCost += l.stored.amount;
        day.laborManDays += l.stored.manDays;
        break;
      case 'fuel':
      case 'lease':
      case 'cash':
      case 'credit':
        day.otherCost += l.stored.amount;
        break;
      case 'work':
        day.workManDays += l.stored.manDays;
        break;
    }
  }
  return day;
}

/**
 * 実績原価の按分の規則（ここだけに書く。tests/reports/change-model.test.ts で固定）。
 *
 * - 労務分 = 行の投入人工 × その日の平均日当（その日の労務費 ÷ その日の労務の人工）。労務の人工が 0 の日は 0。
 * - 材料等 = その日の燃料・リース・現金購入・買掛の合計 × 行の投入人工 ÷ その日の作業内容の全行（契約内・減を含む）の
 *   投入人工の合計。作業内容の人工の合計が 0 の日は 0。
 *
 * 労務の人工と作業内容の投入人工は別に入力するので、労務分の合計がその日の労務費と一致するとは限らない。
 * 円未満は丸めない（提案金額で切り上げる）。
 */
export function allocateDayCost(day: DayCostBasis, row: { manDays: number }): AllocatedCost {
  const labor = day.laborManDays > 0 && row.manDays !== 0 ? (row.manDays * day.laborCost) / day.laborManDays : 0;
  const other = day.workManDays > 0 && row.manDays !== 0 ? (day.otherCost * row.manDays) / day.workManDays : 0;
  return { labor, other, total: labor + other };
}

/**
 * 提案金額 = 実績原価 ×（1＋経費率）×（1＋利益率）、円未満切り上げ。
 * 浮動小数の誤差（10,000 × 1.15 × 1.1 = 12650.000000000002 など）を落としてから切り上げる。
 */
export function proposalFromCost(actualCost: number, rates: ChangeRates): number {
  return ceilYen(actualCost * (1 + rates.overheadRate) * (1 + rates.profitRate));
}

/** 円未満切り上げ。浮動小数の誤差（1.5 ＋ 0.7 人工 × 25,000 = 55000.00000000001 など）を落としてから切り上げる。 */
function ceilYen(raw: number): number {
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

/** 減の区分なら負にする（0 は −0 にしない）。 */
const signed = (amount: number, category: ChangeLedgerKind | null) => (category === 'minus' && amount !== 0 ? -amount : amount);

/**
 * 件ごとの精算額の規則（ここだけに書く。tests/reports/change-model.test.ts で固定）。linkedRows は期間末までの、この件に
 * 紐づく追加・増・変更・減の行。
 *
 * - 一式：確定額（無ければ 0）。紐づく行の提案額・人工は見ない。
 * - 常用：紐づく行の人工の合計 × 常用単価（無ければ 0）を円未満切り上げ。
 * - 未定：紐づく行の提案額の合計（減の行は負のまま）。
 * - 区分は件の種別から（settlementCategory）。区分が減なら一式・常用は負（確定額・単価は正で入れる）。
 * - やり直し（区分 null）は参考で、区分ごとの精算額・精算提案額に入れない（countsToward false）。
 */
export function settleIssue(
  issue: Issue,
  linkedRows: ChangeLedgerRow[],
): Pick<ChangeIssueSettlement, 'settled' | 'settledBasis' | 'countsToward' | 'category'> {
  const category = settlementCategory(issue.kind);
  const countsToward = category !== null;
  switch (issue.settlementMethod) {
    case 'lump_sum':
      return { settled: signed(issue.fixedAmount ?? 0, category), settledBasis: 'fixed', category, countsToward };
    case 'daily_rate': {
      const manDays = linkedRows.reduce((s, r) => s + r.manDays, 0);
      return { settled: signed(ceilYen(manDays * (issue.dailyRate ?? 0)), category), settledBasis: 'daily_rate', category, countsToward };
    }
    case 'undecided':
      return { settled: linkedRows.reduce((s, r) => s + r.proposal, 0), settledBasis: 'proposal', category, countsToward };
  }
}

/**
 * 現場の基準額：契約確定なら請負金額、未確定なら概算金額（無い・0 なら amount は null）。
 * 精算提案額の当初と、工事原価集計表の粗利・進捗率の基準（cost-model.ts）で使う。
 */
export function siteBaseAmount(site: Site): { amount: number | null; basis: 'contract' | 'estimate' } {
  const basis = site.contractStatus === 'tentative' ? 'estimate' : 'contract';
  const amount = basis === 'estimate' ? site.estimatedAmount : site.contractAmount;
  return { amount: amount ? amount : null, basis };
}

const BODY_HEAD = 40;
const bodyHead = (body: string) => [...body.trim()].slice(0, BODY_HEAD).join('');

/** 件 id → 根拠の件（番号はその件を書いた日報の件の中での登録順。input.issues の並びのまま数える）。 */
function issueRefs(issues: Issue[]): Map<string, ChangeIssueRef> {
  const countByReport = new Map<string, number>();
  const refs = new Map<string, ChangeIssueRef>();
  for (const i of issues) {
    const number = (countByReport.get(i.reportId) ?? 0) + 1;
    countByReport.set(i.reportId, number);
    refs.set(i.id, { id: i.id, reportDate: i.reportDate, number, kind: i.kind, bodyHead: bodyHead(i.body) });
  }
  return refs;
}

const emptySummary = (): ChangeKindSummary => ({ count: 0, declared: 0, actualCost: 0, proposal: 0, settled: 0 });

/** 行の件数・人工・実績原価・提案額の合計（人工は浮動小数の誤差を落とす）。 */
function sumRows(rows: ChangeLedgerRow[]): { lineCount: number; manDays: number; actualCost: number; proposal: number } {
  const manDays = rows.reduce((s, r) => s + r.manDays, 0);
  return {
    lineCount: rows.length,
    manDays: Math.round(manDays * 1e6) / 1e6,
    actualCost: rows.reduce((s, r) => s + r.actualCost.total, 0),
    proposal: rows.reduce((s, r) => s + r.proposal, 0),
  };
}

/**
 * 精算資料に載せる件と、その精算（期間末 through まで）。一式・常用の件は件の日報日が through 以前なら載せ、
 * 未定の件は through までに行が紐づくときだけ載せる。並びは件の日報日順、同じ日は input.issues の並び。
 */
function settleIssues(issues: Issue[], throughRows: ChangeLedgerRow[], through: string | null): ChangeIssueSettlement[] {
  const rowsByIssue = new Map<string, ChangeLedgerRow[]>();
  for (const row of throughRows) {
    if (row.issue === null) continue;
    const list = rowsByIssue.get(row.issue.id);
    if (list) list.push(row);
    else rowsByIssue.set(row.issue.id, [row]);
  }
  const settled: ChangeIssueSettlement[] = [];
  for (const issue of issues) {
    const linked = rowsByIssue.get(issue.id) ?? [];
    const included = issue.settlementMethod !== 'undecided' ? through === null || issue.reportDate <= through : linked.length > 0;
    if (!included) continue;
    settled.push({
      id: issue.id,
      reportDate: issue.reportDate,
      kind: issue.kind,
      bodyHead: bodyHead(issue.body),
      instructedBy: issue.instructedBy,
      amountEstimate: issue.amountEstimate,
      settlementMethod: issue.settlementMethod,
      fixedAmount: issue.fixedAmount,
      dailyRate: issue.dailyRate,
      fixedOn: issue.fixedOn,
      ...sumRows(linked),
      ...settleIssue(issue, linked),
    });
  }
  // Array.prototype.sort は安定（同じ日は input.issues の並びのまま）
  return settled.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function summarize(rows: ChangeLedgerRow[]): Record<ChangeLedgerKind, ChangeKindSummary> {
  const summary: Record<ChangeLedgerKind, ChangeKindSummary> = {
    extra: emptySummary(),
    increase: emptySummary(),
    change: emptySummary(),
    minus: emptySummary(),
  };
  for (const row of rows) {
    const s = summary[row.changeKind];
    s.count += 1;
    s.declared += row.declared;
    s.actualCost += row.actualCost.total;
    s.proposal += row.proposal;
  }
  return summary;
}

export function buildChangeLedger(input: ChangeLedgerInput, rates: ChangeRates, period: CostReportPeriod): ChangeLedgerModel {
  const reports = [...input.reports].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const reportDates = reports.map((r) => r.reportDate);
  const inPeriod = (date: string) => period.kind === 'all' || monthKey(date) === period.month;
  // 精算提案額に入れる最後の日（月なら月末、工期全体なら null = すべて）
  const through = period.kind === 'month' ? monthEnd(period.month) : null;
  const refs = issueRefs(input.issues);

  /** 月末までの全部の行（精算用）。一覧はこのうち期間内の行。 */
  const throughRows: ChangeLedgerRow[] = [];
  let contractOutput = 0;
  for (const r of reports) {
    if (through !== null && r.reportDate > through) continue;
    const day = dayCostBasis(r); // 分母（作業内容の人工の合計）には減・契約内の行も入る
    const visit = visitNumbers(reportDates, r.reportDate);
    for (const l of r.lines) {
      if (l.kind !== 'work') continue;
      if (l.changeKind === 'contract') {
        if (inPeriod(r.reportDate)) contractOutput += l.stored.amount;
        continue;
      }
      const byCost = l.changeKind !== 'minus';
      // 減は原価を積み上げない（提案額は申告額）ので実績原価 0
      const actualCost = byCost ? allocateDayCost(day, { manDays: l.stored.manDays }) : { labor: 0, other: 0, total: 0 };
      throughRows.push({
        date: r.reportDate,
        reportId: r.id,
        monthIndex: visit.monthIndex,
        totalIndex: visit.totalIndex,
        changeKind: l.changeKind,
        trade: l.trade,
        description: l.description,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        declared: l.stored.amount,
        manDays: l.stored.manDays,
        instructedBy: l.instructedBy.trim() || null,
        instructionMethod: l.instructionMethod,
        instructedOn: l.instructedOn,
        issue: l.issueId !== null ? (refs.get(l.issueId) ?? null) : null,
        clientConfirmed: r.clientConfirmedAt !== null,
        actualCost,
        // 減は原価を積み上げない：申告額（負の保存値）をそのまま提案額にする
        proposal: byCost ? proposalFromCost(actualCost.total, rates) : l.stored.amount,
        proposalBasis: byCost ? 'cost' : 'declared',
      });
    }
  }

  const rows = throughRows.filter((row) => inPeriod(row.date));
  const summary = summarize(rows);
  const issues = settleIssues(input.issues, throughRows, through);
  const unlinkedRows = throughRows.filter((row) => row.issue === null);
  // 区分ごとの精算額（期間末までの累計）= 件の精算額 ＋ 件に紐づかない行の提案額
  for (const i of issues) if (i.countsToward && i.category !== null) summary[i.category].settled += i.settled;
  for (const row of unlinkedRows) summary[row.changeKind].settled += row.proposal;

  const base = siteBaseAmount(input.site);
  const extra = summary.extra.settled;
  const increase = summary.increase.settled;
  const change = summary.change.settled;
  const minus = summary.minus.settled;
  return {
    isEmpty: rows.length === 0 && issues.length === 0,
    period: period.kind === 'month' ? { kind: 'month', month: period.month } : { kind: 'all', month: null },
    rates: { overheadRate: rates.overheadRate, profitRate: rates.profitRate },
    rows,
    summary,
    issues,
    unlinked: sumRows(unlinkedRows),
    contractOutput,
    settlement: {
      base: base.amount,
      baseBasis: base.basis,
      through,
      extra,
      increase,
      change,
      minus,
      proposed: base.amount === null ? null : base.amount + extra + increase + change + minus,
    },
  };
}
