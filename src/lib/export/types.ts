import type { LaborEntry } from '@/lib/calc/aggregate';
import type { LeaseItem, Supplier, Vehicle, Worker } from '@/lib/db/masters';
import type { Carryover, Site, SiteMasters } from '@/lib/db/sites';
import type { LaborRule, ReportLine, ReportStatus, TimeSpec } from '@/lib/types';

// Excel 出力（第2計画）の型。
// ExportPayload は Python（python/genba_export）に渡す JSON の形そのもの（キーは snake_case）。
// 正は python/tests/fixtures/payload_days.json と payload_small.json。

// ─── payload（Python に渡す JSON） ───

export interface ExportSite {
  name: string;
  client_name: string | null;
  project_name: string | null;
  project_no: string | null;
  overview: string | null;
  contract_amount: number | null;
  start_date: string | null;
  end_date: string | null;
  contract_type: string | null;
}

export interface ExportSettings {
  shotei_hours: number;
  fixed_overtime_limit: number;
  overtime_multiplier: number;
  overtime_base_hours: number;
}

export interface ExportWorker {
  name: string;
  trade: string | null;
  /** その月の最初の日報の日付時点の日当（rateAt）。 */
  daily_rate: number | null;
  overtime_rate: number | null;
  note: string | null;
  /** 前月繰越（出力月の 1 日より前の人工・労務費 + 繰越初期値）。 */
  carry_man_days: number;
  carry_cost: number;
}

export interface ExportSupplier { name: string; category: string | null; contact: string | null; note: string | null; }
export interface ExportVehicle { name: string; kind: string | null; km_per_l: number | null; note: string | null; }
export interface ExportLeaseItem { name: string; spec: string | null; unit_price: number | null; note: string | null; }

export interface ExportCommon { start: string | null; end: string | null; break_min: number | null; gap_min: number | null; }

export interface ExportLaborRow {
  name: string;
  start: string | null;
  end: string | null;
  break_min: number | null;
  gap_min: number | null;
  note: string | null;
  /** 保存値（スナップショット）。 */
  daily_rate: number | null;
  /** 雛形のマスターに書く値（Python はこれと daily_rate が違う行だけ J 列を上書きする）。 */
  master_daily_rate: number | null;
}
export interface ExportFuelRow { name: string; distance_km: number | null; price_per_l: number | null; note: string | null; }
export interface ExportLeaseRow {
  name: string;
  spec: string | null;
  unit: string | null;
  qty: number | null;
  note: string | null;
  unit_price: number | null;
  master_unit_price: number | null;
}
export interface ExportPurchaseRow { name: string; spec: string | null; unit: string | null; qty: number | null; unit_price: number | null; vendor: string | null; }
export interface ExportWorkRow { trade: string | null; description: string | null; qty: number | null; unit: string | null; man_days: number | null; unit_price: number | null; }

export interface ExportDay {
  /** その月の何回目か（1 始まり。シート「N回目」）。 */
  index: number;
  date: string;
  /** 現場の全日報での通算（visitNumbers と同じ）。 */
  total_index: number;
  weather: string | null;
  supervisor: string | null;
  common: ExportCommon;
  labor: ExportLaborRow[];
  fuel: ExportFuelRow[];
  lease: ExportLeaseRow[];
  cash: ExportPurchaseRow[];
  credit: ExportPurchaseRow[];
  work: ExportWorkRow[];
  /** 現場のこの日までの cost_total の累計（出力月より前も含む。繰越初期値は含まない）。 */
  cumulative_cost: number;
  output_total: number;
  issues_text: string | null;
  /** gn_report_issues の本文（対応中・完了とも）。 */
  issues: string[];
  notes_text: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  /** ISO 8601（timestamptz のまま）。承認済みのときだけ。 */
  approved_at: string | null;
}

export interface ExportPayload {
  file_name: string;
  site: ExportSite;
  settings: ExportSettings;
  workers: ExportWorker[];
  suppliers: ExportSupplier[];
  vehicles: ExportVehicle[];
  lease_items: ExportLeaseItem[];
  days: ExportDay[];
}

// ─── 警告（Route 側で止めるかどうかは Task 5） ───

export type ExportWarningCode =
  | 'too_many_workers'
  | 'too_many_suppliers'
  | 'too_many_vehicles'
  | 'too_many_lease_items'
  | 'too_many_days'
  | 'rows_overflow'
  | 'name_not_in_master';

export interface ExportWarning { code: ExportWarningCode; message: string; date?: string; }

export interface ExportResult { payload: ExportPayload; warnings: ExportWarning[]; }

// ─── 入力（DB から読んだもの。src/lib/db/export.ts の loadExportInput が作る） ───

/** その月の日報 1 件（明細・件・作成者などの氏名つき）。 */
export interface ExportReport {
  id: string;
  date: string;
  status: ReportStatus;
  weather: string | null;
  supervisor: string | null;
  common: TimeSpec;
  outputTotal: number;
  costTotal: number;
  issuesText: string | null;
  notesText: string | null;
  lines: ReportLine[];
  /** gn_report_issues の本文（登録順）。 */
  issues: string[];
  /** profiles から引いた氏名。読めなければ null。 */
  createdByName: string | null;
  reviewedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
}

export interface ExportInput {
  /** 'YYYY-MM' */
  month: string;
  site: Site;
  rule: LaborRule;
  /** 現場で選択したマスター（gn_site_* の sort_order 順）。 */
  selected: SiteMasters;
  workers: Worker[];
  suppliers: Supplier[];
  vehicles: Vehicle[];
  leaseItems: LeaseItem[];
  /** その月の日報（順不同可）。 */
  reports: ExportReport[];
  /** 現場の全日報の日付と原価（通算回目・累計原価用。下書き・差戻しも含む保存済み全件）。 */
  siteReports: { reportDate: string; costTotal: number }[];
  /** 現場の全日報の労務行（前月繰越用）。 */
  laborEntries: LaborEntry[];
  carryovers: Carryover[];
}
