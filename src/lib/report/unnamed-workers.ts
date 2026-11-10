// 名前なし（会社と人数）の作業員の行（純関数。2026-11-19。update_2026-11-19_unnamed_workers.sql）。
// 協力会社が請負で入るとき、作業した人の名前が分からないことがある。そのときは作業員を選ばずに、
// 会社（協力会社）と人数だけで 1 行に入れる。
//
// - 行の印は人数（headcount）。人数が入っている作業員の行が名前なしの行（作業員 ID なし・所属は協力会社・会社は選んだ会社）。
//   名前のある行（作業員を選んだ行・手入力の行）の人数は null（1 人）。画面で人数を空にしている間は 0（保存のときに止める）。
// - 時間（開始・終了・休憩・中抜）・実働 H・うち常用の時間は 1 人あたり。人工・残業 H・労務費は人数分（1 人分 × 人数）。
//   DB のトリガー gn_report_lines_compute も同じ（man_days・overtime_hours・amount は人数分、hours は 1 人あたり）。
// - 名前（name 列）は「会社名（名前なし）」。保存のときにサーバーが会社の名前から付け直す。
//   作業員別累計・出面一覧は名前でまとめるので、名前なしの行は会社ごとに「会社名（名前なし）」の 1 行になる。

/** 名前の後ろに付ける印。 */
export const UNNAMED_SUFFIX = '（名前なし）';
/** 作業員の選択肢の「名前なし」の表示名。 */
export const UNNAMED_OPTION_LABEL = '（名前なし：会社と人数で入れる）';
/** 名前なしの行の下に出す知らせ（保存は止めない）。 */
export const UNNAMED_SAFETY_NOTE = '作業した人の名前が分かったら入れてください（安全管理）';
/** DB に人数の列が無い（SQL の前）ときに名前なしの行を保存しようとしたとき。 */
export const UNNAMED_NOT_READY_MESSAGE =
  '名前なし（会社と人数）の行は、まだ保存できません（管理者がデータベースの更新を済ませると使えます）。作業員を選ぶか「（手入力）」で入れてください';
/** 名前なしの行の会社が協力会社でない（見つからない）とき。 */
export const UNNAMED_NOT_PARTNER_MESSAGE = '名前なしの行の会社は協力会社から選んでください';

/** 名前なし（会社と人数）の行か：人数が入っている（0 は入力途中）。 */
export function isUnnamedLabor(line: { headcount?: number | null }): boolean {
  return line.headcount !== null && line.headcount !== undefined;
}

/** 計算に使う人数。名前のある行（null・省略）と、入力途中（1 未満・数でない）は 1 人。 */
export function laborHeadcount(line: { headcount?: number | null }): number {
  const h = line.headcount;
  return typeof h === 'number' && Number.isFinite(h) && h >= 1 ? Math.floor(h) : 1;
}

/** 名前なしの行の名前（会社名（名前なし））。 */
export function unnamedWorkerName(companyName: string): string {
  return `${companyName.trim() || '協力会社'}${UNNAMED_SUFFIX}`;
}

/** 出面の表示名：名前なしの行は「東北建興（名前なし）2名」、それ以外は名前のまま。 */
export function laborDisplayName(line: { workerName: string; headcount?: number | null }): string {
  if (!isUnnamedLabor(line)) return line.workerName;
  return `${line.workerName}${laborHeadcount(line)}名`;
}

/**
 * 名前なしの行の会社の選択肢：協力会社の印のある会社のうち、現場に関わる会社（現場の協力会社・この現場の協力会社の作業員の会社・
 * 実行予算で請負の会社）で有効なもの。1 社も無ければ有効な協力会社全部。この日報の名前なしの行で使っている会社は
 * 無効・印を外した後でも残す。並びは名前順。
 */
export function unnamedCompanyChoices<T extends { id: string; name: string; active: boolean; isPartner: boolean }>(opts: {
  suppliers: T[];
  siteCompanyIds: Iterable<string>;
  usedIds: ReadonlySet<string>;
}): T[] {
  const site = new Set(opts.siteCompanyIds);
  const partners = opts.suppliers.filter((s) => s.isPartner && s.active);
  const onSite = partners.filter((s) => site.has(s.id));
  const base = onSite.length > 0 ? onSite : partners;
  const ids = new Set(base.map((s) => s.id));
  const used = opts.suppliers.filter((s) => opts.usedIds.has(s.id) && !ids.has(s.id));
  return [...base, ...used].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/**
 * 保存のとき（サーバー）：名前なしの行の会社を確かめ、名前を「会社名（名前なし）」に付け直す。
 * 会社は協力会社の印のある会社だけ。この日報の名前なしの行ですでに使っている会社（storedIds）は、印を外した後でも保存し直せる。
 * 会社が見つからない・協力会社でなければ文言を返す。
 */
export function applyUnnamedCompanies<L extends { kind: string }>(
  lines: L[],
  companies: ReadonlyMap<string, { name: string; isPartner: boolean }>,
  storedIds: ReadonlySet<string>,
): { ok: true; lines: L[] } | { ok: false; error: string } {
  const out: L[] = [];
  for (const l of lines) {
    const labor = l as unknown as { kind: string; workerId?: string | null; headcount?: number | null; supplierId?: string | null };
    if (labor.kind !== 'labor' || labor.workerId || !isUnnamedLabor(labor)) {
      out.push(l);
      continue;
    }
    const c = labor.supplierId ? companies.get(labor.supplierId) : undefined;
    if (!c || !(c.isPartner || storedIds.has(labor.supplierId!))) return { ok: false, error: UNNAMED_NOT_PARTNER_MESSAGE };
    out.push({ ...l, workerName: unnamedWorkerName(c.name) });
  }
  return { ok: true, lines: out };
}

/** 名前なしの行の会社の ID（重なりなし）。 */
export function unnamedCompanyIds(lines: readonly { kind: string }[]): string[] {
  const ids = new Set<string>();
  for (const l of lines) {
    const labor = l as { kind: string; workerId?: string | null; headcount?: number | null; supplierId?: string | null };
    if (labor.kind === 'labor' && !labor.workerId && isUnnamedLabor(labor) && labor.supplierId) ids.add(labor.supplierId);
  }
  return [...ids];
}
