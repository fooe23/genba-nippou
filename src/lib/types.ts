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
export interface WorkLine   { kind: 'work';   estimateItemId: string | null; trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; source: 'estimate' | 'extra'; }
export type ReportLine = LaborLine | FuelLine | LeaseLine | CashLine | CreditLine | WorkLine;
export interface ReportTotals { laborHours: number; manDays: number; overtimeHours: number; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; }
/** 人工・残業の計算設定（gn_settings。Excel 雛形 V34 の「労務の計算設定」と同じ）。 */
export interface LaborRule { shoteiHours: number; fixedOvertimeLimit: number; overtimeMultiplier: number; overtimeBaseHours: number; }
