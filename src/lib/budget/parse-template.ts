import * as XLSX from 'xlsx';
import { TRADE_NAME_MAX, budgetComboError } from '@/lib/budget/schemas';
import {
  CHOICE_LAST_ROW,
  EXPENSE_LABEL,
  FIRST_DATA_ROW,
  NO_PERFORMER_LABEL,
  OWN_LABEL,
  REDUCTION_LABEL,
  SHEET_BUDGET,
  SHEET_CHOICES,
  SHEET_CONTRACT,
  SITE_WIDE_LABEL,
  normalizeName,
} from '@/lib/budget/template-format';
import {
  BUDGET_ITEMS,
  BUDGET_ITEM_LABEL,
  CONTRACT_SECTIONS,
  CONTRACT_SECTION_LABEL,
  SITE_WIDE_ITEMS,
  type BudgetItem,
  type BudgetPerformer,
  type ContractCategory,
  type ContractSection,
} from '@/lib/budget/types';

// 実行予算・元請けの内訳の Excel 雛形の取り込み（template-xlsx.ts の形。parse-sheet.ts と同じく SheetJS で読み、
// 列は見出しの文字で決める）。金額の列は読まない（アプリが数量 × 単価で計算し直す）。
// 読めない行は errors（シート名と Excel の行番号つき）に入れ、その行は結果に入れない。

export interface ParsedBudgetLine {
  /** Excel の行番号（1 始まり）。 */
  row: number;
  /** 工種の名前（null＝現場全体）。 */
  tradeName: string | null;
  performer: BudgetPerformer;
  supplierId: string | null;
  supplierName: string | null;
  item: BudgetItem;
  note: string;
  qty: number;
  unit: string;
  unitPrice: number;
}

export interface ParsedContractItem {
  row: number;
  section: ContractSection;
  name: string;
  spec: string;
  qty: number;
  unit: string;
  unitPrice: number;
  category: ContractCategory;
  /** 識別が工種のときの工種の名前（null＝まだ識別していない）。 */
  tradeName: string | null;
}

export interface ParseError {
  sheet: string;
  row: number;
  message: string;
}

export interface ParsedBudgetWorkbook {
  /** 工種の名前（選択肢のシートの順、続いて予算・内訳にだけ出てくる名前を出てきた順）。 */
  trades: string[];
  budgetLines: ParsedBudgetLine[];
  contractItems: ParsedContractItem[];
  errors: ParseError[];
  /** 実行予算・元請けの内訳のシートがあったか（無いシートは取り込みで変えない）。 */
  hasBudgetSheet: boolean;
  hasContractSheet: boolean;
}

export interface ParseOptions {
  /** 協力会社の印のある会社（施工者の名前の突き合わせ）。 */
  partners: { id: string; name: string }[];
  /** 自社の労務の単価が空欄のときに入れる単価（現場の設定。無ければ null＝空欄は誤り）。 */
  dailyRate: number | null;
}

type Grid = unknown[][];

function sheetGrid(wb: XLSX.WorkBook, name: string): Grid | null {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const ref = ws['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : undefined;
  if (range) range.s = { r: 0, c: 0 };
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, range });
}

function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** 数（文字の「1,200」「￥1,200」「1,200円」も）。空欄は null、読めなければ NaN。 */
function number(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN;
  const s = String(v).normalize('NFKC').replace(/[,\s¥￥円]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const HEADER_ALIASES: Record<string, string[]> = {
  trade: ['工種'],
  performer: ['施工者'],
  item: ['項目'],
  note: ['内容・メモ', '内容', 'メモ'],
  section: ['区分'],
  name: ['名称', '品名', '名称・仕様'],
  spec: ['規格・仕様', '規格', '仕様', '摘要'],
  qty: ['数量'],
  unit: ['単位'],
  unitPrice: ['単価'],
  amount: ['金額'],
  tag: ['工種（識別）', '識別'],
};

/** 先頭 20 行から、required の見出しが全部ある行を探して列の位置を返す。 */
function findColumns(grid: Grid, fields: string[], required: string[]): { headerRow: number; cols: Record<string, number> } | null {
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = (grid[r] ?? []).map(normalizeName);
    const cols: Record<string, number> = {};
    for (const f of fields) {
      const aliases = HEADER_ALIASES[f].map(normalizeName);
      // 「工種（識別）」と「工種」を取り違えないよう、候補の順に完全一致で探す
      for (const a of aliases) {
        const i = row.indexOf(a);
        if (i >= 0 && !Object.values(cols).includes(i)) {
          cols[f] = i;
          break;
        }
      }
    }
    if (required.every((f) => cols[f] !== undefined)) return { headerRow: r, cols };
  }
  return null;
}

function cell(grid: Grid, r: number, col: number | undefined): unknown {
  if (col === undefined) return null;
  return grid[r]?.[col] ?? null;
}

const ITEM_BY_LABEL = new Map<string, BudgetItem>(BUDGET_ITEMS.map((i) => [normalizeName(BUDGET_ITEM_LABEL[i]), i]));
const SECTION_BY_LABEL = new Map<string, ContractSection>(CONTRACT_SECTIONS.map((s) => [normalizeName(CONTRACT_SECTION_LABEL[s]), s]));
const SITE_WIDE_NAMES = new Set([normalizeName(SITE_WIDE_LABEL), normalizeName('現場全体')]);
const NO_PERFORMER_NAMES = new Set([normalizeName(NO_PERFORMER_LABEL), '-', 'ー', '―', '‐']);

function tradeTooLong(name: string): string | null {
  return name.length > TRADE_NAME_MAX ? `工種の名前は${TRADE_NAME_MAX}文字以内にしてください（「${name.slice(0, 20)}…」）` : null;
}

function lengthError(label: string, v: string, max: number): string | null {
  return v.length > max ? `${label}は${max}文字以内にしてください` : null;
}

/** 選択肢のシートの A 列（3 行目から）の工種。 */
function choiceTrades(grid: Grid | null, errors: ParseError[]): string[] {
  if (!grid) return [];
  const out: string[] = [];
  for (let r = 2; r < Math.min(grid.length, CHOICE_LAST_ROW); r++) {
    const name = text(grid[r]?.[0]);
    if (name === '' || SITE_WIDE_NAMES.has(normalizeName(name))) continue;
    const tooLong = tradeTooLong(name);
    if (tooLong) {
      errors.push({ sheet: SHEET_CHOICES, row: r + 1, message: tooLong });
      continue;
    }
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function parseBudgetSheet(grid: Grid, opts: ParseOptions, errors: ParseError[]): ParsedBudgetLine[] {
  const sheet = SHEET_BUDGET;
  const found = findColumns(grid, ['trade', 'performer', 'item', 'note', 'qty', 'unit', 'unitPrice'], ['trade', 'performer', 'item', 'qty', 'unitPrice']);
  if (!found) {
    errors.push({ sheet, row: 0, message: '見出し（工種・施工者・項目・数量・単価）が見つかりません。アプリから書き出した雛形を使ってください' });
    return [];
  }
  const { headerRow, cols } = found;
  const partners = new Map<string, { id: string; name: string }>();
  for (const p of opts.partners) {
    const key = normalizeName(p.name);
    if (!partners.has(key)) partners.set(key, p);
  }
  const out: ParsedBudgetLine[] = [];
  for (let r = Math.max(headerRow + 1, FIRST_DATA_ROW - 1); r < grid.length; r++) {
    const row = r + 1;
    const tradeRaw = text(cell(grid, r, cols.trade));
    const perfRaw = text(cell(grid, r, cols.performer));
    const itemRaw = text(cell(grid, r, cols.item));
    const note = text(cell(grid, r, cols.note));
    const qtyRaw = cell(grid, r, cols.qty);
    const unit = text(cell(grid, r, cols.unit));
    const priceRaw = cell(grid, r, cols.unitPrice);
    if (!tradeRaw && !perfRaw && !itemRaw && !note && number(qtyRaw) === null && !unit && number(priceRaw) === null) continue;
    const fail = (message: string) => errors.push({ sheet, row, message });

    const item = ITEM_BY_LABEL.get(normalizeName(itemRaw));
    if (!item) {
      fail(itemRaw ? `項目「${itemRaw}」は労務・請負・常用・材料・リース・その他から選んでください` : '項目を選んでください');
      continue;
    }
    const tradeName = tradeRaw === '' || SITE_WIDE_NAMES.has(normalizeName(tradeRaw)) ? null : tradeRaw;
    if (tradeName !== null) {
      const tooLong = tradeTooLong(tradeName);
      if (tooLong) {
        fail(tooLong);
        continue;
      }
    }
    if (tradeName === null && !SITE_WIDE_ITEMS.includes(item)) {
      fail(`${BUDGET_ITEM_LABEL[item]}の行は工種を選んでください`);
      continue;
    }

    let performer: BudgetPerformer = 'own';
    let supplier: { id: string; name: string } | null = null;
    const perfKey = normalizeName(perfRaw);
    if (perfKey === '' || perfKey === normalizeName(OWN_LABEL) || NO_PERFORMER_NAMES.has(perfKey)) {
      performer = 'own';
    } else {
      supplier = partners.get(perfKey) ?? null;
      if (!supplier) {
        fail(`施工者「${perfRaw}」はマスターの協力会社にありません（協力会社の印のある会社と同じ名前にしてください）`);
        continue;
      }
      performer = 'partner';
    }
    const combo = budgetComboError({ item, performer, supplierId: supplier?.id ?? null, tradeId: tradeName === null ? null : 'trade' });
    if (combo) {
      fail(combo);
      continue;
    }

    const qty = number(qtyRaw);
    if (qty === null) {
      fail('数量を入力してください');
      continue;
    }
    if (Number.isNaN(qty) || qty < 0) {
      fail('数量は0以上の数値で入力してください');
      continue;
    }
    let unitPrice = number(priceRaw);
    if (unitPrice === null && item === 'labor' && opts.dailyRate !== null) unitPrice = opts.dailyRate;
    if (unitPrice === null) {
      fail('単価を入力してください');
      continue;
    }
    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      fail('単価は0以上の数値で入力してください');
      continue;
    }
    const len = lengthError('内容・メモ', note, 200) ?? lengthError('単位', unit, 20);
    if (len) {
      fail(len);
      continue;
    }
    out.push({
      row,
      tradeName,
      performer,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? null,
      item,
      note,
      qty,
      unit,
      unitPrice,
    });
  }
  return out;
}

function parseContractSheet(grid: Grid, errors: ParseError[]): ParsedContractItem[] {
  const sheet = SHEET_CONTRACT;
  const found = findColumns(grid, ['tag', 'section', 'name', 'spec', 'qty', 'unit', 'unitPrice', 'amount'], ['name', 'qty']);
  if (!found) {
    errors.push({ sheet, row: 0, message: '見出し（名称・数量）が見つかりません。アプリから書き出した雛形を使ってください' });
    return [];
  }
  const { headerRow, cols } = found;
  const out: ParsedContractItem[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = r + 1;
    const sectionRaw = text(cell(grid, r, cols.section));
    const name = text(cell(grid, r, cols.name));
    const spec = text(cell(grid, r, cols.spec));
    let qty = number(cell(grid, r, cols.qty));
    const unit = text(cell(grid, r, cols.unit));
    let unitPrice = number(cell(grid, r, cols.unitPrice));
    const amount = number(cell(grid, r, cols.amount));
    const tag = text(cell(grid, r, cols.tag));
    // 金額の式だけの空の行は飛ばす
    if (!sectionRaw && !name && !spec && qty === null && !unit && unitPrice === null && !tag) continue;
    const fail = (message: string) => errors.push({ sheet, row, message });

    let section: ContractSection = 'initial';
    if (sectionRaw) {
      const s = SECTION_BY_LABEL.get(normalizeName(sectionRaw));
      if (!s) {
        fail(`区分「${sectionRaw}」は当初か変更にしてください`);
        continue;
      }
      section = s;
    }
    if (!name) {
      fail('名称を入力してください');
      continue;
    }
    // 単価が空で金額だけある「一式」の行は、数量 1・単価＝金額として読む
    if (unitPrice === null && amount !== null && !Number.isNaN(amount) && (qty === null || qty === 1)) {
      qty = 1;
      unitPrice = amount;
    }
    if (qty === null || Number.isNaN(qty)) {
      fail(qty === null ? '数量を入力してください' : '数量は数値で入力してください');
      continue;
    }
    if (unitPrice === null || Number.isNaN(unitPrice)) {
      fail(unitPrice === null ? '単価を入力してください' : '単価は数値で入力してください');
      continue;
    }
    const len = lengthError('名称', name, 200) ?? lengthError('規格・仕様', spec, 200) ?? lengthError('単位', unit, 20);
    if (len) {
      fail(len);
      continue;
    }
    let category: ContractCategory = 'trade';
    let tradeName: string | null = null;
    const tagKey = normalizeName(tag);
    if (tagKey === normalizeName(EXPENSE_LABEL)) category = 'expense';
    else if (tagKey === normalizeName(REDUCTION_LABEL)) category = 'reduction';
    else if (tag !== '') {
      const tooLong = tradeTooLong(tag);
      if (tooLong) {
        fail(tooLong);
        continue;
      }
      tradeName = tag;
    }
    out.push({ row, section, name, spec, qty, unit, unitPrice, category, tradeName });
  }
  return out;
}

/**
 * 実行予算・元請けの内訳の雛形を読む。工種は選択肢のシートの A 列（3 行目から）の順、続いて予算・内訳にだけ
 * 出てくる名前（出てきた順）。シートが 1 つも無ければ errors に入れる。
 */
export function parseBudgetWorkbook(buf: ArrayBuffer | Uint8Array, opts: ParseOptions): ParsedBudgetWorkbook {
  const wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellHTML: false, sheets: [SHEET_BUDGET, SHEET_CONTRACT, SHEET_CHOICES] });
  const errors: ParseError[] = [];
  const budgetGrid = sheetGrid(wb, SHEET_BUDGET);
  const contractGrid = sheetGrid(wb, SHEET_CONTRACT);
  if (!budgetGrid && !contractGrid) {
    errors.push({ sheet: SHEET_BUDGET, row: 0, message: `シート「${SHEET_BUDGET}」「${SHEET_CONTRACT}」が見つかりません。アプリから書き出した雛形を使ってください` });
  }
  const trades = choiceTrades(sheetGrid(wb, SHEET_CHOICES), errors);
  const budgetLines = budgetGrid ? parseBudgetSheet(budgetGrid, opts, errors) : [];
  const contractItems = contractGrid ? parseContractSheet(contractGrid, errors) : [];
  for (const name of [...budgetLines.map((l) => l.tradeName), ...contractItems.map((i) => i.tradeName)]) {
    if (name !== null && !trades.includes(name)) trades.push(name);
  }
  return { trades, budgetLines, contractItems, errors, hasBudgetSheet: budgetGrid !== null, hasContractSheet: contractGrid !== null };
}
