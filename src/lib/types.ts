export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type SiteRole = 'staff' | 'reviewer' | 'approver';
export type LineKind = 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'work';
export interface TimeSpec { start: string | null; end: string | null; breakMin: number | null; gapMin: number | null; }
/** 保存済みの労務行の DB の計算値（トリガー gn_report_lines_compute が保存時の設定で計算したもの）。読み取り専用の表示に使い、保存には送らない。 */
export interface LaborSaved { hours: number; manDays: number; overtimeHours: number; cost: number; }
export interface LaborLine  { kind: 'labor';  workerId: string | null; workerName: string; time: TimeSpec; dailyRate: number | null; note: string; overtimeRate: number | null; saved?: LaborSaved; }
export interface FuelLine   { kind: 'fuel';   vehicleId: string | null; vehicleName: string; kmPerL: number | null; distanceKm: number | null; pricePerL: number | null; note: string; }
export interface LeaseLine  { kind: 'lease';  itemId: string | null; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; note: string; }
export interface CashLine   { kind: 'cash';   itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string; }
export interface CreditLine { kind: 'credit'; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; supplierId: string | null; vendor: string; }
/** 作業内容の区分（契約内・追加・変更・減）。表示名は src/lib/report/change-labels.ts。 */
export type ChangeKind = 'contract' | 'extra' | 'change' | 'minus';
/** 指示方法（口頭・電話・メール・書面・その他）。 */
export type InstructionMethod = 'oral' | 'phone' | 'email' | 'document' | 'other';
/** 重要事項の件の種別（追加指示・仕様変更・減・客先都合・やり直し・その他）。 */
export type IssueKind = 'extra' | 'change' | 'minus' | 'client_delay' | 'rework' | 'other';
/**
 * 作業内容の行。source は見積の行との対応（estimate＝見積の行から、extra＝見積に無い行）で、
 * changeKind が追加・変更・減の区分。instructedBy〜issueId は追加・変更・減の根拠（誰が・どう・いつ指示したか、根拠の件）。
 */
export interface WorkLine   {
  kind: 'work'; estimateItemId: string | null; trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; source: 'estimate' | 'extra';
  changeKind: ChangeKind;
  /** 指示者（'' は未入力）。 */
  instructedBy: string;
  instructionMethod: InstructionMethod | null;
  /** 指示日（YYYY-MM-DD）。 */
  instructedOn: string | null;
  /** 根拠の件（gn_report_issues.id）。 */
  issueId: string | null;
}
export type ReportLine = LaborLine | FuelLine | LeaseLine | CashLine | CreditLine | WorkLine;
export interface ReportTotals { laborHours: number; manDays: number; overtimeHours: number; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; }
/** 人工・残業の計算設定（gn_settings。Excel 雛形 V34 の「労務の計算設定」と同じ）。 */
export interface LaborRule { shoteiHours: number; fixedOvertimeLimit: number; overtimeMultiplier: number; overtimeBaseHours: number; }
