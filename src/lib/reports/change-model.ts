import { monthEnd } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import { visitNumbers } from '@/lib/calc/visit';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import type {
  AllocatedCost,
  ChangeIssueRef,
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
//   精算提案額 = 当初（契約確定なら請負金額、未確定なら概算金額）＋ 追加 ＋ 増 ＋ 変更 ＋ 減（各区分の提案額の合計。減は負）
//   増（同じ流れの中で数量が増えたもの）の計算・集計は追加（新しく別の仕事が増えたもの）と同じ。
//
// 期間が月のときは、一覧（rows）・区分ごとの集計（summary）・契約内の出来高はその月の日報の行だけ（回目は現場の全日報で
// 数える）。精算提案額（settlement）はその月末までの全部の行で計算する（工事原価集計表 ② の提案額と同じ範囲）。

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
  const raw = actualCost * (1 + rates.overheadRate) * (1 + rates.profitRate);
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
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

/** 件 id → 根拠の件（番号はその件を書いた日報の件の中での登録順。input.issues の並びのまま数える）。 */
function issueRefs(issues: Issue[]): Map<string, ChangeIssueRef> {
  const countByReport = new Map<string, number>();
  const refs = new Map<string, ChangeIssueRef>();
  for (const i of issues) {
    const number = (countByReport.get(i.reportId) ?? 0) + 1;
    countByReport.set(i.reportId, number);
    refs.set(i.id, { id: i.id, reportDate: i.reportDate, number, kind: i.kind, bodyHead: [...i.body.trim()].slice(0, BODY_HEAD).join('') });
  }
  return refs;
}

const emptySummary = (): ChangeKindSummary => ({ count: 0, declared: 0, actualCost: 0, proposal: 0 });

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

  /** 月末までの全部の行（精算提案額用）。一覧はこのうち期間内の行。 */
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
  const settled = summarize(throughRows);

  const base = siteBaseAmount(input.site);
  const extra = settled.extra.proposal;
  const increase = settled.increase.proposal;
  const change = settled.change.proposal;
  const minus = settled.minus.proposal;
  return {
    isEmpty: rows.length === 0,
    period: period.kind === 'month' ? { kind: 'month', month: period.month } : { kind: 'all', month: null },
    rates: { overheadRate: rates.overheadRate, profitRate: rates.profitRate },
    rows,
    summary,
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
