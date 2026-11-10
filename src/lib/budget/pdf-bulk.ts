import type { CandidateKind } from './pdf-table';

// PDF 取り込みの確かめ画面で「まとめて選ぶ」ための計算（画面の状態に依存しない）。
// ページごと・見出しごとに行を束ね、取り込む印と工種（識別）をまとめて付け外しする。

/** まとめて選ぶのに使う行の項目（画面の行はこれより多くの項目を持つ）。 */
export interface BulkRow {
  key: string;
  include: boolean;
  kind: CandidateKind;
  page: number;
  tag: string;
  name: string;
}

export interface RowGroup {
  /** 先頭の行の key。 */
  id: string;
  /** 見出しの文字（見出しより前の行は「見出しなし」）。 */
  title: string;
  /** 行のあるページ（小さい順・重なりなし）。 */
  pages: number[];
  keys: string[];
}

export const NO_HEADING_TITLE = '見出しなし';

/**
 * 見出しの行で区切って束ねる（並び順はそのまま）。
 * 見出しが続くとき（【建築工事】の次に「仮設工事」など）は 1 つの束にして、文字を「／」でつなぐ。
 */
export function groupByHeading(rows: readonly BulkRow[]): RowGroup[] {
  const groups: RowGroup[] = [];
  let cur: (RowGroup & { onlyHeadings: boolean }) | null = null;
  for (const r of rows) {
    if (r.kind === 'heading') {
      const text = r.name.trim() || NO_HEADING_TITLE;
      if (cur && cur.onlyHeadings) {
        cur.title = `${cur.title}／${text}`;
      } else {
        cur = {
          id: r.key,
          title: text,
          pages: [],
          keys: [],
          onlyHeadings: true,
        };
        groups.push(cur);
      }
    } else if (!cur) {
      cur = {
        id: r.key,
        title: NO_HEADING_TITLE,
        pages: [],
        keys: [],
        onlyHeadings: false,
      };
      groups.push(cur);
    } else {
      cur.onlyHeadings = false;
    }
    cur.keys.push(r.key);
    if (!cur.pages.includes(r.page)) cur.pages.push(r.page);
  }
  return groups.map(({ id, title, pages, keys }) => ({
    id,
    title,
    pages: [...pages].sort((a, b) => a - b),
    keys,
  }));
}

/** ページ番号の表示（「3 ページ」「3〜4 ページ」「3・5 ページ」）。 */
export function pagesLabel(pages: readonly number[]): string {
  if (pages.length === 0) return '';
  const contiguous = pages.every((p, i) => i === 0 || p === pages[i - 1] + 1);
  if (pages.length === 1) return `${pages[0]} ページ`;
  return contiguous ? `${pages[0]}〜${pages[pages.length - 1]} ページ` : `${pages.join('・')} ページ`;
}

export interface IncludedSummary {
  /** 取り込む行の数。 */
  count: number;
  /** 取り込む行の金額の合計。 */
  amount: number;
  /** 取り込む行のうち、工種（識別）がまだの行の数。 */
  untagged: number;
}

/** 取り込む行の数・金額・工種がまだの数。 */
export function summarize<T extends BulkRow>(rows: readonly T[], amountOf: (r: T) => number | null): IncludedSummary {
  let count = 0;
  let amount = 0;
  let untagged = 0;
  for (const r of rows) {
    if (!r.include) continue;
    count += 1;
    amount += amountOf(r) ?? 0;
    if (r.tag === '') untagged += 1;
  }
  return { count, amount, untagged };
}

export interface PageSummary extends IncludedSummary {
  page: number;
  /** ページに取り込む行が 1 つでもある。 */
  checked: boolean;
}

/** ページごとの集計（行のあるページだけ、小さい順）。 */
export function pageSummaries<T extends BulkRow>(rows: readonly T[], amountOf: (r: T) => number | null): PageSummary[] {
  const byPage = new Map<number, T[]>();
  for (const r of rows) {
    const list = byPage.get(r.page);
    if (list) list.push(r);
    else byPage.set(r.page, [r]);
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page, list]) => {
      const s = summarize(list, amountOf);
      return { page, ...s, checked: s.count > 0 };
    });
}

/**
 * 当てはまる行の取り込む印をまとめて付け外しする。
 * 付けるときは明細の行だけ（見出し・小計・合計・空の行は付けない＝二重に数えない）。
 */
export function setInclude<T extends BulkRow>(rows: readonly T[], match: (r: T) => boolean, include: boolean): T[] {
  return rows.map((r) => {
    if (!match(r)) return r;
    if (include && r.kind !== 'item') return r;
    return r.include === include ? r : { ...r, include };
  });
}

/**
 * 当てはまる行のうち取り込む行に、工種（識別）をまとめて付ける。
 * onlyEmpty のときは工種がまだの行だけ（選んである行は変えない）。
 */
export function setTag<T extends BulkRow>(rows: readonly T[], match: (r: T) => boolean, tag: string, onlyEmpty: boolean): T[] {
  return rows.map((r) => {
    if (!match(r) || !r.include) return r;
    if (onlyEmpty && r.tag !== '') return r;
    return r.tag === tag ? r : { ...r, tag };
  });
}

/** 取り込む行で工種（識別）がまだの行か。 */
export function isUntagged(r: BulkRow): boolean {
  return r.include && r.tag === '';
}

/**
 * 見出しの束を初めに開いておくか：行が少ない（limit 以下）ときは全部開く。
 * 多いときは、工種がまだの取り込む行がある束だけ開く（残りの作業が見えるように）。
 */
export function initialExpanded(rows: readonly BulkRow[], groups: readonly RowGroup[], limit = 60): Record<string, boolean> {
  const all = rows.length <= limit;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: Record<string, boolean> = {};
  for (const g of groups) {
    out[g.id] =
      all ||
      g.keys.some((k) => {
        const r = byKey.get(k);
        return r !== undefined && isUntagged(r);
      });
  }
  return out;
}
