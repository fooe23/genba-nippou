import { lineAmount } from '@/lib/budget/schemas';
import type { ContractCategory, ContractSection } from '@/lib/budget/types';

// 元請けの内訳（注文書・内訳書）の文字 PDF から、表の行と列を推定する純関数。
// 入力は pdf.js のテキスト項目（ページごと。x・y はページの左上を原点にした座標で、y は下へ増える。y は文字の基準線）。
// 1. 行：y が近い項目（文字の高さの半分まで）を 1 行にまとめる。
// 2. セル：行の中で x の隙間が文字の高さの 0.6 倍より広いところで区切る。
// 3. 列：見出しの行（名称・品名・工種・規格・仕様・数量・単位・単価・金額・摘要のうち 3 つ以上、数量か金額を含む）があれば
//    その見出しの位置で、無ければ数の列（右揃え）と文字の列（左揃え）の位置のまとまりで決める。全ページで同じ列を使う。
// 4. 候補：列の割り当て（名称・規格・数量・単位・単価・金額・使わない）から行の中身を読み、行の種類（明細・見出し・小計・合計・空）
//    と区分（＜変更増減分＞などの見出しの後は「変更」）と識別（経費・減分の推定）を付ける。明細以外は取り込まない（画面で入れ直せる）。

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ColumnRole = 'name' | 'spec' | 'qty' | 'unit' | 'unitPrice' | 'amount' | 'ignore';
export const COLUMN_ROLES: readonly ColumnRole[] = ['name', 'spec', 'qty', 'unit', 'unitPrice', 'amount', 'ignore'];
export const COLUMN_ROLE_LABEL: Record<ColumnRole, string> = {
  name: '名称',
  spec: '規格',
  qty: '数量',
  unit: '単位',
  unitPrice: '単価',
  amount: '金額',
  ignore: '使わない',
};

export interface PdfColumn {
  /** 見出しの文字（見出しが無ければ「列 1」など）。 */
  label: string;
  /** 推定した割り当て。 */
  role: ColumnRole;
  x0: number;
  x1: number;
}

export interface PdfTableRow {
  /** 列ごとの文字（列の数と同じ長さ）。 */
  cells: string[];
  /** 1 始まりのページ番号。 */
  page: number;
  y: number;
  height: number;
}

export interface PdfTable {
  columns: PdfColumn[];
  rows: PdfTableRow[];
  /** 見出しの行で列を決めたか（false＝数の位置から推定）。 */
  headerFound: boolean;
}

export type CandidateKind = 'item' | 'heading' | 'subtotal' | 'total' | 'blank';

export interface CandidateGuess {
  name: string;
  spec: string;
  qty: number | null;
  unit: string;
  unitPrice: number | null;
  /** PDF に書かれた金額（数量 × 単価と合うかの確かめに使う。保存はアプリが数量 × 単価で計算し直す）。 */
  amount: number | null;
}

export interface PdfCandidate {
  cells: string[];
  page: number;
  kind: CandidateKind;
  /** 初めから取り込む印を付けるか（明細の行だけ）。 */
  include: boolean;
  section: ContractSection;
  /** 直前の見出しの文字（工種の推定に使う）。 */
  heading: string | null;
  guess: CandidateGuess;
  /** 推定した識別（経費・減分・それ以外は工種）。 */
  category: ContractCategory;
  /** PDF の金額が round(数量 × 単価) と合わない。 */
  amountMismatch: boolean;
}

// ─── 数・文字 ───

/** 空白を除き、全角を半角にした文字（見出し・キーワードの比べ用）。 */
export function squash(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '');
}

/**
 * 数の文字を読む（「1,305,000」「¥1,305,000」「1,305,000円」「１２３」）。「△」「▲」「−」「-」が頭にあれば負、
 * 「(1,000)」も負。空欄は null、数でなければ NaN。
 */
export function parseAmount(raw: string): number | null {
  let s = raw.normalize('NFKC').replace(/[,\s¥￥円\\]/g, '');
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^[△▲▽▼−‐‑–—ー―-]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return Number.NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return Number.NaN;
  return neg ? -n : n;
}

function isNumeric(s: string): boolean {
  const n = parseAmount(s);
  return n !== null && !Number.isNaN(n);
}

const UNIT_RE =
  /^(式|一式|㎡|m2|m²|m\^2|㎥|m3|m³|m|㍍|km|cm|mm|kg|t|ℓ|l|本|枚|台|個|基|組|セット|set|箇所|ヶ所|ケ所|カ所|か所|ヵ所|所|人工|人|日|回|月|ヶ月|ケ月|缶|袋|缶|巻|丁|張|面|段|層|橋|径間)$/i;

/** 単位らしい文字か。 */
export function isUnitText(s: string): boolean {
  return UNIT_RE.test(squash(s));
}

/** 「450㎡」「1式」のような数と単位のくっついた文字を分ける（分けられなければ null）。 */
function splitQtyUnit(s: string): { qty: number; unit: string } | null {
  const m = squash(s).match(/^([△▲−-]?[\d,]+(?:\.\d+)?)(\D{1,4})$/);
  if (!m || !isUnitText(m[2])) return null;
  const qty = parseAmount(m[1]);
  if (qty === null || Number.isNaN(qty)) return null;
  return { qty, unit: m[2] };
}

// ─── 行とセル ───

interface Cell {
  text: string;
  x0: number;
  x1: number;
}

interface RawRow {
  cells: Cell[];
  page: number;
  y: number;
  height: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pageRows(items: PdfTextItem[], page: number): RawRow[] {
  const valid = items.filter((i) => i.str.trim() !== '' && Number.isFinite(i.x) && Number.isFinite(i.y));
  if (valid.length === 0) return [];
  const fallbackH = median(valid.map((i) => i.height).filter((h) => h > 0)) || 10;
  const hOf = (i: PdfTextItem) => (i.height > 0 ? i.height : fallbackH);
  const sorted = [...valid].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: { y: number; h: number; items: PdfTextItem[] }[] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(it.y - g.y) <= Math.max(g.h, hOf(it)) * 0.5) {
      g.items.push(it);
      g.h = Math.max(g.h, hOf(it));
    } else {
      groups.push({ y: it.y, h: hOf(it), items: [it] });
    }
  }
  return groups.map((g) => {
    const its = [...g.items].sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let cur: Cell | null = null;
    for (const it of its) {
      const x1 = it.x + Math.max(it.width, 0);
      if (cur && it.x - cur.x1 <= g.h * 0.6) {
        // 隙間がほとんど無ければ続けてつなぐ。少しあれば空白を 1 つ入れる（英数の語の区切り）
        cur.text += it.x - cur.x1 > g.h * 0.2 ? ` ${it.str}` : it.str;
        cur.x1 = Math.max(cur.x1, x1);
      } else {
        cur = { text: it.str, x0: it.x, x1 };
        cells.push(cur);
      }
    }
    for (const c of cells) c.text = c.text.trim();
    return { cells: cells.filter((c) => c.text !== ''), page, y: g.y, height: g.h };
  });
}

// ─── 見出しの行 ───

const HEADER_KEYWORDS: { role: ColumnRole | 'remarks'; words: string[] }[] = [
  { role: 'amount', words: ['金額'] },
  { role: 'unitPrice', words: ['単価'] },
  { role: 'qty', words: ['数量'] },
  { role: 'unit', words: ['単位'] },
  { role: 'name', words: ['名称', '品名', '工種', '品目', '項目', '工事内容', '内容'] },
  { role: 'spec', words: ['規格', '仕様', '形状', '寸法'] },
  { role: 'remarks', words: ['摘要', '備考'] },
];

function headerRole(text: string): ColumnRole | 'remarks' | null {
  const t = squash(text);
  if (t === '' || t.length > 12) return null;
  for (const k of HEADER_KEYWORDS) if (k.words.some((w) => t.includes(w))) return k.role;
  return null;
}

interface HeaderCell extends Cell {
  role: ColumnRole | 'remarks' | null;
}

/** 見出しの行なら、見出しのセル（「名　称」のように離れて書かれた字はつなぐ）を返す。 */
function headerCells(row: RawRow): HeaderCell[] | null {
  const out: HeaderCell[] = [];
  const cs = row.cells;
  for (let i = 0; i < cs.length; i++) {
    let role = headerRole(cs[i].text);
    let end = i;
    if (role === null) {
      // 「名」「称」のように 1 字ずつ離れたものは、つないで見出しになるか試す（3 つまで）
      let text = cs[i].text;
      for (let j = i + 1; j < Math.min(cs.length, i + 3); j++) {
        text += cs[j].text;
        const r = headerRole(text);
        if (r !== null) {
          role = r;
          end = j;
          break;
        }
      }
    }
    if (role !== null) {
      out.push({ text: cs.slice(i, end + 1).map((c) => c.text).join(''), x0: cs[i].x0, x1: cs[end].x1, role });
      i = end;
    } else {
      out.push({ ...cs[i], role: null });
    }
  }
  const roles = new Set(out.map((c) => c.role).filter((r) => r !== null));
  if (roles.size < 3) return null;
  if (!roles.has('qty') && !roles.has('amount')) return null;
  // 数の並ぶ明細の行を見出しと取り違えない
  if (row.cells.filter((c) => isNumeric(c.text)).length >= 2) return null;
  return out;
}

function columnsFromHeader(hcs: HeaderCell[]): PdfColumn[] {
  const hasSpec = hcs.some((c) => c.role === 'spec');
  const used = new Set<ColumnRole>();
  return hcs.map((c, i) => {
    let role: ColumnRole = 'ignore';
    if (c.role === 'remarks') role = hasSpec ? 'ignore' : 'spec';
    else if (c.role !== null) role = c.role;
    // 同じ割り当ての 2 つめ以降（「工種」「名称」が両方ある、など）は使わない（画面で選び直せる）
    if (role !== 'ignore' && used.has(role)) role = 'ignore';
    if (role !== 'ignore') used.add(role);
    return { label: squash(c.text) || `列 ${i + 1}`, role, x0: c.x0, x1: c.x1 };
  });
}

// ─── 見出しが無いときの列の推定 ───

interface Cluster {
  numeric: boolean;
  anchor: number;
  x0: number;
  x1: number;
  count: number;
  numbers: number[];
  texts: string[];
}

function columnsFromLayout(rows: RawRow[]): PdfColumn[] {
  // 数が 2 つ以上ある行（明細らしい行）から列の位置を集める
  const dataRows = rows.filter((r) => r.cells.filter((c) => isNumeric(c.text)).length >= 2);
  const source = dataRows.length > 0 ? dataRows : rows;
  const h = median(source.map((r) => r.height)) || 10;
  const clusters: Cluster[] = [];
  for (const r of source) {
    for (const c of r.cells) {
      const numeric = isNumeric(c.text);
      const anchor = numeric ? c.x1 : c.x0; // 数は右揃え、文字は左揃え
      let k = clusters.find((cl) => cl.numeric === numeric && Math.abs(cl.anchor - anchor) <= h * 1.5);
      if (!k) {
        k = { numeric, anchor, x0: c.x0, x1: c.x1, count: 0, numbers: [], texts: [] };
        clusters.push(k);
      }
      k.count += 1;
      k.x0 = Math.min(k.x0, c.x0);
      k.x1 = Math.max(k.x1, c.x1);
      if (numeric) k.numbers.push(Math.abs(parseAmount(c.text) ?? 0));
      else k.texts.push(c.text);
    }
  }
  const minCount = Math.max(1, Math.ceil(source.length * 0.2));
  const kept = clusters.filter((c) => c.count >= minCount).sort((a, b) => (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2);
  if (kept.length === 0) return [{ label: '列 1', role: 'name', x0: 0, x1: Number.MAX_SAFE_INTEGER }];

  const roles: ColumnRole[] = kept.map(() => 'ignore');
  // 数の列：合計の大きい列を金額、その左の数の列を単価、さらに左を数量
  const numIdx = kept.map((c, i) => (c.numeric ? i : -1)).filter((i) => i >= 0);
  if (numIdx.length > 0) {
    const sum = (i: number) => kept[i].numbers.reduce((a, b) => a + b, 0);
    const amountIdx = numIdx.reduce((best, i) => (sum(i) > sum(best) ? i : best), numIdx[0]);
    roles[amountIdx] = 'amount';
    const left = numIdx.filter((i) => i < amountIdx).reverse();
    if (left[0] !== undefined) roles[left[0]] = 'unitPrice';
    if (left[1] !== undefined) roles[left[1]] = 'qty';
  }
  // 文字の列：単位らしい文字が多い列を単位、残りの左から名称・規格
  const textIdx = kept.map((c, i) => (!c.numeric ? i : -1)).filter((i) => i >= 0);
  const unitIdx = textIdx.find((i) => kept[i].texts.filter(isUnitText).length >= kept[i].texts.length * 0.6);
  if (unitIdx !== undefined) roles[unitIdx] = 'unit';
  const firstNum = numIdx.length > 0 ? Math.min(...numIdx) : kept.length;
  const nameSpec = textIdx.filter((i) => i !== unitIdx && i < firstNum);
  if (nameSpec[0] !== undefined) roles[nameSpec[0]] = 'name';
  if (nameSpec[1] !== undefined) roles[nameSpec[1]] = 'spec';
  return kept.map((c, i) => ({ label: `列 ${i + 1}`, role: roles[i], x0: c.x0, x1: c.x1 }));
}

/**
 * セルを列に入れる。列の境目はとなりの列の間の真ん中。文字は左揃え（左端のある列）、数は右揃え（右端のある列）で決める
 * （長い名称が規格の列まではみ出しても名称の列に入る）。
 */
function assignCells(row: RawRow, columns: PdfColumn[]): string[] {
  const out = columns.map(() => '');
  const bounds = columns.map((c, i) => {
    const lo = i === 0 ? Number.NEGATIVE_INFINITY : (columns[i - 1].x1 + c.x0) / 2;
    const hi = i === columns.length - 1 ? Number.POSITIVE_INFINITY : (c.x1 + columns[i + 1].x0) / 2;
    return [lo, hi] as const;
  });
  for (const cell of row.cells) {
    const pos = isNumeric(cell.text) ? cell.x1 : cell.x0;
    let idx = bounds.findIndex(([lo, hi]) => pos >= lo && pos <= hi);
    if (idx < 0) idx = 0;
    out[idx] = out[idx] ? `${out[idx]} ${cell.text}` : cell.text;
  }
  return out;
}

/** ページごとのテキスト項目から表（列と行）を作る。見出しの行（各ページの繰り返しも）は行に入れない。 */
export function extractTable(pages: PdfTextItem[][]): PdfTable {
  const raw: RawRow[] = pages.flatMap((items, i) => pageRows(items, i + 1));
  let header: HeaderCell[] | null = null;
  const headerRows = new Set<RawRow>();
  for (const r of raw) {
    const hc = headerCells(r);
    if (hc) {
      if (!header) header = hc;
      headerRows.add(r);
    }
  }
  const body = raw.filter((r) => !headerRows.has(r));
  const columns = header ? columnsFromHeader(header) : columnsFromLayout(body);
  // 見出しの行より上（宛名・件名など）は表の外：見出しのあるページは見出しより上の行を除く
  const headerTop = new Map<number, number>();
  for (const r of headerRows) if (!headerTop.has(r.page)) headerTop.set(r.page, r.y);
  const rows = body
    .filter((r) => {
      const top = headerTop.get(r.page);
      return top === undefined || r.y > top;
    })
    .map((r) => ({ cells: assignCells(r, columns), page: r.page, y: r.y, height: r.height }));
  return { columns, rows, headerFound: header !== null };
}

// ─── 候補 ───

const TOTAL_RE = /(総合計|合計|総計|税込|消費税)/;
const SUBTOTAL_RE = /(小計|中計)/;
const BRACKET_RE = /^[【［\[〔＜<《≪(（].*[】］\]〕＞>》≫)）]$/;
const CHANGE_RE = /(変更|増減|追加変更)/;
const INITIAL_RE = /(当初|本契約)/;
const EXPENSE_RE = /(諸経費|経費|現場管理費|一般管理費|法定福利費|共通仮設費)/;
const REDUCTION_RE = /(減工|減額|減分|値引|出精)/;

function roundDecimals(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function num(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const n = parseAmount(cell);
  return n === null || Number.isNaN(n) ? null : n;
}

function readGuess(cells: string[], roles: ColumnRole[]): CandidateGuess {
  const pick = (role: ColumnRole) =>
    roles
      .map((r, i) => (r === role ? cells[i] ?? '' : ''))
      .filter((s) => s !== '')
      .join(' ');
  let qty = num(pick('qty'));
  let unit = pick('unit');
  if (qty === null) {
    const split = splitQtyUnit(pick('qty'));
    if (split) {
      qty = split.qty;
      if (unit === '') unit = split.unit;
    }
  }
  return {
    name: pick('name'),
    spec: pick('spec'),
    qty,
    unit,
    unitPrice: num(pick('unitPrice')),
    amount: num(pick('amount')),
  };
}

/** 抜けている数を埋める（1 式の金額だけ、数量と金額だけ、など）。 */
function completeGuess(g: CandidateGuess): CandidateGuess {
  let { qty, unit, unitPrice } = g;
  const { amount } = g;
  if (amount !== null) {
    if (qty === null && unitPrice === null) {
      qty = 1;
      unitPrice = amount;
      if (unit === '') unit = '式';
    } else if (unitPrice === null && qty !== null && qty !== 0) {
      unitPrice = roundDecimals(amount / qty);
    } else if (qty === null && unitPrice !== null && unitPrice !== 0) {
      qty = roundDecimals(amount / unitPrice);
    }
    // 金額だけ「△」が付いている（単価・数量は正）なら、単価を負にする
    if (amount < 0 && qty !== null && unitPrice !== null && qty > 0 && unitPrice > 0) unitPrice = -unitPrice;
  }
  return { ...g, qty, unit, unitPrice };
}

function kindOf(cells: string[], g: CandidateGuess): CandidateKind {
  if (cells.every((c) => c.trim() === '')) return 'blank';
  const text = squash(cells.filter((c) => !isNumeric(c)).join(''));
  if (TOTAL_RE.test(text)) return 'total';
  if (SUBTOTAL_RE.test(text) || /^(計|.*[】）)\]]計)$/.test(text) || /(^|\s)計$/.test(g.name.trim())) return 'subtotal';
  const hasNumbers = g.qty !== null || g.unitPrice !== null || g.amount !== null;
  if (!hasNumbers) return 'heading';
  if (BRACKET_RE.test(text) && g.amount === null) return 'heading';
  return 'item';
}

function categoryOf(g: CandidateGuess): ContractCategory {
  const text = squash(`${g.name}${g.spec}`);
  if (REDUCTION_RE.test(text)) return 'reduction';
  if (EXPENSE_RE.test(text)) return 'expense';
  if (g.amount !== null && g.amount < 0 && /^(式|一式)?$/.test(squash(g.unit))) return 'reduction';
  return 'trade';
}

/**
 * 表と列の割り当てから、取り込みの候補の行を作る。
 * - 見出し（【…】・＜…＞・数の無い行）・小計・合計・空の行は include=false（画面には出す）。
 * - 「変更」「増減」を含む見出しの後の行は区分「変更」、「当初」を含む見出しで「当初」に戻す。
 * - 名称の列が空で規格の列だけに文字のある数の無い行は、直前の明細の規格の続きとしてつなぐ。
 * - 数の行の名称が空で、直前が数の無い文字だけの行（括弧の見出し・区分の見出しでない）なら、その行を名称にする（2 行に分かれた明細）。
 */
export function buildCandidates(table: Pick<PdfTable, 'rows'>, roles: ColumnRole[]): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  let section: ContractSection = 'initial';
  let heading: string | null = null;
  let headingBefore: string | null = null;
  const nameIdx = roles.indexOf('name');
  const specIdx = roles.indexOf('spec');
  let prevRow: PdfTableRow | null = null;

  for (const row of table.rows) {
    const guess = readGuess(row.cells, roles);
    let kind = kindOf(row.cells, guess);
    const last = out[out.length - 1];
    const close = prevRow !== null && prevRow.page === row.page && row.y - prevRow.y <= Math.max(row.height, prevRow.height) * 1.8;

    if (kind === 'heading' && last?.kind === 'item' && close && nameIdx >= 0 && specIdx >= 0) {
      const onlySpec = row.cells.every((c, i) => c === '' || i === specIdx || roles[i] === 'ignore') && row.cells[specIdx] !== '';
      if (onlySpec) {
        last.guess.spec = last.guess.spec ? `${last.guess.spec} ${row.cells[specIdx]}` : row.cells[specIdx];
        last.cells = last.cells.map((c, i) => (i === specIdx ? `${c} ${row.cells[specIdx]}`.trim() : c));
        last.category = categoryOf(last.guess);
        prevRow = row;
        continue;
      }
    }

    if (kind === 'item' && guess.name === '' && last?.kind === 'heading' && close) {
      const t = squash(last.cells.join(''));
      if (!BRACKET_RE.test(t) && !CHANGE_RE.test(t) && !INITIAL_RE.test(t)) {
        // 直前の行を名称にして、その行を候補から外す
        out.pop();
        guess.name = last.guess.name || last.cells.filter((c) => c !== '').join(' ');
        if (guess.spec === '' && last.guess.spec !== '') guess.spec = last.guess.spec;
        heading = headingBefore;
        kind = kindOf([...row.cells, guess.name], guess);
      }
    }

    if (kind === 'heading') {
      const t = squash(row.cells.join(''));
      if (CHANGE_RE.test(t)) section = 'change';
      else if (INITIAL_RE.test(t)) section = 'initial';
      headingBefore = heading;
      heading = row.cells.filter((c) => c !== '').join(' ');
    }

    const g = kind === 'item' ? completeGuess(guess) : guess;
    const amountMismatch =
      kind === 'item' && g.amount !== null && g.qty !== null && g.unitPrice !== null && lineAmount(g.qty, g.unitPrice) !== g.amount;
    out.push({
      cells: row.cells,
      page: row.page,
      kind,
      include: kind === 'item',
      section,
      heading: kind === 'heading' ? null : heading,
      guess: g,
      category: kind === 'item' ? categoryOf(g) : 'trade',
      amountMismatch,
    });
    prevRow = row;
  }
  return out;
}

/** extractTable と buildCandidates をまとめて行う（推定の列の割り当てで）。 */
export function parsePdfTable(pages: PdfTextItem[][]): { table: PdfTable; candidates: PdfCandidate[] } {
  const table = extractTable(pages);
  return { table, candidates: buildCandidates(table, table.columns.map((c) => c.role)) };
}

/** テキスト項目が 1 つも無い（画像だけの PDF）か。 */
export function hasNoText(pages: PdfTextItem[][]): boolean {
  return pages.every((p) => p.every((i) => i.str.trim() === ''));
}
