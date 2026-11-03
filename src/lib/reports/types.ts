import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { ReportHead } from '@/lib/db/reports';
import type { Carryover, Site } from '@/lib/db/sites';
import type { ReportLine } from '@/lib/types';

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

/** ② 採算（集計期間の末日までの累計。工期全体なら全日報）。請負金額が無い（null・0）ときの比率は null。 */
export interface Profitability {
  contractTotal: number | null;
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
  /** to までの累計出来高 ÷ 請負金額（請負金額が無ければ null）。 */
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
