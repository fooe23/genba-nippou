export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type SiteRole = 'staff' | 'reviewer' | 'approver';
export type LineKind = 'labor' | 'fuel' | 'lease' | 'cash' | 'credit' | 'work';
export interface TimeSpec { start: string | null; end: string | null; breakMin: number | null; gapMin: number | null; }
export interface LaborLine  { kind: 'labor';  workerId: string | null; workerName: string; time: TimeSpec; dailyRate: number | null; note: string; }
export interface FuelLine   { kind: 'fuel';   vehicleId: string | null; vehicleName: string; kmPerL: number | null; distanceKm: number | null; pricePerL: number | null; note: string; }
export interface LeaseLine  { kind: 'lease';  itemId: string | null; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; note: string; }
export interface CashLine   { kind: 'cash';   itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string; }
export interface CreditLine { kind: 'credit'; itemName: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; supplierId: string | null; vendor: string; }
export interface WorkLine   { kind: 'work';   estimateItemId: string | null; trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; source: 'estimate' | 'extra'; }
export type ReportLine = LaborLine | FuelLine | LeaseLine | CashLine | CreditLine | WorkLine;
export interface ReportTotals { laborHours: number; manDays: number; workerCount: number; labor: number; fuel: number; lease: number; cash: number; credit: number; cost: number; output: number; }
