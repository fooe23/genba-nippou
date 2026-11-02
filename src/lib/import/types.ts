import type { RateHistory } from '@/lib/calc/rates';

// マスターの Excel／CSV 取り込みで使う型。解析・差分は純関数（Supabase に依存しない）。

export type ImportKind = 'workers' | 'suppliers' | 'vehicles' | 'leaseItems';

export const IMPORT_KINDS: readonly ImportKind[] = ['workers', 'suppliers', 'vehicles', 'leaseItems'];

export const KIND_LABELS: Record<ImportKind, string> = {
  workers: '作業員',
  suppliers: '取引先',
  vehicles: '車両',
  leaseItems: 'リース品',
};

/** 文字列は前後の空白を除き、空なら null。数値は 0 以上（数値にならない値は RowError）。 */
export interface WorkerRow { name: string; trade: string | null; dailyRate: number | null; overtimeRate: number | null; note: string | null; }
export interface SupplierRow { name: string; category: string | null; contact: string | null; note: string | null; }
export interface VehicleRow { name: string; kind: string | null; kmPerL: number | null; note: string | null; }
export interface LeaseItemRow { name: string; spec: string | null; unitPrice: number | null; note: string | null; }

export interface ParsedRows {
  workers: WorkerRow[];
  suppliers: SupplierRow[];
  vehicles: VehicleRow[];
  leaseItems: LeaseItemRow[];
}

/** rowNo は Excel の行番号（CSV なら何行目か。見出しが 1 行目）。 */
export interface RowError { kind: ImportKind; rowNo: number; name: string; message: string; }

export interface ParseResult {
  rows: ParsedRows;
  errors: RowError[];
  source: 'xlsx' | 'csv';
  /** 見出しを認識できた種別。 */
  detected: ImportKind[];
}

// ---- 差分（アプリの現在のマスターとの突き合わせ） ----

/**
 * 既存マスターのうち差分に使う項目だけ（src/lib/db/masters.ts の Worker などはこれを満たす）。
 * createdAt は同じ名前の行の中から RPC と同じく「作成が最も古い行」を選ぶのに使う。
 */
export interface CurrentWorker { createdAt: string; name: string; trade: string | null; note: string | null; overtimeRate: number | null; active: boolean; rates: RateHistory[]; }
export interface CurrentSupplier { createdAt: string; name: string; category: string | null; contact: string | null; note: string | null; active: boolean; }
export interface CurrentVehicle { createdAt: string; name: string; kind: string | null; kmPerL: number | null; note: string | null; active: boolean; }
export interface CurrentLeaseItem { createdAt: string; name: string; spec: string | null; note: string | null; active: boolean; rates: RateHistory[]; }

export interface CurrentMasters {
  workers: CurrentWorker[];
  suppliers: CurrentSupplier[];
  vehicles: CurrentVehicle[];
  leaseItems: CurrentLeaseItem[];
}

// RPC gn_import_masters の payload の 1 行（列名は DB の snake_case）。
export interface WorkerPayload { name: string; trade: string | null; note: string | null; daily_rate: number | null; overtime_rate: number | null; }
export interface SupplierPayload { name: string; category: string | null; contact: string | null; note: string | null; }
export interface VehiclePayload { name: string; kind: string | null; km_per_l: number | null; note: string | null; }
export interface LeaseItemPayload { name: string; spec: string | null; note: string | null; unit_price: number | null; }

export interface ImportPayload {
  workers: WorkerPayload[];
  suppliers: SupplierPayload[];
  vehicles: VehiclePayload[];
  lease_items: LeaseItemPayload[];
}

export interface FieldChange { label: string; before: string; after: string; }

/** error は確認の時点で送れないと分かった行（アプリに同じ名前の行が 2 件以上ある など）。送らない。 */
export type PreviewStatus = 'new' | 'updated' | 'unchanged' | 'error';

export interface PreviewRow<P> {
  /** 選択のキー（`${kind}:${name}`）。 */
  key: string;
  status: PreviewStatus;
  name: string;
  /** 新規は登録する値（before は空文字）、更新は変わる項目だけ。 */
  changes: FieldChange[];
  payload: P;
  /** 既存の行が無効（active = false）のとき true。取り込みでは有効に戻らない。 */
  inactive: boolean;
  /** status が error のときの理由。 */
  error?: string;
}

export interface ImportPreview {
  workers: PreviewRow<WorkerPayload>[];
  suppliers: PreviewRow<SupplierPayload>[];
  vehicles: PreviewRow<VehiclePayload>[];
  leaseItems: PreviewRow<LeaseItemPayload>[];
}

/** RPC の返り値の件数（キーは ImportKind にそろえる）。 */
export interface KindCounts { inserted: number; updated: number; unchanged: number; }
export type ImportCounts = Record<ImportKind, KindCounts>;
