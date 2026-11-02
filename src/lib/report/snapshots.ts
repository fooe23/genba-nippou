import { rateAt, type RateHistory } from '@/lib/calc/rates';
import type { ReportLine } from '@/lib/types';

// 保存時に、マスターを参照している明細の単価（日当・リース単価・燃費）をサーバー側で決め直す（純関数）。
// クライアントから届いた単価は信用しない。保存された値はその日の単価の「複写（スナップショット）」で、
// 集計（労務費・リース費・燃料費）はこの保存値を使う。後でマスターの単価履歴を直しても、
// その日報を保存し直すまで保存済みの値は変わらない。
// - 作業員（workerId あり）：日当 = 作業員の単価履歴のうち日報の日付に有効なもの、残業単価 = 作業員の残業単価（無ければ null）
// - リース（itemId あり）：単価 = リース品の単価履歴のうち日報の日付に有効なもの
// - 車両（vehicleId あり）：燃費 = 車両マスターの燃費
// - 参照の無い行（手入力の行）はクライアントの値のまま
// - 参照先がマスターに無い（形式は正しいが存在しない ID）行は単価を null にする（0円として計算される）

export interface SnapshotMasters {
  workers: { id: string; rates: RateHistory[]; overtimeRate: number | null }[];
  vehicles: { id: string; kmPerL: number | null }[];
  leaseItems: { id: string; rates: RateHistory[] }[];
}

export function needsMasterSnapshots(lines: ReportLine[]): boolean {
  return lines.some(
    (l) => (l.kind === 'labor' && l.workerId) || (l.kind === 'lease' && l.itemId) || (l.kind === 'fuel' && l.vehicleId),
  );
}

export function applyMasterSnapshots(lines: ReportLine[], date: string, masters: SnapshotMasters): ReportLine[] {
  const workers = new Map(masters.workers.map((w) => [w.id, w]));
  const vehicles = new Map(masters.vehicles.map((v) => [v.id, v]));
  const items = new Map(masters.leaseItems.map((i) => [i.id, i]));
  return lines.map((l) => {
    if (l.kind === 'labor' && l.workerId) {
      const w = workers.get(l.workerId);
      return { ...l, dailyRate: w ? rateAt(w.rates, date) : null, overtimeRate: w ? w.overtimeRate : null };
    }
    if (l.kind === 'lease' && l.itemId) {
      const item = items.get(l.itemId);
      return { ...l, unitPrice: item ? rateAt(item.rates, date) : null };
    }
    if (l.kind === 'fuel' && l.vehicleId) {
      const v = vehicles.get(l.vehicleId);
      return { ...l, kmPerL: v ? v.kmPerL : null };
    }
    return l;
  });
}
