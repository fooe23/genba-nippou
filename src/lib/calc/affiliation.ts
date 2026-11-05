import type { Affiliation, LaborContract } from '@/lib/types';

// 作業員の所属（自社／協力会社）の表示・絞り込みと、削除の可否（純関数。画面から使う）。

export const OWN_LABEL = '自社';
export const NO_AFFILIATION_LABEL = '所属なし';
/** 協力会社だが取引先の名前が引けないとき。 */
export const UNKNOWN_PARTNER_LABEL = '協力会社';

export const LABOR_CONTRACT_LABELS: Record<LaborContract, string> = { jouyou: '常用', ukeoi: '請負' };

/** 取引先 ID → 名前。 */
export type SupplierNames = Readonly<Record<string, string>>;

/**
 * 所属の表示名：自社／取引先名／所属なし（null・省略＝手入力やマスターに無い作業員）。
 * 協力会社で取引先の名前が引けなければ「協力会社」。
 */
export function affiliationLabel(
  affiliation: Affiliation | null | undefined,
  supplierId: string | null | undefined,
  supplierNames: SupplierNames,
): string {
  if (affiliation === 'own') return OWN_LABEL;
  if (affiliation === 'partner') return (supplierId ? supplierNames[supplierId] : undefined) || UNKNOWN_PARTNER_LABEL;
  return NO_AFFILIATION_LABEL;
}

/** 作業員マスターの一覧の絞り込み：すべて／自社／取引先 ID（その協力会社）。 */
export type WorkerFilter = 'all' | 'own' | string;

interface FilterableWorker { active: boolean; affiliation: Affiliation; supplierId: string | null; }

function matches(w: FilterableWorker, filter: WorkerFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'own') return w.affiliation !== 'partner';
  return w.affiliation === 'partner' && w.supplierId === filter;
}

/** 絞り込みに合う作業員。showInactive が false なら有効な作業員だけ。並びはそのまま。 */
export function filterWorkers<T extends FilterableWorker>(workers: T[], filter: WorkerFilter, showInactive: boolean): T[] {
  return workers.filter((w) => (showInactive || w.active) && matches(w, filter));
}

/** 絞り込みに合う無効な作業員の数（「無効も表示（N 名）」）。 */
export function countInactive(workers: FilterableWorker[], filter: WorkerFilter): number {
  return workers.filter((w) => !w.active && matches(w, filter)).length;
}

/**
 * 絞り込みの選択肢：すべて・自社・協力会社の作業員がいる取引先（名前順）。
 * 名前の引けない取引先は「協力会社」。
 */
export function workerFilterOptions(workers: FilterableWorker[], supplierNames: SupplierNames): { value: WorkerFilter; label: string }[] {
  const ids = new Set<string>();
  for (const w of workers) if (w.affiliation === 'partner' && w.supplierId) ids.add(w.supplierId);
  const companies = [...ids]
    .map((id) => ({ value: id, label: supplierNames[id] || UNKNOWN_PARTNER_LABEL }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  return [{ value: 'all', label: 'すべて' }, { value: 'own', label: OWN_LABEL }, ...companies];
}

/** 作業員の編集画面の削除の欄：削除ボタン／「使用中のため削除できません」／何も出さない（確認中・確認できなかった）。 */
export type WorkerDeleteView = 'deletable' | 'in_use' | 'none';

/** 使用状況（workerUsage の結果）から削除の欄を決める。日報・繰越で一度も使っていない作業員だけ削除できる。 */
export function workerDeleteView(usage: 'loading' | 'error' | { used: boolean }): WorkerDeleteView {
  if (usage === 'loading' || usage === 'error') return 'none';
  return usage.used ? 'in_use' : 'deletable';
}

/** この日報に保存済みの作業員の行の所属と常用・請負の写し（作業員 ID ごと。サーバーの保存し直しと同じ材料）。 */
export type StoredLaborAffiliations = ReadonlyMap<string, { affiliation: Affiliation; supplierId: string | null; laborContract: LaborContract | null }>;

/**
 * 日報を開いたときに読み込んだ（保存済みの）行から、作業員ごとの所属の写し（最初の行）を集める。
 * サーバーは保存し直しのとき、この日報に保存済みの作業員はこの写しを使う（src/lib/report/snapshots.ts）。
 */
export function storedLaborAffiliations(
  lines: { kind: string; workerId?: string | null; affiliation?: Affiliation | null; supplierId?: string | null; laborContract?: LaborContract | null }[],
): Map<string, { affiliation: Affiliation; supplierId: string | null; laborContract: LaborContract | null }> {
  const out = new Map<string, { affiliation: Affiliation; supplierId: string | null; laborContract: LaborContract | null }>();
  for (const l of lines) {
    if (l.kind !== 'labor' || !l.workerId || !l.affiliation || out.has(l.workerId)) continue;
    const partner = l.affiliation === 'partner';
    out.set(l.workerId, {
      affiliation: l.affiliation,
      supplierId: partner ? (l.supplierId ?? null) : null,
      laborContract: partner ? (l.laborContract ?? null) : null,
    });
  }
  return out;
}

/**
 * 日報の作業員の行の所属（表示と、常用／請負の欄を出すかの判断）。保存時にサーバーが決める値と同じにする。
 * - 手入力（workerId なし）：所属なし（null）。
 * - この日報に保存済みの作業員：保存済みの所属（後でマスターを変えても動かない）。
 * - それ以外：作業員マスターのいまの所属。マスターにも無ければ所属なし。
 */
export function laborRowAffiliation(
  line: { workerId: string | null },
  stored: StoredLaborAffiliations,
  worker: { affiliation?: Affiliation; supplierId?: string | null } | undefined,
): { affiliation: Affiliation | null; supplierId: string | null } {
  if (!line.workerId) return { affiliation: null, supplierId: null };
  const s = stored.get(line.workerId);
  if (s) return { affiliation: s.affiliation, supplierId: s.affiliation === 'partner' ? s.supplierId : null };
  if (worker?.affiliation) {
    return { affiliation: worker.affiliation, supplierId: worker.affiliation === 'partner' ? (worker.supplierId ?? null) : null };
  }
  return { affiliation: null, supplierId: null };
}

/**
 * 協力会社の作業員の行の常用・請負の表示値（保存時にサーバーが決める値と同じ）。
 * 行に値があればそれ、null（常用を選んだ・選び直した）は常用。項目が無い（undefined。古い下書き・取り込み）ときだけ
 * この日報に保存済みの区分、それも無ければ常用。
 */
export function laborContractValue(
  line: { workerId: string | null; laborContract?: LaborContract | null },
  stored: StoredLaborAffiliations,
): LaborContract {
  if (line.laborContract !== undefined) return line.laborContract ?? 'jouyou';
  const s = line.workerId ? stored.get(line.workerId) : undefined;
  return (s?.affiliation === 'partner' ? s.laborContract : null) ?? 'jouyou';
}

// ─── 現場の「協力会社と作業員」 ───

/**
 * 現場に追加できる協力会社：有効な協力会社（協力会社の印のある会社）のうち、まだこの現場に無いもの（名前順）。
 * すでにある会社は追加し直さない（請負金額を消さないため）。取引先だけの会社は出さない。
 */
export function addablePartnerSuppliers<T extends { id: string; name: string; active: boolean; isPartner: boolean }>(
  suppliers: T[],
  sitePartnerSupplierIds: string[],
): T[] {
  const have = new Set(sitePartnerSupplierIds);
  return suppliers.filter((s) => s.active && s.isPartner && !have.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 協力会社 1 社の、現場に登録できる作業員：その会社の有効な協力会社の作業員（名前順）。無効な作業員は出さない。 */
export function partnerWorkerChoices<T extends { id: string; name: string; active: boolean; affiliation: Affiliation; supplierId: string | null }>(
  workers: T[],
  supplierId: string,
): T[] {
  return workers
    .filter((w) => w.active && w.affiliation === 'partner' && w.supplierId === supplierId)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
