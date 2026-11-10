import { rateAt, type RateHistory } from '@/lib/calc/rates';
import { isUnnamedLabor } from '@/lib/report/unnamed-workers';
import type { Affiliation, LaborContract, LaborLine, ReportLine } from '@/lib/types';

// 保存時に、マスターを参照している明細の単価（日当・リース単価・燃費）をサーバー側で決め直す（純関数）。
// クライアントから届いた単価は信用しない。保存された値はその日の単価の「複写（スナップショット）」で、
// 集計（労務費・リース費・燃料費）はこの保存値を使う。後でマスターの単価履歴を直しても、
// その日報を保存し直すまで保存済みの値は変わらない。
// - 作業員（workerId あり）：日当 = 作業員の単価履歴のうち日報の日付に有効なもの、残業単価 = 作業員の残業単価（無ければ null）
// - リース（itemId あり）：単価 = リース品の単価履歴のうち日報の日付に有効なもの
// - 車両（vehicleId あり）：燃費 = 車両マスターの燃費
// - 参照の無い行（手入力の行）はクライアントの値のまま
// - 参照先がマスターに無い（形式は正しいが存在しない ID）行は単価を null にする（0円として計算される）
// 所属（2026-11-07）：
// - 作業員（workerId あり）：affiliation・supplierId = 作業員マスターのいまの所属（自社なら supplierId は null）。
//   ただし、この日報にすでに保存されている作業員（prev）は保存済みの所属のまま（保存し直しても変わらない）。
//   その日報に新しく加えた作業員だけ、その時点のマスターの所属を写す。過去の行をまとめて写し直すときは
//   supabase/recalc_2026-11-07_line_affiliation.sql を使う。
// - 常用・請負（laborContract）：所属が協力会社の行だけ持つ（未選択 null は 'jouyou'。保存済みの作業員で項目が無い（undefined）ときだけ保存済みの区分）。自社・手入力・マスターに無い行は null。
// - 手入力の作業員（workerId なし）・マスターに無い作業員：所属は null（所属なし）。画面から届いた所属は使わない。
// - 名前なし（会社と人数）の行（headcount あり・workerId なし。2026-11-19）：所属は協力会社、会社は画面で選んだ会社（supplierId）。
//   常用・請負は画面の選択（未選択は常用）。作業員を選んだ行・手入力の行の人数は null にする。
// - うち常用の時間（jouyouHours。2026-11-17）：区分が請負の協力会社の行だけ残し、それ以外の行は null。

export interface SnapshotMasters {
  workers: { id: string; rates: RateHistory[]; overtimeRate: number | null; affiliation: Affiliation; supplierId: string | null }[];
  vehicles: { id: string; kmPerL: number | null }[];
  leaseItems: { id: string; rates: RateHistory[] }[];
}

export function needsMasterSnapshots(lines: ReportLine[]): boolean {
  return lines.some(
    (l) => (l.kind === 'labor' && l.workerId) || (l.kind === 'lease' && l.itemId) || (l.kind === 'fuel' && l.vehicleId),
  );
}

/** 参照の無い行に使うマスター（マスターを読まずに applyMasterSnapshots を呼ぶとき）。 */
export const EMPTY_SNAPSHOT_MASTERS: SnapshotMasters = { workers: [], vehicles: [], leaseItems: [] };

// 手入力の作業員の行：所属なし・常用（うち常用の時間なし）。値が入っていなければ同じオブジェクトのまま返す。
function withoutAffiliation(l: LaborLine): LaborLine {
  if (
    (l.laborContract ?? null) === null && (l.affiliation ?? null) === null && (l.supplierId ?? null) === null && (l.jouyouHours ?? null) === null
  ) {
    return l;
  }
  return { ...l, laborContract: null, affiliation: null, supplierId: null, ...(l.jouyouHours === undefined ? {} : { jouyouHours: null }) };
}

// うち常用の時間は区分が請負の行だけ（項目が無い行には足さない）。
function jouyouHoursFor(l: LaborLine, contract: LaborContract | null): Pick<LaborLine, 'jouyouHours'> {
  if (l.jouyouHours === undefined) return {};
  return { jouyouHours: contract === 'ukeoi' ? (l.jouyouHours ?? null) : null };
}

/** この日報にすでに保存されている作業員の行の所属の写し（作業員 ID ごと）。保存し直しでは、これを優先する。 */
export type StoredAffiliations = Map<string, { affiliation: Affiliation | null; supplierId: string | null; laborContract: LaborContract | null }>;

export function applyMasterSnapshots(
  lines: ReportLine[],
  date: string,
  masters: SnapshotMasters,
  prev: StoredAffiliations = new Map(),
): ReportLine[] {
  const workers = new Map(masters.workers.map((w) => [w.id, w]));
  const vehicles = new Map(masters.vehicles.map((v) => [v.id, v]));
  const items = new Map(masters.leaseItems.map((i) => [i.id, i]));
  return lines.map((orig) => {
    // 人数は名前なし（作業員を選んでいない）行だけ。作業員を選んだ行に来た人数は消す。
    const l: ReportLine = orig.kind === 'labor' && orig.workerId && (orig.headcount ?? null) !== null ? { ...orig, headcount: null } : orig;
    if (l.kind === 'labor' && !l.workerId && isUnnamedLabor(l)) {
      // 名前なし（会社と人数）の行：協力会社・選んだ会社。区分は画面の選択（未選択は常用）。会社が協力会社かは保存の処理で確かめる。
      const contract = l.laborContract ?? 'jouyou';
      return { ...l, laborContract: contract, affiliation: 'partner', supplierId: l.supplierId ?? null, ...jouyouHoursFor(l, contract) };
    }
    if (l.kind === 'labor' && l.workerId) {
      const w = workers.get(l.workerId);
      const rates = w ? { dailyRate: rateAt(w.rates, date), overtimeRate: w.overtimeRate } : { dailyRate: null, overtimeRate: null };
      // 保存し直し：この日報に保存済みの作業員は、保存した所属のまま（後でマスターの所属を変えても動かない）。
      const stored = prev.get(l.workerId);
      if (stored && stored.affiliation !== null) {
        const partner = stored.affiliation === 'partner';
        // 画面から届いた区分を使う。null（常用を選んだ・選び直した）は常用。項目自体が無い（古い下書き・取り込み）ときだけ保存済みの区分。
        const contract = partner ? (l.laborContract === undefined ? (stored.laborContract ?? 'jouyou') : (l.laborContract ?? 'jouyou')) : null;
        return {
          ...l,
          ...rates,
          laborContract: contract,
          affiliation: stored.affiliation,
          supplierId: partner ? stored.supplierId : null,
          ...jouyouHoursFor(l, contract),
        };
      }
      if (!w) return { ...l, ...rates, laborContract: null, affiliation: null, supplierId: null, ...jouyouHoursFor(l, null) };
      const partner = w.affiliation === 'partner';
      const contract = partner ? (l.laborContract ?? 'jouyou') : null;
      return {
        ...l,
        ...rates,
        laborContract: contract,
        affiliation: w.affiliation,
        supplierId: partner ? w.supplierId : null,
        ...jouyouHoursFor(l, contract),
      };
    }
    if (l.kind === 'labor') return withoutAffiliation(l);
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
