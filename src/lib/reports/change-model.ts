import { monthEnd } from '@/lib/calc/calendar';
import { monthKey } from '@/lib/calc/format';
import { EMPTY_LABOR_COST_CONTEXT, laborCostSplit, type LaborCostContext } from '@/lib/calc/labor-cost';
import { visitNumbers } from '@/lib/calc/visit';
import type { Issue } from '@/lib/db/reports';
import type { Site } from '@/lib/db/sites';
import { settlementCategory, usesFixedAmount } from '@/lib/report/change-labels';
import { apportionManDays, dayAffiliationWeights, sumAffiliationManDays } from '@/lib/reports/affiliation-breakdown';
import type {
  ChangeIssueRef,
  ChangeIssueSettlement,
  ChangeKindSummary,
  ChangeLedgerInput,
  ChangeLedgerKind,
  ChangeLedgerModel,
  ChangeLedgerRow,
  ChangeRates,
  ClientSettlement,
  CostReportPeriod,
  ReportWithLines,
  SettlementBreakdown,
} from '@/lib/reports/types';

// 変更増減（追加・増・変更・減）の一覧と件の精算（純関数。DB・Next に依存しない）。
// 金額・人工はすべて保存値（明細の amount・man_days）から計算する。減の amount は DB のトリガーが負で保存している。
// 決まり（2026-11-11 利用者。計画 docs/superpowers/plans/2026-11-10-subcontract-issue-costs.md の Task 10）：
//
//   件に数えるのは、根拠にその件を選んだ行だけ（作業内容の行は issue_id、現金・買掛・リース・燃料の行も issue_id）。
//   根拠を選んでいないその日の燃料・リース・現金・買掛は、どの行・件にも按分しない。
//   労務（施工金額） = 追加・増・変更の行の施工金額（数量 × 施工単価＝保存値 amount）。施工金額が無い（0 以下）行は
//              その行の労務の実績原価（人工 × 日当）で仮に出し、「精算の金額（施工単価）が入っていません」と知らせる
//   提案額     = 円未満切り上げ（（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋（リース＋燃料）×（1＋リース燃料経費率））
//              ×（1＋諸経費率）＋ 外注）（settlementProposal）。材料 = 仕入の買掛 ＋ 現金。外注（外注の買掛）は率を掛けない
//   行の提案額 = 追加・増・変更：その行の労務だけで settlementProposal、減：申告額（入力の施工単価 × 数量。負）そのまま
//   実績原価（参考） = 行の労務の実績原価（workLaborCosts）＋ 根拠にその件を選んだ材料・リース・燃料・外注。減の行は 0
//              行の労務の実績原価（2026-11-11 利用者）= 投入人工 × その日の日当（原価に数える労務費 ÷ 原価に数える人工）。
//              原価に数える人工 = 自社・常用の行の人工 ＋ 請負の行のうち常用の分（請負の出面は入れない。労務費の決まり
//              src/lib/calc/labor-cost.ts）。契約外（件）の作業は原価に数える作業員がするもので、請負の契約の中ではしない。
//              件を選んだ行を先に数え、その和がその日の原価に数える労務費を超えたら比例で縮める。件を選んでいない
//              追加・増・変更の行は残り（労務費 − 件の行の分）の中で同じように数える。原価に数える人工が 0 の日は 0
//   件ごとの精算額 = 一式・見積：確定額、常用：ceil(紐づく行の人工の合計 × 常用単価)（率は掛けない）、
//              未定：件の提案額（内訳から settlementProposal ＋ 紐づく減の行の申告額）（settleIssue）
//              区分は件の種別から（settlementCategory）。減の区分の一式・見積・常用は負。やり直しは参考で合計に入れない
//   区分ごとの精算額 = その区分の件の精算額 ＋ 件に紐づかない行の提案額（一式・見積・常用の件に紐づく行の提案額は数えない）
//   精算提案額 = 当初（契約確定なら請負金額、未確定なら概算金額）＋ 追加 ＋ 増 ＋ 変更 ＋ 減（各区分の精算額。減は負）
//   増（同じ流れの中で数量が増えたもの）の計算・集計は追加（新しく別の仕事が増えたもの）と同じ。
//   所属別の人工（社内用）= 行の投入人工を、その日の労務の行の所属（写し）別の人工比で按分（apportionManDays。和は元の人工）。
//
//   減の区分の件（settlementCategory が minus）に根拠を選んだ材料・リース・燃料・外注は数えない（減は申告額だけ）。
//   区分ごとの提案額（summary.proposal。社内確認用のサマリーの提案額の列）= 未定の件（やり直しを除く）は件の区分に、
//              期間内のその件の行と根拠の行から件の提案額と同じ式で出した額（材料・リース・燃料・外注を含む）。
//              ほか（件なし・一式・見積・常用・やり直しの件に紐づく行）は行の区分に、行の提案額。
//
//   契約内の出来高 = 契約内の作業内容の行 ＋ 件を選んでいない外注の支払い（2026-11-11）。件を選んだ外注は件の精算（外注）に入る。
//
// 期間が月のときは、一覧（rows）・区分ごとの件数・申告額・提案額・契約内の出来高はその月の日報の行だけ（回目は現場の
// 全日報で数える）。件ごとの精算・区分ごとの精算額・精算提案額（settlement）はその月末までの全部の行と、月末までに
// 載せる件で計算する（工事原価集計表 ② と同じ範囲）。一式・見積・常用の件は件の日報日が月末以前なら載せる（確定日は見ない）。

/** 1 日（日報 1 件）の、労務の実績原価に使う合計（保存値に労務費の決まりを当てたもの）。 */
export interface DayCostBasis {
  /** 原価に数える労務費（自社・常用の行は amount、請負の行はうち常用の時間の分）。 */
  laborCost: number;
  /**
   * 原価に数える人工（自社・常用の行は全部、請負の行はうち常用の分。請負の出面は入れない）。日当の分母（2026-11-11 利用者）：
   * 契約外（件）の作業は原価に数える作業員がするので、日当は原価に数える労務費 ÷ 原価に数える人工。
   */
  countedManDays: number;
}

export function dayCostBasis(report: ReportWithLines, ctx: LaborCostContext = EMPTY_LABOR_COST_CONTEXT): DayCostBasis {
  const day: DayCostBasis = { laborCost: 0, countedManDays: 0 };
  for (const l of report.lines) {
    if (l.kind !== 'labor') continue;
    const s = laborCostSplit(l, ctx);
    day.laborCost += s.countedCost;
    day.countedManDays += s.jouyouManDays;
  }
  day.countedManDays = Math.round(day.countedManDays * 1e6) / 1e6;
  return day;
}

/** その日の日当 = 原価に数える労務費 ÷ 原価に数える人工（人工が 0 の日は 0）。 */
export function dayLaborRate(day: DayCostBasis): number {
  return day.countedManDays > 0 ? day.laborCost / day.countedManDays : 0;
}

/**
 * 行の投入人工 × その日の日当（上限なし）。労務の人工が 0 の日は 0。円未満は丸めない。
 * 上限（その日の原価に数える労務費）を当てるのは workLaborCosts。
 */
export function laborShare(day: DayCostBasis, manDays: number): number {
  return manDays !== 0 ? manDays * dayLaborRate(day) : 0;
}

/**
 * その日の作業内容の行（追加・増・変更）ごとの労務の実績原価（並びは lines のまま。円未満は丸めない）。
 * - 件を選んだ行（issue true）：投入人工 × 日当。和がその日の原価に数える労務費を超えたら比例で縮める。
 * - 件を選んでいない行：同じく投入人工 × 日当で、和は残り（労務費 − 件の行の分）まで（超えたら比例で縮める）。
 * 和はその日の原価に数える労務費を超えない。
 */
export function workLaborCosts(day: DayCostBasis, lines: readonly { manDays: number; issue: boolean }[]): number[] {
  const raw = lines.map((l) => (l.manDays > 0 ? laborShare(day, l.manDays) : 0));
  const out = raw.slice();
  let budget = Math.max(day.laborCost, 0);
  for (const tagged of [true, false]) {
    const idx = lines.map((l, i) => (l.issue === tagged ? i : -1)).filter((i) => i >= 0);
    const sum = idx.reduce((s, i) => s + raw[i], 0);
    const scale = sum > budget && sum > 0 ? budget / sum : 1;
    for (const i of idx) out[i] = raw[i] * scale;
    budget = Math.max(budget - sum * scale, 0);
  }
  return out;
}

/** 提案額の元（内訳のうち金額の 5 つ）。 */
export type ProposalBasis = Pick<SettlementBreakdown, 'laborAmount' | 'material' | 'lease' | 'fuel' | 'subcontract'>;

/**
 * 提案額 = 円未満切り上げ（（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋（リース＋燃料）×（1＋リース燃料経費率））
 * ×（1＋諸経費率）＋ 外注）。外注には率を掛けない。tests/reports/change-model.test.ts で固定。
 */
export function settlementProposal(b: ProposalBasis, rates: ChangeRates): number {
  const marked =
    b.laborAmount * (1 + rates.legalWelfareRate) +
    b.material * (1 + rates.materialExpenseRate) +
    (b.lease + b.fuel) * (1 + rates.leaseFuelExpenseRate);
  return ceilYen(marked * (1 + rates.overheadProfitRate) + b.subcontract);
}

/** 円未満切り上げ。浮動小数の誤差（25,000 × 1.151 など）を落としてから切り上げる。 */
function ceilYen(raw: number): number {
  return Math.ceil(Math.round(raw * 1e6) / 1e6);
}

export const emptyBreakdown = (): SettlementBreakdown => ({
  laborAmount: 0,
  laborCost: 0,
  material: 0,
  lease: 0,
  fuel: 0,
  subcontract: 0,
  missingAmountLines: 0,
});

/** 減の区分なら負にする（0 は −0 にしない）。 */
const signed = (amount: number, category: ChangeLedgerKind | null) => (category === 'minus' && amount !== 0 ? -amount : amount);

/**
 * 件ごとの精算額の規則（ここだけに書く。tests/reports/change-model.test.ts で固定）。linked は期間末までの、この件に
 * 紐づく追加・増・変更・減の行の人工の合計と、この件の提案額（内訳から settlementProposal ＋ 減の行の申告額）。
 *
 * - 一式・見積：確定額（見積額。無ければ 0）。提案額・人工は見ない。
 * - 常用：紐づく行の人工の合計 × 常用単価（無ければ 0）を円未満切り上げ（率は掛けない）。
 * - 未定：この件の提案額。
 * - 区分は件の種別から（settlementCategory）。区分が減なら一式・見積・常用は負（確定額・単価は正で入れる）。
 * - やり直し（区分 null）は参考で、区分ごとの精算額・精算提案額に入れない（countsToward false）。
 */
export function settleIssue(
  issue: Issue,
  linked: { manDays: number; proposal: number },
): Pick<ChangeIssueSettlement, 'settled' | 'settledBasis' | 'countsToward' | 'category'> {
  const category = settlementCategory(issue.kind);
  const countsToward = category !== null;
  switch (issue.settlementMethod) {
    case 'lump_sum':
    case 'estimate':
      return { settled: signed(issue.fixedAmount ?? 0, category), settledBasis: 'fixed', category, countsToward };
    case 'daily_rate':
      return { settled: signed(ceilYen(linked.manDays * (issue.dailyRate ?? 0)), category), settledBasis: 'daily_rate', category, countsToward };
    case 'undecided':
      return { settled: linked.proposal, settledBasis: 'proposal', category, countsToward };
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

/** 件 id → 件の番号（その件を書いた日報の件の中での登録順、1 始まり。issues の並びのまま数える）。 */
export function issueNumbers(issues: Issue[]): Map<string, number> {
  const countByReport = new Map<string, number>();
  const numbers = new Map<string, number>();
  for (const i of issues) {
    const number = (countByReport.get(i.reportId) ?? 0) + 1;
    countByReport.set(i.reportId, number);
    numbers.set(i.id, number);
  }
  return numbers;
}

/** 件 id → 根拠の件（番号は issueNumbers。input.issues の並びのまま数える）。 */
function issueRefs(issues: Issue[]): Map<string, ChangeIssueRef> {
  const numbers = issueNumbers(issues);
  const refs = new Map<string, ChangeIssueRef>();
  for (const i of issues) {
    refs.set(i.id, { id: i.id, reportDate: i.reportDate, number: numbers.get(i.id) ?? 0, kind: i.kind, bodyHead: bodyHead(i.body) });
  }
  return refs;
}

const emptySummary = (): ChangeKindSummary => ({ count: 0, declared: 0, actualCost: 0, proposal: 0, settled: 0 });

/** 行の件数・人工・実績原価・提案額・所属別の人工・施工金額の無い行の数の合計（人工は浮動小数の誤差を落とす）。 */
function sumRows(rows: ChangeLedgerRow[]): ChangeLedgerModel['unlinked'] {
  const manDays = rows.reduce((s, r) => s + r.manDays, 0);
  return {
    lineCount: rows.length,
    manDays: Math.round(manDays * 1e6) / 1e6,
    actualCost: rows.reduce((s, r) => s + r.actualCost, 0),
    proposal: rows.reduce((s, r) => s + r.proposal, 0),
    affiliationManDays: sumAffiliationManDays(rows.map((r) => r.affiliationManDays)),
    missingAmountLines: rows.filter((r) => r.missingAmount).length,
  };
}

/** 根拠に件を選んだ現金・買掛・リース・燃料の行（期間末まで）の、件ごとの合計と行数。 */
interface TaggedCosts {
  material: number;
  lease: number;
  fuel: number;
  subcontract: number;
  lines: number;
}

/**
 * 件の内訳 = 紐づく追加・増・変更の行の労務（施工金額・実績原価・施工金額の無い行の数）＋ 根拠に選んだ現金・買掛・リース・燃料。
 * 減の行は内訳に入れない（提案額は申告額）。
 */
export function issueBreakdown(linked: ChangeLedgerRow[], tagged: Omit<TaggedCosts, 'lines'> | undefined): SettlementBreakdown {
  const b = emptyBreakdown();
  for (const r of linked) {
    if (r.proposalBasis !== 'cost') continue;
    b.laborAmount += r.laborAmount;
    b.laborCost += r.actualCost;
    if (r.missingAmount) b.missingAmountLines += 1;
  }
  if (tagged) {
    b.material = tagged.material;
    b.lease = tagged.lease;
    b.fuel = tagged.fuel;
    b.subcontract = tagged.subcontract;
  }
  return b;
}

/**
 * 精算資料に載せる件と、その精算（期間末 through まで）。一式・見積・常用の件は件の日報日が through 以前なら載せ、
 * 未定の件は through までに行が紐づくか、根拠にその件を選んだ現金・買掛・リース・燃料の行があるときだけ載せる。
 * 並びは件の日報日順、同じ日は input.issues の並び。
 */
function settleIssues(
  issues: Issue[],
  throughRows: ChangeLedgerRow[],
  taggedByIssue: Map<string, TaggedCosts>,
  through: string | null,
  refs: Map<string, ChangeIssueRef>,
  confirmedReportIds: Set<string>,
  rates: ChangeRates,
): ChangeIssueSettlement[] {
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
    const tagged = taggedByIssue.get(issue.id);
    const included =
      issue.settlementMethod !== 'undecided' ? through === null || issue.reportDate <= through : linked.length > 0 || (tagged?.lines ?? 0) > 0;
    if (!included) continue;
    const sums = sumRows(linked);
    const breakdown = issueBreakdown(linked, tagged);
    const declaredMinus = linked.filter((r) => r.proposalBasis === 'declared').reduce((s, r) => s + r.proposal, 0);
    const proposal = settlementProposal(breakdown, rates) + declaredMinus;
    const nonLabor = breakdown.material + breakdown.lease + breakdown.fuel + breakdown.subcontract;
    settled.push({
      id: issue.id,
      reportDate: issue.reportDate,
      number: refs.get(issue.id)?.number ?? 0,
      kind: issue.kind,
      bodyHead: bodyHead(issue.body),
      instructedBy: issue.instructedBy,
      instructionMethod: issue.instructionMethod,
      amountEstimate: issue.amountEstimate,
      settlementMethod: issue.settlementMethod,
      fixedAmount: issue.fixedAmount,
      dailyRate: issue.dailyRate,
      fixedOn: issue.fixedOn,
      lineCount: sums.lineCount,
      manDays: sums.manDays,
      affiliationManDays: sums.affiliationManDays,
      actualCost: sums.actualCost + nonLabor,
      proposal,
      breakdown,
      ...settleIssue(issue, { manDays: sums.manDays, proposal }),
      reportClientConfirmed: confirmedReportIds.has(issue.reportId),
    });
  }
  // Array.prototype.sort は安定（同じ日は input.issues の並びのまま）
  return settled.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function addTagged(map: Map<string, TaggedCosts>, issueId: string, l: ReportWithLines['lines'][number]): void {
  const t = map.get(issueId) ?? { material: 0, lease: 0, fuel: 0, subcontract: 0, lines: 0 };
  map.set(issueId, t);
  t.lines += 1;
  if (l.kind === 'fuel') t.fuel += l.stored.amount;
  else if (l.kind === 'lease') t.lease += l.stored.amount;
  else if (l.kind === 'credit' && l.purchaseKind === 'subcontract') t.subcontract += l.stored.amount;
  else t.material += l.stored.amount;
}

/**
 * 区分ごとの件数・申告額・実績原価・提案額（期間内の行。rows）。提案額は、未定の件（やり直しを除く）の分を件の区分に
 * 件の提案額と同じ式（期間内の行と根拠の行の内訳から settlementProposal ＋ 減の行の申告額）でまとめて足し、ほかの行は
 * 行の区分に行の提案額を足す（工期全体では、未定の件の提案額の列 ＝ 件の精算額になる）。
 */
function summarize(
  rows: ChangeLedgerRow[],
  issues: Issue[],
  taggedInPeriod: Map<string, TaggedCosts>,
  rates: ChangeRates,
): Record<ChangeLedgerKind, ChangeKindSummary> {
  const summary: Record<ChangeLedgerKind, ChangeKindSummary> = {
    extra: emptySummary(),
    increase: emptySummary(),
    change: emptySummary(),
    minus: emptySummary(),
  };
  // 提案額を件でまとめる未定の件（区分のある件）
  const pooled = new Map<string, { category: ChangeLedgerKind; rows: ChangeLedgerRow[] }>();
  for (const i of issues) {
    const category = settlementCategory(i.kind);
    if (i.settlementMethod === 'undecided' && category !== null) pooled.set(i.id, { category, rows: [] });
  }
  for (const row of rows) {
    const s = summary[row.changeKind];
    s.count += 1;
    s.declared += row.declared;
    s.actualCost += row.actualCost;
    const pool = row.issue ? pooled.get(row.issue.id) : undefined;
    if (pool) pool.rows.push(row);
    else s.proposal += row.proposal;
  }
  for (const [id, pool] of pooled) {
    const tagged = taggedInPeriod.get(id);
    if (pool.rows.length === 0 && !tagged) continue;
    const declaredMinus = pool.rows.filter((r) => r.proposalBasis === 'declared').reduce((s, r) => s + r.proposal, 0);
    summary[pool.category].proposal += settlementProposal(issueBreakdown(pool.rows, tagged), rates) + declaredMinus;
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
  const supplierNames = Object.fromEntries((input.suppliers ?? []).map((sp) => [sp.id, sp.name]));

  /** 月末までの全部の行（精算用）。一覧はこのうち期間内の行。 */
  const throughRows: ChangeLedgerRow[] = [];
  /** 根拠に件を選んだ現金・買掛・リース・燃料（月末まで。読めない件は数えない）。 */
  const taggedByIssue = new Map<string, TaggedCosts>();
  /** そのうち期間内の日報の分（区分ごとの提案額に使う）。 */
  const taggedInPeriod = new Map<string, TaggedCosts>();
  let contractOutput = 0;
  for (const r of reports) {
    if (through !== null && r.reportDate > through) continue;
    const day = dayCostBasis(r, input.laborCost ?? EMPTY_LABOR_COST_CONTEXT);
    // 追加・増・変更の行の労務の実績原価（件を選んだ行を先に、和はその日の原価に数える労務費まで）
    const costWork = r.lines.filter((l): l is Extract<typeof l, { kind: 'work' }> => l.kind === 'work' && l.changeKind !== 'contract' && l.changeKind !== 'minus');
    const workCosts = workLaborCosts(day, costWork.map((l) => ({ manDays: l.stored.manDays, issue: l.issueId !== null && refs.has(l.issueId) })));
    const workCostOf = new Map(costWork.map((l, i) => [l, workCosts[i]]));
    const weights = dayAffiliationWeights(r.lines, supplierNames); // 所属別の人工の按分の重み（その日の労務の行）
    const visit = visitNumbers(reportDates, r.reportDate);
    for (const l of r.lines) {
      if (l.kind === 'fuel' || l.kind === 'lease' || l.kind === 'cash' || l.kind === 'credit') {
        // 件を選んでいない外注の支払いは契約内の出来高に入れる（2026-11-11。src/lib/report/subcontract-output.ts）
        if (l.kind === 'credit' && l.purchaseKind === 'subcontract' && l.issueId === null) {
          if (inPeriod(r.reportDate)) contractOutput += l.stored.amount;
          continue;
        }
        const issue = l.issueId === null ? undefined : refs.get(l.issueId);
        // 読めない件・減の区分の件（減は申告額だけ）の根拠の行は数えない
        if (!issue || settlementCategory(issue.kind) === 'minus') continue;
        addTagged(taggedByIssue, issue.id, l);
        if (inPeriod(r.reportDate)) addTagged(taggedInPeriod, issue.id, l);
        continue;
      }
      if (l.kind !== 'work') continue;
      if (l.changeKind === 'contract') {
        if (inPeriod(r.reportDate)) contractOutput += l.stored.amount;
        continue;
      }
      const byCost = l.changeKind !== 'minus';
      // 減は原価を積み上げない（提案額は申告額）ので実績原価・労務 0
      const actualCost = byCost ? (workCostOf.get(l) ?? 0) : 0;
      const missingAmount = byCost && !(l.stored.amount > 0);
      const laborAmount = byCost ? (missingAmount ? actualCost : l.stored.amount) : 0;
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
        laborAmount,
        missingAmount,
        // 減は原価を積み上げない：申告額（負の保存値）をそのまま提案額にする
        proposal: byCost ? settlementProposal({ laborAmount, material: 0, lease: 0, fuel: 0, subcontract: 0 }, rates) : l.stored.amount,
        proposalBasis: byCost ? 'cost' : 'declared',
        affiliationManDays: apportionManDays(l.stored.manDays, weights),
      });
    }
  }

  const rows = throughRows.filter((row) => inPeriod(row.date));
  const summary = summarize(rows, input.issues, taggedInPeriod, rates);
  const confirmedReportIds = new Set(input.reports.filter((r) => r.clientConfirmedAt !== null).map((r) => r.id));
  const issues = settleIssues(input.issues, throughRows, taggedByIssue, through, refs, confirmedReportIds, rates);
  const unlinkedRows = throughRows.filter((row) => row.issue === null);
  const unlinkedByKind: Record<ChangeLedgerKind, number> = { extra: 0, increase: 0, change: 0, minus: 0 };
  for (const row of unlinkedRows) unlinkedByKind[row.changeKind] += row.proposal;
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
    rates: { ...rates },
    rows,
    summary,
    issues,
    unlinked: sumRows(unlinkedRows),
    unlinkedByKind,
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

/** 客先用で「確定」した件：一式・見積は確定額（見積額）あり、常用は単価あり（未定は確定でない）。 */
function isFixedForClient(issue: ChangeIssueSettlement): boolean {
  if (usesFixedAmount(issue.settlementMethod)) return issue.fixedAmount !== null;
  if (issue.settlementMethod === 'daily_rate') return issue.dailyRate !== null;
  return false;
}

/**
 * 客先用の精算額の規則（ここだけに書く。tests/reports/change-model.test.ts で固定）。社内用の settlement とは別に計算する。
 *
 * - 確定した件（一式・見積＝確定額あり、常用＝単価あり）の精算額（settled。減は負）を区分（category）に足し、件数を 1 増やす。
 * - 見積中（未定・確定額の無い一式・見積、単価の無い常用）は金額に入れず pendingCount に数える（未定の件に紐づく行の提案額も入れない）。
 * - 件なしの行の提案額（期間末まで。unlinkedByKind）は区分の金額に足す（件数には入れない）。
 * - やり直し（countsToward false）はどこにも入れない。
 * - 精算提案額 = 当初 ＋ 区分ごとの金額の和（当初が無ければ null）。
 */
export function clientSettlement(model: ChangeLedgerModel): ClientSettlement {
  const kinds: ClientSettlement['kinds'] = {
    extra: { count: 0, amount: model.unlinkedByKind.extra },
    increase: { count: 0, amount: model.unlinkedByKind.increase },
    change: { count: 0, amount: model.unlinkedByKind.change },
    minus: { count: 0, amount: model.unlinkedByKind.minus },
  };
  const issues = model.issues.filter((i) => i.countsToward && i.category !== null);
  const pendingIds = new Set<string>();
  for (const i of issues) {
    if (!isFixedForClient(i)) {
      pendingIds.add(i.id);
      continue;
    }
    const k = kinds[i.category!];
    k.count += 1;
    k.amount += i.settled;
  }
  const { base, baseBasis } = model.settlement;
  const sum = kinds.extra.amount + kinds.increase.amount + kinds.change.amount + kinds.minus.amount;
  return { base, baseBasis, kinds, proposed: base === null ? null : base + sum, pendingCount: pendingIds.size, issues, pendingIds };
}
