import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { Issue, ReportHead } from '@/lib/db/reports';
import type { Carryover, Site } from '@/lib/db/sites';
import type { ChangeTotals } from '@/lib/calc/change';
import type { ChangeKind, InstructionMethod, IssueKind, ReportLine, TimeSpec } from '@/lib/types';

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
   * 追加・変更・減の提案額の合計（追加 ＋ 変更 ＋ 減。減は負）。変更増減の一覧（buildChangeLedger）と同じ計算で、
   * 期間の末日までの累計。追加・変更・減の行が無ければ null。
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
  /** この日より前の日報の output_total の合計（進捗率 =（これ + 本日出来高）÷ 請負金額）。 */
  cumulativeOutputBefore: number;
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
  /** workerId が無い（手入力）。レンダラーが名前に「（手入力）」を付ける。 */
  manual: boolean;
  start: string | null;
  end: string | null;
  breakMin: number | null;
  gapMin: number | null;
  /** 実働 H（労務の saved.hours。保存値が無ければ null）。 */
  hours: number | null;
  /** 人工・残業 H・労務費（stored の man_days・overtime_hours・amount）。 */
  manDays: number;
  overtimeHours: number;
  /** 日当（行に保存された値）。 */
  dailyRate: number | null;
  cost: number;
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
  /** 区分（契約内・追加・変更・減）。追加・変更・減の行は帳票で太字にし、施工内容の頭に【区分】を付ける。 */
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
  workers: { rows: DailyWorkerRow[]; total: { hours: number; manDays: number; overtimeHours: number; cost: number } };
  vehicles: { rows: DailyVehicleRow[]; total: { distanceKm: number; cost: number } };
  leases: { rows: DailyLeaseRow[]; total: { amount: number } };
  cash: { rows: DailyPurchaseRow[]; total: { amount: number } };
  credit: { rows: DailyPurchaseRow[]; total: { amount: number } };
  /** 本日原価集計。5 費目と total は明細の stored.amount の合計、costTotal は見出しの cost_total（一致するはず）。 */
  costs: { labor: number; fuel: number; lease: number; cash: number; credit: number; total: number; costTotal: number };
  /**
   * 本日出来高（output_total）と進捗率。cumulative = 前日までの出来高 + 本日（日報の無い日は null）。
   * progress = cumulative ÷ 請負金額（請負金額が null・0、または日報の無い日は null）。
   */
  output: { today: number; cumulative: number | null; contractAmount: number | null; progress: number | null };
  /**
   * 作業内容。changes は「本日の追加・変更・減」：区分ごとの保存値（stored.amount）の合計（減は負、net = 3 つの和）。
   * 追加・変更・減の行が無い日は null。
   */
  work: { rows: DailyWorkRow[]; total: { manDays: number; amount: number }; changes: ChangeTotals | null };
  /** 重要事項（本文と、この日報の件）。 */
  issues: { text: string; items: { body: string; status: Issue['status']; doneAt: string | null }[] };
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
export type ChangeLedgerInput = Pick<CostReportInput, 'site' | 'reports' | 'issues'>;

/** 提案金額に掛ける率（gn_settings の経費率・利益率。0.15 = 15%）。 */
export interface ChangeRates {
  overheadRate: number;
  profitRate: number;
}

/** 契約内を除いた区分（追加・変更・減）。 */
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

/** 実績原価の内訳（allocateDayCost）。 */
export interface AllocatedCost {
  /** 投入人工 × その日の平均日当（労務費 ÷ 人工）。 */
  labor: number;
  /** その日の燃料・リース・現金購入・買掛を、作業内容の行の人工比で按分した額。 */
  other: number;
  total: number;
}

/** 一覧の 1 行（追加・変更・減の作業内容の行）。日付順、同じ日は日報の行の順。 */
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
   * 実績原価（円未満は丸めない。表示はレンダラー）。減の行は 0（提案額は申告額で、原価を積み上げないため）。
   * 減の行の投入人工も、その日の按分の分母（作業内容の人工の合計）には入る。
   */
  actualCost: AllocatedCost;
  /** 提案金額（円）。追加・変更は実績原価から（basis 'cost'、円未満切り上げ）、減は申告額そのまま（'declared'、負）。 */
  proposal: number;
  proposalBasis: 'cost' | 'declared';
}

/** 区分ごとの集計。減の申告額・提案額は負。 */
export interface ChangeKindSummary {
  count: number;
  declared: number;
  actualCost: number;
  proposal: number;
}

export interface ChangeLedgerModel {
  /** 集計期間（rows）に追加・変更・減の行が 1 行も無い。 */
  isEmpty: boolean;
  period: { kind: 'all' | 'month'; month: string | null };
  rates: ChangeRates;
  /** 集計期間の行（月ならその月だけ）。 */
  rows: ChangeLedgerRow[];
  /** 集計期間（rows）の区分ごとの集計。 */
  summary: Record<ChangeLedgerKind, ChangeKindSummary>;
  /** 集計期間の契約内の作業内容の出来高（保存値 amount の合計）。 */
  contractOutput: number;
  /**
   * 精算提案額 = 当初（契約確定なら請負金額、未確定なら概算金額）＋ 追加 ＋ 変更 ＋ 減（減は負）。各区分は提案額の合計。
   * 範囲は through までの全部の行（月の期間でも、その月だけではなく現場の最初の日報から月末まで。工事原価集計表 ②
   * の changeProposal と同じ）。当初が無ければ base・proposed は null。
   */
  settlement: {
    base: number | null;
    baseBasis: 'contract' | 'estimate';
    /** 精算に入れた最後の日（月の期間なら月末 'YYYY-MM-DD'、工期全体なら null = すべて）。 */
    through: string | null;
    extra: number;
    change: number;
    minus: number;
    proposed: number | null;
  };
}
