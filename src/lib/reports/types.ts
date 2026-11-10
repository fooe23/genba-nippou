import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { Issue, ReportHead } from '@/lib/db/reports';
import type { Carryover, Site, SitePartner } from '@/lib/db/sites';
import type { AffiliationKind, AffiliationManDays } from '@/lib/reports/affiliation-breakdown';
import type { ChangeTotals } from '@/lib/calc/change';
import type { LaborCostContext, LaborCostKind } from '@/lib/calc/labor-cost';
import type { SubcontractOutput } from '@/lib/report/subcontract-output';
import type { ChangeKind, InstructionMethod, IssueKind, ReportLine, SettlementMethod, TimeSpec } from '@/lib/types';

// 帳票（第2計画（改）Task 2〜5）の型。モデルは数値だけを持ち、文字列の整形（#,##0・%・「—」・「（手入力）」）は
// レンダラー（PDF・Excel・CSV）が行う。計画書で「—」と書かれている値は null。

// ─── 入力 ───

/** gn_report_lines に保存された計算値（DB のトリガー gn_report_lines_compute が保存時に計算）。null は 0。 */
export interface StoredLineValues {
  /** amount（労務費・燃料費・リース費・購入額・出来高）。 */
  amount: number;
  /** man_days（労務は計算した人工、作業内容は入力した投入人工。その他の行は 0）。 */
  manDays: number;
  /** overtime_hours（労務だけ。その他の行は 0）。 */
  overtimeHours: number;
  /** hours（労務の実働 H。その他の行は 0）。うち常用の時間の割合に使う（2026-11-17）。 */
  hours: number;
}

/** 明細 1 行と、その DB の保存値。帳票の金額・人工はすべて stored から計算する。 */
export type SavedReportLine = ReportLine & { stored: StoredLineValues };

/** 日報 1 件（見出し＋保存値つき明細）。src/lib/db/reports-data.ts が作る。 */
export interface ReportWithLines extends ReportHead {
  lines: SavedReportLine[];
}

export interface CostReportInput {
  site: Site;
  /** 現場の保存済み日報すべて（下書き・提出・承認・差戻し。集計画面と同じ）。順不同可。 */
  reports: ReportWithLines[];
  carryovers: Carryover[];
  workers: Worker[];
  suppliers: Supplier[];
  vehicles: Vehicle[];
  leaseItems: LeaseItem[];
  /** 現場の全日報の件（listIssuesForReports。対応中・完了とも。登録順）。変更増減の一覧の「根拠の件」に使う。 */
  issues: Issue[];
  /** 現場の協力会社（gn_site_partners。amount は請負金額で任意）。④-2 所属別の請負金額の比較に使う。 */
  sitePartners: Pick<SitePartner, 'supplierId' | 'supplierName' | 'amount'>[];
  /**
   * 労務費の決まり（src/lib/calc/labor-cost.ts。2026-11-17）の材料：労務の計算設定と、実行予算の会社ごとの常用の単価
   * （社員・管理者だけ）。労務費はすべて「原価に数える分」（請負の行はうち常用の時間の分だけ）。人工（出面）は全部。
   */
  laborCost: LaborCostContext;
  /**
   * 実行予算の請負の行（gn_budget_lines の項目 'subcontract'）の会社ごとの金額の合計（工種をまたいで足す。2026-11-11）。
   * ④-2 所属別の請負金額はこれを先に使い、無い会社は現場の協力会社の請負金額（sitePartners.amount）。社員・管理者だけ（省略は空）。
   */
  budgetSubcontractAmounts?: Record<string, number>;
  /** 実行予算の工種 id → 名前（⑦ 工種別出来高の外注の行の工種名。2026-11-11）。省略・無い工種は「工種なし」。 */
  tradeNames?: Record<string, string>;
}

export type CostReportPeriod = { kind: 'all' } | { kind: 'month'; month: string };

/** 出力した日（JST の YYYY-MM-DD）・人（表示名）・日時（ISO 8601。無ければ日付だけ出す）。 */
export interface CostReportNow {
  date: string;
  by: string;
  at?: string;
}

// ─── 出力（CostReportModel） ───

export interface CostReportHeader {
  siteName: string;
  clientName: string | null;
  projectName: string | null;
  projectNo: string | null;
  contractType: Site['contractType'];
  overview: string | null;
  /** 着工予定・竣工予定（現場の登録値）。 */
  startDate: string | null;
  endDate: string | null;
  /** 着工（無ければ最初の日報日）〜 完了なら最後の日報日・進行中なら出力日。着工日を 1 日目と数える。決められなければ null。 */
  elapsedDays: number | null;
  siteStatus: Site['status'];
  /** 集計期間の日報の件数（全状態）と、そのうち承認済みの件数。 */
  reportCount: number;
  approvedCount: number;
  /** 集計期間。工期全体のときの from / to は最初・最後の日報日（日報が無ければ null）。 */
  period: { kind: 'all' | 'month'; month: string | null; from: string | null; to: string | null };
  outputDate: string;
  outputAt: string | null;
}

type CostKey = 'labor' | 'fuel' | 'lease' | 'cash' | 'credit';

/** ① 原価合計（集計期間だけ）。shares は原価合計に対する割合 0..1（原価合計 0 なら 0）。 */
export interface CostTotals {
  labor: number;
  fuel: number;
  lease: number;
  cash: number;
  credit: number;
  total: number;
  shares: Record<CostKey, number>;
}

/**
 * ② 採算（集計期間の末日までの累計。工期全体なら全日報）。
 * 粗利・粗利率・進捗率の基準額は、契約が確定（fixed）なら請負金額、未確定（tentative）なら概算金額（basis）。
 * 進捗率は、basis 'contract' なら累計出来高 ÷ 請負金額、'estimate' なら累計原価（totalCost）÷ 概算金額。
 * 基準額が無い（null・0）ときの比率は null。
 */
export interface Profitability {
  /** 請負金額（現場の登録値そのまま。未確定の現場でも入っていれば出す）。 */
  contractTotal: number | null;
  /** 概算・見積提示額（現場の登録値そのまま）。 */
  estimatedAmount: number | null;
  /** 粗利・進捗率の基準：'contract' = 請負金額、'estimate' = 概算金額（「概算に対する見込み」）、null = 基準額が無い。 */
  basis: 'contract' | 'estimate' | null;
  totalCost: number;
  grossProfit: number | null;
  grossMargin: number | null;
  cumulativeOutput: number;
  progress: number | null;
  totalManDays: number;
  /** 総原価 ÷ 総人工（総人工 0 なら null）。 */
  costPerManDay: number | null;
  /** 総原価 ÷ 日報のある日数（0 なら null）。 */
  costPerDay: number | null;
  /** 1 日あたり原価の分母（累計の日報件数）。 */
  dayCount: number;
  /**
   * 追加・増・変更・減の精算額の合計（追加 ＋ 増 ＋ 変更 ＋ 減。減は負）。変更増減の一覧（buildChangeLedger）の
   * settlement と同じ計算で、期間の末日までの累計（件ごとの精算額 ＋ 件に紐づかない行の提案額）。
   * 期間の末日までに追加・増・変更・減の行も、載せる件も無ければ null。
   */
  changeProposal: number | null;
}

/** ③ 月別推移の 1 行（期間が月のときは週。月曜始まりで、その月の中に切り詰めた from〜to）。日報のある月・週だけ。 */
export interface TrendRow {
  /** 'YYYY-MM'（月）または週の初日 'YYYY-MM-DD'（週）。 */
  key: string;
  from: string;
  to: string;
  reportCount: number;
  labor: number;
  fuel: number;
  lease: number;
  cash: number;
  credit: number;
  /** cost_total の合計。 */
  cost: number;
  output: number;
  /** 現場の最初の日報から to までの cost_total の累計。 */
  cumulativeCost: number;
  /**
   * 進捗率（② と同じ基準）。契約確定なら to までの累計出来高 ÷ 請負金額、未確定なら to までの累計原価 ÷ 概算金額。
   * 基準額が無ければ null。
   */
  progress: number | null;
}

export interface Trend {
  unit: 'month' | 'week';
  rows: TrendRow[];
  /** 合計行。cumulativeCost・progress は最後の行と同じ（期間末までの累計）。行が無ければ 0・null。 */
  total: Omit<TrendRow, 'key' | 'from' | 'to'>;
}

/** ④ 作業員別累計の 1 行。累計 = 繰越初期値 + 繰越の基準日以降〜期間末の日報（workerCumulative と同じ）。 */
export interface WorkerRow {
  workerId: string | null;
  workerName: string;
  /** workerId が無い（手入力）。レンダラーが名前に「（手入力）」を付ける。 */
  manual: boolean;
  /** 職種（マスター。手入力・未登録は null）。 */
  trade: string | null;
  /**
   * 所属（自社／取引先名／所属なし）。累計に入った労務の行の写し（その日の所属）から決める。作業員マスターのいまの所属は
   * 使わない。途中で所属が変わった人は出てきた順に「自社・〇〇工業」とつなぐ（人工・労務費の所属ごとの内訳は ④-2）。
   * 繰越初期値は機能の追加前の分なので自社（過去の行も自社で埋めたのと同じ扱い）。
   */
  affiliationLabel: string;
  /** 出勤日数（累計に入った日報の日数。繰越初期値の分は含まない）。 */
  workDays: number;
  /** 前月繰越（繰越初期値 + 期間より前の日報）と期間の分。工期全体なら carry は繰越初期値だけ。 */
  carryManDays: number;
  carryCost: number;
  periodManDays: number;
  periodCost: number;
  /** 累計 = carry + period。 */
  manDays: number;
  /** 残業 H（累計に入った日報の分。繰越初期値には残業が無い）。 */
  overtimeHours: number;
  cost: number;
}

export interface WorkerSection {
  rows: WorkerRow[];
  total: { workDays: number; manDays: number; overtimeHours: number; cost: number };
}

/**
 * ④-2 所属別の人工・労務費の 1 行（④ と同じ範囲：繰越初期値 ＋ 繰越の基準日以降〜期間末の日報）。所属は労務の行の写し。
 * 常用・請負は行に保存した laborContract（null は常用）を労務費の決まり（laborCostSplit）で読む（2026-11-17）：
 * 常用の人工・労務費＝原価に数える分（自社・常用の行は全部、請負の行はうち常用の時間の分）、請負の人工＝出面だけの分。
 * 外注の支払い＝その会社への外注の買掛の合計（同じ範囲）。繰越初期値は自社の常用に入れる。
 */
export interface AffiliationRow {
  key: string;
  kind: AffiliationKind;
  supplierId: string | null;
  /** 自社／取引先名（引けなければ「協力会社」）／所属なし。 */
  label: string;
  jouyouManDays: number;
  jouyouCost: number;
  /** 請負の人工（出面だけ。原価に数えない）。 */
  ukeoiManDays: number;
  /** 外注の支払い（その会社への外注の買掛の合計）。 */
  subcontractPaid: number;
  /** 出面の人工（常用 ＋ 請負）。 */
  manDays: number;
  /** 原価に数える労務費（＝ jouyouCost）。 */
  cost: number;
  /**
   * 請負金額（現場全体の額で、月の帳票でもそのまま）。実行予算の請負の行のその会社の金額の合計（2026-11-11）、無ければ
   * 現場の協力会社の請負金額（gn_site_partners.amount）。協力会社以外・どちらも無ければ null。
   */
  partnerAmount: number | null;
  /** 請負金額 − 外注の支払い。請負金額が無ければ null。 */
  difference: number | null;
}

export interface AffiliationSection {
  /** 自社 → 協力会社（名前順。現場に登録した会社は行が無くても出す）→ 所属なし。人工も労務費も 0 の自社・所属なしは出さない。 */
  rows: AffiliationRow[];
  total: Omit<AffiliationRow, 'key' | 'kind' | 'supplierId' | 'label'>;
}

/** ⑤ 取引先別累計（集計期間）。名前（参照があればマスター名）でまとめる。 */
export interface VendorRow {
  /** 取引先名。'' は未記入（レンダラーが「（取引先なし）」と出す）。 */
  name: string;
  supplierId: string | null;
  /** 取引先マスターに無い名前（手入力の購入先・仕入先）。レンダラーが「（手入力）」を付ける。 */
  manual: boolean;
  cash: number;
  credit: number;
  total: number;
}

export interface VendorSection {
  rows: VendorRow[];
  total: { cash: number; credit: number; total: number };
}

/** ⑥ 車両（集計期間）。 */
export interface VehicleRow {
  vehicleId: string | null;
  name: string;
  manual: boolean;
  distanceKm: number;
  fuelCost: number;
}

/** ⑥ リース品（集計期間）。qty・unit は ⑦ と同じ規則（数量の入った行の単位がすべて同じなら合計。違う・数量の入った行が無いなら null。unit '' は null）。 */
export interface LeaseRow {
  itemId: string | null;
  name: string;
  manual: boolean;
  qty: number | null;
  unit: string | null;
  leaseCost: number;
}

export interface EquipmentSection {
  vehicles: VehicleRow[];
  leases: LeaseRow[];
  total: { distanceKm: number; fuelCost: number; leaseCost: number };
}

/** ⑦ 工種別出来高（集計期間）。 */
export interface TradeRow {
  /** 工種。'' は未記入（レンダラーが「（工種なし）」と出す）。 */
  trade: string;
  /** 最も多い施工内容（同数なら先に出たもの。空は数えない。無ければ ''）。 */
  mainDescription: string;
  /**
   * 施工数量。数量の入った行（qty が null でない）の単位の文字列がすべて同じなら合計、違えば null＝「—」。
   * 数量の入った行が無ければ null。'' と 'm2' は別の単位。
   */
  qty: number | null;
  /** 単位（混在・数量なし・単位なし '' のときは null）。 */
  unit: string | null;
  manDays: number;
  /** 歩掛 = 数量 ÷ 投入人工（人工 0 または数量 null なら null）。 */
  productivity: number | null;
  output: number;
  /** 出来高 ÷ 工種別出来高の合計（合計 0 なら 0）。 */
  share: number;
  /**
   * 外注の支払いの行（2026-11-11。工種・支払先ごと。trade は「タイル（外注・東北建興）」）。出来高に数える外注
   * （件なし＝契約内、件ありは追加・増・変更）の支払金額。投入人工・歩掛は持たない（manDays 0・productivity null）。
   */
  subcontract?: boolean;
}

export interface TradeSection {
  rows: TradeRow[];
  total: { manDays: number; output: number };
}

export interface CostReportModel {
  /** 集計期間に日報が 1 件も無い（レンダラーは「日報がありません」の 1 行を出す）。 */
  isEmpty: boolean;
  header: CostReportHeader;
  costs: CostTotals;
  profit: Profitability;
  trend: Trend;
  workers: WorkerSection;
  affiliations: AffiliationSection;
  vendors: VendorSection;
  equipment: EquipmentSection;
  trades: TradeSection;
  /** 署名欄。作成者 = 出力した人、確認者・承認者は空欄（null）。 */
  signature: { createdBy: string; checkedBy: null; approvedBy: null };
  /** 脚注「日報 N 件（承認済み M 件）から自動集計 出力日時」。ページ番号はレンダラー。 */
  footer: { reportCount: number; approvedCount: number; outputDate: string; outputAt: string | null };
}

// ─── 日報（第2計画（改）Task 4・5） ───

/**
 * 日報 1 件（見出し＋保存値つき明細）に、日報の帳票だけが使う gn_daily_reports の列を足したもの。
 * Task 5 のローダーが gn_daily_reports の 1 行と gn_report_lines（stored・労務の saved つき）から作る。
 */
export interface DailyReportSource extends ReportWithLines {
  /** 共通時間（common_start・common_end・common_break_min・common_gap_min。空は null）。 */
  common: TimeSpec;
  /** 重要事項の本文（issues_text。空は ''）。 */
  issuesText: string;
  /** 連絡事項（notes_text。空は ''）。 */
  notesText: string;
  /** 確認者・承認者（profiles.id）と承認日時（ISO 8601）。無ければ null。 */
  reviewedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** buildDailyReport の入力（日報のある日）。日報の無い日は buildEmptyDailyReport(site, date) を使う。 */
export interface DailyReportInput {
  site: Site;
  report: DailyReportSource;
  /** 現場の全日報の日付（順不同可。当月 N 回目／通算 M 回目を visitNumbers で出す。自分が無くても数える）。 */
  reportDates: string[];
  /** この日報の件（listIssuesForReport(report.id)。並びはそのまま出す）。 */
  issues: Issue[];
  /** profiles.id → 表示名（createdBy・reviewedBy・approvedBy）。読めない id は入れない。 */
  names: Record<string, string>;
  /**
   * この日より前の日報の出来高の合計（output_total ＋ 外注の支払いのうち出来高に数える分。2026-11-11）。
   * 進捗率 =（これ + 本日出来高）÷ 請負金額。
   */
  cumulativeOutputBefore: number;
  /**
   * この日報の外注の行が根拠に選んだ件のうち、issues に無い件（ほかの日報の件）の id → 種別（2026-11-11）。
   * 外注の出来高を契約内・追加・増・変更に分けるのに使う。読めない件の外注は数えない。省略は空。
   */
  subcontractIssueKinds?: Record<string, IssueKind>;
  /**
   * この日報の燃料・リース・現金・買掛の行が根拠に選んだ件のうち、issues・subcontractIssueKinds に無い件（ほかの日報の件）の
   * id → 種別（2026-11-20）。帳票の品名の頭の件の区分（【増】など）に使う。読めない件は入らない（印なし）。省略は空。
   */
  lineIssueKinds?: Record<string, IssueKind>;
  /** 実行予算の工種 id → 名前（外注の買掛の品名の頭【外注・工種名】に使う。2026-11-17）。省略・無い工種は【外注】だけ。 */
  tradeNames?: Record<string, string>;
  /** 労務費の決まりの材料（2026-11-17）。作業員の行の労務費・本日原価の労務費は原価に数える分。 */
  laborCost: LaborCostContext;
}

// ─── 出力（DailyReportModel）。並びは雛形の日報シートと同じ ───

export interface DailyHeader {
  siteName: string;
  projectNo: string | null;
  date: string;
  /** 当月 N 回目・通算 M 回目（日報の無い日は null）。 */
  monthIndex: number | null;
  totalIndex: number | null;
  weather: string | null;
  /** 作業責任者。 */
  supervisor: string | null;
  /** 共通時間（日報の保存値。日報の無い日はすべて null）。 */
  common: TimeSpec;
}

/** 作業員の 1 行。時刻はアプリの計算（effectiveHours）と同じ規則で共通時間を補った値。 */
export interface DailyWorkerRow {
  workerId: string | null;
  name: string;
  /** workerId が無い（手入力）。レンダラーが名前に「（手入力）」を付ける。名前なし（会社と人数）の行は false。 */
  manual: boolean;
  /** 人数（名前なし（会社と人数）の行。それ以外は 1）。時刻・実働は 1 人あたり、人工・残業・労務費は人数分。 */
  headcount: number;
  start: string | null;
  end: string | null;
  breakMin: number | null;
  gapMin: number | null;
  /** 実働 H（労務の saved.hours。保存値が無ければ null）。 */
  hours: number | null;
  /** 人工（出面。stored.man_days）・残業 H（stored.overtime_hours）。 */
  manDays: number;
  overtimeHours: number;
  /** 日当（行に保存された値）。 */
  dailyRate: number | null;
  /** 労務費＝原価に数える分（労務費の決まり。自社・常用の行は stored.amount、請負の行はうち常用の時間の分）。 */
  cost: number;
  /** 区分（自社・常用・請負）と、請負の行のうち常用の時間（H。それ以外は null）・原価に数えない請負の人工。 */
  contract: LaborCostKind;
  jouyouHours: number | null;
  ukeoiManDays: number;
  note: string;
}

export interface DailyVehicleRow {
  vehicleId: string | null;
  name: string;
  manual: boolean;
  kmPerL: number | null;
  distanceKm: number | null;
  /** 燃料単価（円/L）。 */
  pricePerL: number | null;
  /** 燃料費（stored.amount）。 */
  cost: number;
  note: string;
}

export interface DailyLeaseRow {
  itemId: string | null;
  name: string;
  manual: boolean;
  spec: string;
  unit: string;
  qty: number | null;
  unitPrice: number | null;
  /** リース費（stored.amount）。 */
  amount: number;
  note: string;
}

/** 現金購入・買掛の 1 行。 */
export interface DailyPurchaseRow {
  name: string;
  spec: string;
  unit: string;
  qty: number | null;
  unitPrice: number | null;
  /** 購入額（stored.amount）。 */
  amount: number;
  /** 購入先・仕入先（'' は未記入）。 */
  vendor: string;
  /** 買掛で仕入先マスターの参照が無い（手入力）。現金購入は常に false。レンダラーが「（手入力）」を付ける。 */
  vendorManual: boolean;
}

export interface DailyWorkRow {
  trade: string;
  description: string;
  qty: number | null;
  unit: string;
  /** 投入人工（stored.man_days）。 */
  manDays: number;
  /** 歩掛 = 数量 ÷ 投入人工（数量 null・人工 0 なら null）。 */
  productivity: number | null;
  unitPrice: number | null;
  /** 出来高（stored.amount。減の行は負）。 */
  amount: number;
  /** 区分（契約内・追加・増・変更・減）。追加・増・変更・減の行は帳票で太字にし、施工内容の頭に【区分】を付ける。 */
  changeKind: ChangeKind;
}

/** 客先確認の記録（gn_daily_reports.client_confirmed_*）。記録の有無は確認日時（client_confirmed_at）で決める。 */
export interface DailyClientConfirmation {
  /** 確認者名（未記入は ''）。 */
  by: string;
  /** 確認日時（ISO 8601）。 */
  at: string;
  /** メモ（未記入は ''）。 */
  note: string;
}

export interface DailyReportModel {
  /** その日の日報が無い（buildEmptyDailyReport）。CSV はレコードを出さず、PDF は「日報がありません」。 */
  isEmpty: boolean;
  header: DailyHeader;
  /** 合計の実働 H は保存値のある行だけを足す。 */
  workers: { rows: DailyWorkerRow[]; total: { hours: number; manDays: number; ukeoiManDays: number; overtimeHours: number; cost: number } };
  vehicles: { rows: DailyVehicleRow[]; total: { distanceKm: number; cost: number } };
  leases: { rows: DailyLeaseRow[]; total: { amount: number } };
  cash: { rows: DailyPurchaseRow[]; total: { amount: number } };
  credit: { rows: DailyPurchaseRow[]; total: { amount: number } };
  /**
   * 本日原価集計。5 費目と total は明細の stored.amount の合計（2026-11-17 から見出しの cost_total は使わない。外注の買掛を含まないため）。
   * credit は買掛の全部（仕入＋外注）、subcontract はそのうちの外注。
   */
  /**
   * 本日原価集計。tagged は根拠の件を選んだ燃料・リース・現金・買掛（仕入・外注）の合計（「うち精算が必要（件の根拠）」。
   * 2026-11-11。減・やり直し・読めない件は入れない。協力会社には外注の行が来ないので外注は入らない）。
   */
  costs: { labor: number; fuel: number; lease: number; cash: number; credit: number; subcontract: number; tagged: number; total: number };
  /**
   * 本日出来高（output_total）と進捗率。cumulative = 前日までの出来高 + 本日（日報の無い日は null）。
   * progress = cumulative ÷ 請負金額（請負金額が null・0、または日報の無い日は null）。
   * tentative は契約が未確定の現場（帳票は「請負金額（未確定）」と「概算金額」を出す）。estimatedAmount はそのときの
   * 概算金額（確定の現場は null）。進捗率の基準は未確定でも請負金額のまま（累計原価 ÷ 概算は次の計画）。
   */
  output: {
    /** 本日出来高 合計 = work + subcontract.total。 */
    today: number;
    /** 作業内容の出来高（output_total）。 */
    work: number;
    /** 外注の支払いのうち出来高に数える分（2026-11-11。件なし＝契約内、件ありは区分ごと）。協力会社には 0。 */
    subcontract: SubcontractOutput;
    cumulative: number | null;
    contractAmount: number | null;
    progress: number | null;
    tentative: boolean;
    estimatedAmount: number | null;
  };
  /**
   * 作業内容。changes は「本日の追加・増・変更・減」：区分ごとの保存値（stored.amount）の合計（減は負、net = 4 つの和）。
   * 追加・増・変更・減の行が無い日は null。
   */
  work: { rows: DailyWorkRow[]; total: { manDays: number; amount: number }; changes: ChangeTotals | null };
  /**
   * 重要事項（本文と、この日報の件）。件の number はこの日報の件の中での登録順（1 始まり。issueNumbers と同じ）。
   * kind・instructedBy・instructionMethod はお客様用日報で使う（社内用の日報 PDF には出さない）。
   */
  issues: {
    text: string;
    items: {
      number: number;
      body: string;
      status: Issue['status'];
      doneAt: string | null;
      kind: IssueKind;
      instructedBy: string | null;
      instructionMethod: InstructionMethod | null;
    }[];
  };
  /** 連絡事項。 */
  notes: string;
  /**
   * 作成者（名前が読めなければ作業責任者、それも無ければ null）・確認者・承認者（読めなければ null）・承認日時（ISO）。
   */
  signature: { createdBy: string | null; reviewedBy: string | null; approvedBy: string | null; approvedAt: string | null };
  /** 客先確認の記録（無ければ null。PDF は空の 確認者名／日付／サイン 欄を出す）。 */
  clientConfirmation: DailyClientConfirmation | null;
}

// ─── 変更増減の一覧（第2計画（改）Task 11。src/lib/reports/change-model.ts） ───

/** buildChangeLedger の入力。CostReportInput がそのまま使える（現場・全日報・全日報の件だけを読む）。 */
/** laborCost を省略したときは設定の既定・実行予算の単価なし（EMPTY_LABOR_COST_CONTEXT）で労務費の決まりを当てる。 */
export type ChangeLedgerInput = Pick<CostReportInput, 'site' | 'reports' | 'issues'> & Partial<Pick<CostReportInput, 'suppliers' | 'laborCost'>>;

/**
 * 件の精算の提案額に掛ける率（gn_settings。0.151 = 15.1%。DB は % で持つ）。社内だけ（客先用には出さない）。
 * 提案額 ＝ 円未満切り上げ（（労務 ×（1＋法定福利費率）＋ 材料 ×（1＋材料経費率）＋（リース＋燃料）×（1＋リース燃料経費率））
 *          ×（1＋諸経費率）＋ 外注）。
 */
export interface ChangeRates {
  /** 法定福利費率（労務＝施工金額に掛ける。既定 15.1%）。 */
  legalWelfareRate: number;
  /** 材料経費率（材料＝仕入の買掛・現金に掛ける。既定 12%）。 */
  materialExpenseRate: number;
  /** リース燃料経費率（リース・燃料に掛ける。既定 12%）。 */
  leaseFuelExpenseRate: number;
  /** 諸経費率（利益含む。上の合計に掛ける。外注には掛けない。既定 8%）。 */
  overheadProfitRate: number;
}

/**
 * 件の精算の根拠の内訳（社内だけ）。労務は根拠にその件を選んだ作業内容の行（追加・増・変更）、ほかは根拠にその件を選んだ
 * 現金・買掛・リース・燃料の行の保存値 amount の合計。根拠を選んでいない行は数えない（日の原価を按分しない）。
 */
export interface SettlementBreakdown {
  /** 労務（施工金額）：行の施工金額（数量 × 施工単価＝保存値 amount）。施工金額の無い行は人工 × 日当（laborCost の分）で仮に。 */
  laborAmount: number;
  /** 労務の実績原価（参考）：行の投入人工 × その日の日当（原価に数える労務費 ÷ 原価に数える人工。和はその日の労務費まで）。 */
  laborCost: number;
  /** 材料：仕入の買掛 ＋ 現金。 */
  material: number;
  lease: number;
  fuel: number;
  /** 外注の買掛（率を掛けずにそのまま足す）。 */
  subcontract: number;
  /** 施工金額（施工単価）が無く、人工 × 日当で仮に出した行の数。 */
  missingAmountLines: number;
}

/** 契約内を除いた区分（追加・増・変更・減）。 */
export type ChangeLedgerKind = Exclude<ChangeKind, 'contract'>;

/** 行の「根拠の件」。 */
export interface ChangeIssueRef {
  id: string;
  /** 件を書いた日報の日付（行の日付と違うことがある）。 */
  reportDate: string;
  /** その日報の件の中での番号（登録順、1 始まり）。 */
  number: number;
  kind: IssueKind;
  /** 本文の先頭 40 字（前後の空白は除く）。 */
  bodyHead: string;
}

/** 一覧の 1 行（追加・増・変更・減の作業内容の行）。日付順、同じ日は日報の行の順。 */
export interface ChangeLedgerRow {
  date: string;
  reportId: string;
  /** 当月 N 回目・通算 M 回目（現場の全日報で数える）。 */
  monthIndex: number;
  totalIndex: number;
  changeKind: ChangeLedgerKind;
  trade: string;
  description: string;
  /** 施工数量（入力値。減も正のまま。減は表示で負にする（レンダラー））。 */
  qty: number | null;
  unit: string;
  unitPrice: number | null;
  /** 申告額（入力の施工単価 × 数量。保存値 amount。減は負）。 */
  declared: number;
  /** 投入人工（保存値 man_days）。 */
  manDays: number;
  /** 指示者（未入力は null）・指示方法・指示日。 */
  instructedBy: string | null;
  instructionMethod: InstructionMethod | null;
  instructedOn: string | null;
  /** 根拠の件（未選択・読めない件は null）。 */
  issue: ChangeIssueRef | null;
  /** 日報に客先確認（client_confirmed_at）がある。 */
  clientConfirmed: boolean;
  /**
   * 実績原価（参考。円未満は丸めない。表示はレンダラー）＝ 投入人工 × その日の日当（原価に数える労務費 ÷ 原価に数える人工。件を選んだ行を先に、和はその日の原価に数える労務費まで。change-model.ts の workLaborCosts）。
   * 燃料・リース・現金・買掛は行に按分しない（根拠に件を選んだ行だけを件に数える）。減の行は 0。
   */
  actualCost: number;
  /**
   * 精算の労務（施工金額）。追加・増・変更は保存値 amount（数量 × 施工単価）。施工金額が無い（0 以下）行は actualCost で仮に
   * （missingAmount true）。減の行は 0。
   */
  laborAmount: number;
  /** 追加・増・変更の行で、施工金額（施工単価）が入っていない（人工 × 日当で仮に出した）。 */
  missingAmount: boolean;
  /**
   * 提案金額（円）。追加・増・変更は労務（施工金額）×（1＋法定福利費率）×（1＋諸経費率）を円未満切り上げ（basis 'cost'）、
   * 減は申告額そのまま（'declared'、負）。件の精算額は件ごとにまとめて計算する（行の提案額の和とは限らない）。
   */
  proposal: number;
  proposalBasis: 'cost' | 'declared';
  /**
   * 投入人工の所属別の内訳（社内用）。作業内容の行は所属を持たないので、その日の労務の行の所属別の人工比で按分する
   * （apportionManDays。和は manDays と一致）。その日に労務の行が無ければ全部を所属なし。
   */
  affiliationManDays: AffiliationManDays[];
}

/** 区分ごとの集計。減の申告額・提案額・精算額は負。 */
export interface ChangeKindSummary {
  /** 件数・申告額・実績原価・提案額は集計期間の行（rows）だけ。 */
  count: number;
  declared: number;
  actualCost: number;
  /**
   * 提案額（集計期間の分）。未定の件（やり直しを除く）は件の区分に、期間内のその件の行と根拠の材料・リース・燃料・外注から
   * 件の提案額と同じ式でまとめて出した額。ほかの行（件なし・一式・見積・常用・やり直しの件）は行の区分に行の提案額。
   */
  proposal: number;
  /**
   * 精算額（期間末までの累計。月の期間でもその月だけではない）= 載せる件のうち合計に入れる（countsToward）区分が
   * この区分の件の精算額 ＋ 件に紐づかない行のこの区分の提案額。一式・見積・常用の件に紐づく行の提案額は入らない。
   */
  settled: number;
}

/**
 * 精算資料に載せる件の、件ごとの精算（settleIssue）。載せる件 = 精算の方法が一式・見積・常用で、件の日報日が期間末以前の件、
 * または期間末までに追加・増・変更・減の行が紐づくか、根拠にその件を選んだ現金・買掛・リース・燃料の行がある未定の件。
 * 未定でどちらも無い件は載せない。
 */
export interface ChangeIssueSettlement {
  id: string;
  /** 件を書いた日報の日付。 */
  reportDate: string;
  /** その日報の件の中での番号（登録順、1 始まり。ChangeIssueRef.number と同じ）。 */
  number: number;
  kind: IssueKind;
  /** 本文の先頭 40 字（前後の空白は除く。ChangeIssueRef と同じ）。 */
  bodyHead: string;
  /** 指示者（未入力は null）。 */
  instructedBy: string | null;
  /** 指示の方法（未入力は null）。 */
  instructionMethod: InstructionMethod | null;
  /** 金額見込み（円。未入力は null）。参考で、精算額には使わない。 */
  amountEstimate: number | null;
  /** 精算の方法（未定・一式・見積・常用）と、確定額（一式・見積）・常用単価（常用）・確定日（件の保存値）。 */
  settlementMethod: SettlementMethod;
  fixedAmount: number | null;
  dailyRate: number | null;
  fixedOn: string | null;
  /** 精算の区分（settlementCategory。客先都合・その他は追加、やり直しは null）。 */
  category: ChangeLedgerKind | null;
  /**
   * 期間末までの、この件に紐づく作業内容の行の件数・投入人工の合計。実績原価（参考）＝ 紐づく行の労務の実績原価 ＋ 根拠に
   * この件を選んだ材料・リース・燃料・外注（丸めない）。提案額 ＝ 内訳（breakdown）から settlementProposal ＋ 減の行の申告額。
   */
  lineCount: number;
  manDays: number;
  actualCost: number;
  proposal: number;
  /** 精算の根拠の内訳（社内だけ）。 */
  breakdown: SettlementBreakdown;
  /** 紐づく行の投入人工の所属別の内訳（行の affiliationManDays の和）。 */
  affiliationManDays: AffiliationManDays[];
  /**
   * 精算額（円）。一式・見積 = 確定額（'fixed'）、常用 = 紐づく行の人工の合計 × 常用単価を円未満切り上げ（'daily_rate'）、
   * 未定 = この件の提案額（'proposal'）。区分が減なら一式・見積・常用は負にする（未定は減の行の申告額がすでに負）。
   */
  settled: number;
  settledBasis: 'fixed' | 'daily_rate' | 'proposal';
  /** 区分ごとの精算額・精算提案額に入れる（category が null のやり直しは参考で、入れない）。 */
  countsToward: boolean;
  /** この件を登録した日報に客先確認（client_confirmed_at）がある。 */
  reportClientConfirmed: boolean;
}

/**
 * 客先用の精算（clientSettlement）。見積中の件（未定・確定額の無い一式・見積、単価の無い常用）は金額に入れない。
 * 区分ごとの金額 = 確定した件の精算額 ＋ 件なしの行の提案額（期間末まで）。件数は確定した件の数（件なしの行は数えない）。
 */
export interface ClientSettlement {
  base: number | null;
  baseBasis: 'contract' | 'estimate';
  kinds: Record<ChangeLedgerKind, { count: number; amount: number }>;
  /** 当初 ＋ 区分ごとの金額の和（減は負）。当初が無ければ null。 */
  proposed: number | null;
  /** 見積中の件の数（載せる件のうち、やり直し以外で確定していないもの）。 */
  pendingCount: number;
  /** 客先用に載せる件（やり直しを除く。見積中も含む）。件の日報日順（model.issues の並び）。 */
  issues: ChangeIssueSettlement[];
  /** 見積中の件の id。 */
  pendingIds: Set<string>;
}

export interface ChangeLedgerModel {
  /** 集計期間（rows）に追加・増・変更・減の行が 1 行も無く、載せる件（issues）も無い。 */
  isEmpty: boolean;
  period: { kind: 'all' | 'month'; month: string | null };
  rates: ChangeRates;
  /** 集計期間の行（月ならその月だけ）。 */
  rows: ChangeLedgerRow[];
  /** 区分ごとの集計（件数・申告額・実績原価・提案額は集計期間の rows、settled は期間末までの累計）。 */
  summary: Record<ChangeLedgerKind, ChangeKindSummary>;
  /** 精算資料に載せる件（期間末まで）。件の日報日順、同じ日は件の登録順（input.issues の並び）。 */
  issues: ChangeIssueSettlement[];
  /**
   * 期間末までの、件に紐づかない（未選択・読めない件）追加・増・変更・減の行の件数・人工・実績原価・提案額（行の提案額の和）の合計と、
   * 施工金額の無い行の数。
   */
  unlinked: {
    lineCount: number;
    manDays: number;
    actualCost: number;
    proposal: number;
    affiliationManDays: AffiliationManDays[];
    missingAmountLines: number;
  };
  /** 期間末までの、件に紐づかない行の提案額の合計（区分ごと。減は負）。客先用の精算額（clientSettlement）で使う。 */
  unlinkedByKind: Record<ChangeLedgerKind, number>;
  /** 集計期間の契約内の出来高（契約内の作業内容の行の保存値 amount ＋ 件を選んでいない外注の支払い。2026-11-11）。 */
  contractOutput: number;
  /**
   * 精算提案額 = 当初（契約確定なら請負金額、未確定なら概算金額）＋ 追加 ＋ 増 ＋ 変更 ＋ 減（減は負）。各区分は精算額
   * （summary[区分].settled）。範囲は through までの全部の行と載せる件（月の期間でも、その月だけではなく現場の最初の
   * 日報から月末まで。工事原価集計表 ② の changeProposal と同じ）。当初が無ければ base・proposed は null。
   */
  settlement: {
    base: number | null;
    baseBasis: 'contract' | 'estimate';
    /** 精算に入れた最後の日（月の期間なら月末 'YYYY-MM-DD'、工期全体なら null = すべて）。 */
    through: string | null;
    extra: number;
    increase: number;
    change: number;
    minus: number;
    proposed: number | null;
  };
}
