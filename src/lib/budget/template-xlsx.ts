import ExcelJS from 'exceljs';
import {
  BUDGET_HEADERS,
  CHOICE_HEADERS,
  CHOICE_LAST_ROW,
  CONTRACT_HEADERS,
  EXPENSE_LABEL,
  FIRST_DATA_ROW,
  HEADER_ROW,
  ITEM_LABELS,
  NO_PERFORMER_LABEL,
  OWN_LABEL,
  REDUCTION_LABEL,
  SECTION_LABELS,
  SHEET_BUDGET,
  SHEET_CHOICES,
  SHEET_CONTRACT,
  SITE_WIDE_LABEL,
} from '@/lib/budget/template-format';
import {
  BUDGET_ITEM_LABEL,
  CONTRACT_SECTION_LABEL,
  SITE_WIDE_ITEMS,
  type BudgetData,
  type ContractItem,
} from '@/lib/budget/types';

// 実行予算・受注の内訳の Excel 雛形（取り込み用と同じ形の書き出し）。シート「実行予算」「受注の内訳」「選択肢」。
// 工種・施工者・項目・区分・識別はプルダウン（選択肢のシートを指す。新しい工種の名前も打てるよう警告だけ）。
// 黄色＝入力、青＝自動計算（金額＝ROUND(数量 × 単価)。取り込みでは読まず、アプリが計算し直す）。見本の行は入れない。

export interface BudgetTemplateSite {
  name: string;
  /** 工事番号（無ければ null）。 */
  code: string | null;
  /** 自社の労務の単価の初期値（全社の設定「予算の標準日当」。無ければ null）。 */
  dailyRate: number | null;
}

/** 施工者のプルダウンに出す協力会社（協力会社の印のある会社）。 */
export interface TemplatePartner {
  id: string;
  name: string;
}

const INPUT = 'FFFFFBEA';
const CALC = 'FFEEF2FF';
const HEAD = 'FFE5E7EB';
const SECTION = 'FFDBEAFE';
const RULE = 'FFD1D5DB';
/** 書いた行の下に、プルダウンと金額の式を入れておく空の行の数。 */
const SPARE_ROWS = 300;

const thin = { style: 'thin', color: { argb: RULE } } as const;
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

type Validations = { add(address: string, validation: ExcelJS.DataValidation): void };
/** exceljs の型に無い ws.dataValidations（範囲でまとめて入れる）。 */
function validations(ws: ExcelJS.Worksheet): Validations {
  return (ws as unknown as { dataValidations: Validations }).dataValidations;
}

function listValidation(range: string, prompt: string): ExcelJS.DataValidation {
  return {
    type: 'list',
    allowBlank: true,
    formulae: [range],
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: '一覧にない値です',
    error: `${prompt}は一覧から選んでください（このまま入れることもできます）`,
  };
}

const yen = (v: number) => v.toLocaleString('ja-JP');

function siteBanner(site: BudgetTemplateSite, title: string): string {
  const code = site.code ? `（工事番号 ${site.code}）` : '';
  return `${title}　現場：${site.name}${code}`;
}

function writeHeader(ws: ExcelJS.Worksheet, banner: string, headers: readonly string[], widths: number[]): void {
  ws.getCell(1, 1).value = banner;
  ws.mergeCells(1, 1, 1, headers.length);
  const b = ws.getCell(1, 1);
  b.font = { bold: true };
  b.fill = fill(SECTION);
  b.alignment = { vertical: 'middle', wrapText: true };
  ws.getRow(1).height = 32;
  const head = ws.getRow(HEADER_ROW);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = fill(HEAD);
    c.border = box;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }];
}

/** 入力の行（書いた行と空の行）に色・罫線・書式・金額の式を入れる。qtyCol・priceCol・amountCol は列番号（1 始まり）。 */
function styleRows(
  ws: ExcelJS.Worksheet,
  lastRow: number,
  cols: number,
  numeric: { qty: number; price: number; amount: number },
  amounts: Map<number, number>,
): void {
  const q = ws.getColumn(numeric.qty).letter;
  const p = ws.getColumn(numeric.price).letter;
  for (let r = FIRST_DATA_ROW; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.border = box;
      cell.fill = fill(c === numeric.amount ? CALC : INPUT);
      if (c === numeric.qty) cell.numFmt = '#,##0.##';
      if (c === numeric.price || c === numeric.amount) cell.numFmt = '#,##0';
    }
    const amount = row.getCell(numeric.amount);
    const result = amounts.get(r);
    amount.value = {
      formula: `IF(OR(${q}${r}="",${p}${r}=""),"",ROUND(${q}${r}*${p}${r},0))`,
      ...(result !== undefined ? { result } : {}),
    } as ExcelJS.CellFormulaValue;
  }
}

function tradeName(names: Map<string, string>, tradeId: string | null): string {
  if (tradeId === null) return '';
  return names.get(tradeId) ?? '';
}

function contractTag(item: ContractItem, names: Map<string, string>): string {
  if (item.category === 'expense') return EXPENSE_LABEL;
  if (item.category === 'reduction') return REDUCTION_LABEL;
  return tradeName(names, item.tradeId);
}

/**
 * 実行予算・受注の内訳の雛形を作る。data の工種・予算の行・内訳の行をそのまま書く（空の雛形は行の無い data を渡す）。
 * partners は施工者のプルダウンと、予算の行の会社の名前に使う（協力会社の印のある会社を全部渡す）。
 */
export async function buildBudgetWorkbook(
  data: Pick<BudgetData, 'trades' | 'budgetLines' | 'contractItems'>,
  site: BudgetTemplateSite,
  partners: TemplatePartner[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報';
  wb.created = new Date();
  addBudgetTemplateSheets(wb, data, site, partners, { contract: true, hideChoices: false });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/**
 * 雛形のシート（実行予算・［受注の内訳］・選択肢）を wb の後ろに足す。取り込み（parse-template.ts）はシート名で読むので、
 * ここで足したシートはそのまま取り込める。
 * - contract：受注の内訳のシートも足す（予算と実績の集計 Excel の ⑦ は false。実行予算だけを取り込み直せるように）。
 * - hideChoices：選択肢のシートを隠す（集計 Excel では補助のシート。プルダウンと工種の並びのために置く）。
 */
export function addBudgetTemplateSheets(
  wb: ExcelJS.Workbook,
  data: Pick<BudgetData, 'trades' | 'budgetLines'> & Partial<Pick<BudgetData, 'contractItems'>>,
  site: BudgetTemplateSite,
  partners: TemplatePartner[],
  opts: { contract: boolean; hideChoices: boolean },
): void {
  const trades = [...data.trades].sort((a, b) => a.sortOrder - b.sortOrder);
  const tradeNames = new Map(trades.map((t) => [t.id, t.name]));
  const supplierNames = new Map(partners.map((p) => [p.id, p.name]));

  // ─── 実行予算 ───
  const wsB = wb.addWorksheet(SHEET_BUDGET, { properties: { tabColor: { argb: 'FF1D4ED8' } } });
  const rate = site.dailyRate !== null ? `　予算の標準日当 ${yen(site.dailyRate)} 円（自社の労務の単価が空欄なら、この金額で取り込みます）` : '';
  writeHeader(wsB, `${siteBanner(site, '実行予算')}${rate}`, BUDGET_HEADERS, [16, 18, 10, 28, 10, 8, 12, 14]);
  const lines = [...data.budgetLines].sort((a, b) => a.sortOrder - b.sortOrder);
  const budgetAmounts = new Map<number, number>();
  lines.forEach((l, i) => {
    const r = FIRST_DATA_ROW + i;
    const performer =
      l.performer === 'partner'
        ? l.supplierId
          ? (supplierNames.get(l.supplierId) ?? '')
          : ''
        : SITE_WIDE_ITEMS.includes(l.item)
          ? NO_PERFORMER_LABEL
          : OWN_LABEL;
    const row = wsB.getRow(r);
    // 工種なしの労務・請負・常用（予算外の予算）は工種を空欄にする（「（現場全体）」は材料・リース・その他だけ）
    row.getCell(1).value =
      l.tradeId !== null ? tradeName(tradeNames, l.tradeId) : SITE_WIDE_ITEMS.includes(l.item) ? SITE_WIDE_LABEL : null;
    row.getCell(2).value = performer;
    row.getCell(3).value = BUDGET_ITEM_LABEL[l.item];
    row.getCell(4).value = l.note;
    row.getCell(5).value = l.qty;
    row.getCell(6).value = l.unit;
    row.getCell(7).value = l.unitPrice;
    budgetAmounts.set(r, l.amount);
  });
  const lastB = FIRST_DATA_ROW + lines.length + SPARE_ROWS - 1;
  styleRows(wsB, lastB, BUDGET_HEADERS.length, { qty: 5, price: 7, amount: 8 }, budgetAmounts);

  // ─── 受注の内訳 ───
  const contract = opts.contract ? writeContractSheet(wb, data.contractItems ?? [], site, tradeNames) : null;

  // ─── 選択肢 ───
  const performerCount = writeChoices(wb, trades, partners, opts.hideChoices);

  const q = `'${SHEET_CHOICES}'`;
  const perfLast = 1 + Math.max(performerCount, 1);
  validations(wsB).add(`A${FIRST_DATA_ROW}:A${lastB}`, listValidation(`${q}!$A$2:$A$${CHOICE_LAST_ROW}`, '工種'));
  validations(wsB).add(`B${FIRST_DATA_ROW}:B${lastB}`, listValidation(`${q}!$B$2:$B$${perfLast}`, '施工者'));
  validations(wsB).add(`C${FIRST_DATA_ROW}:C${lastB}`, listValidation(`${q}!$C$2:$C$${1 + ITEM_LABELS.length}`, '項目'));
  if (contract) {
    const { ws: wsC, lastRow: lastC } = contract;
    validations(wsC).add(`A${FIRST_DATA_ROW}:A${lastC}`, listValidation(`${q}!$D$2:$D$${1 + SECTION_LABELS.length}`, '区分'));
    validations(wsC).add(`H${FIRST_DATA_ROW}:H${lastC}`, listValidation(`${q}!$E$2:$E$${CHOICE_LAST_ROW + 1}`, '工種（識別）'));
  }

  for (const ws of contract ? [wsB, contract.ws] : [wsB]) {
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
}

function writeContractSheet(
  wb: ExcelJS.Workbook,
  contractItems: ContractItem[],
  site: BudgetTemplateSite,
  tradeNames: Map<string, string>,
): { ws: ExcelJS.Worksheet; lastRow: number } {
  const wsC = wb.addWorksheet(SHEET_CONTRACT, { properties: { tabColor: { argb: 'FF047857' } } });
  writeHeader(wsC, `${siteBanner(site, '受注の内訳')}　経費・減分は工種に入れず、内訳の金額の合計にだけ数えます`, CONTRACT_HEADERS, [8, 36, 18, 10, 8, 12, 14, 16]);
  const items = [...contractItems].sort((a, b) => a.sortOrder - b.sortOrder);
  const contractAmounts = new Map<number, number>();
  items.forEach((it, i) => {
    const r = FIRST_DATA_ROW + i;
    const row = wsC.getRow(r);
    row.getCell(1).value = CONTRACT_SECTION_LABEL[it.section];
    row.getCell(2).value = it.name;
    row.getCell(3).value = it.spec;
    row.getCell(4).value = it.qty;
    row.getCell(5).value = it.unit;
    row.getCell(6).value = it.unitPrice;
    row.getCell(8).value = contractTag(it, tradeNames);
    contractAmounts.set(r, it.amount);
  });
  const lastC = FIRST_DATA_ROW + items.length + SPARE_ROWS - 1;
  styleRows(wsC, lastC, CONTRACT_HEADERS.length, { qty: 4, price: 6, amount: 7 }, contractAmounts);
  return { ws: wsC, lastRow: lastC };
}

/** 選択肢のシートを足す。施工者の欄の数（自社・—・協力会社）を返す。 */
function writeChoices(wb: ExcelJS.Workbook, trades: BudgetData['trades'], partners: TemplatePartner[], hidden: boolean): number {
  const wsO = wb.addWorksheet(SHEET_CHOICES, {
    properties: { tabColor: { argb: 'FF6B7280' } },
    ...(hidden ? { state: 'hidden' as const } : {}),
  });
  CHOICE_HEADERS.forEach((h, i) => {
    const c = wsO.getCell(1, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = fill(HEAD);
    c.border = box;
  });
  [20, 22, 10, 8, 20].forEach((w, i) => (wsO.getColumn(i + 1).width = w));
  // A：2 行目＝（現場全体）、3 行目から工種（ここに書いた名前が工種になる。足す・並べ替えもここで）
  wsO.getCell(2, 1).value = SITE_WIDE_LABEL;
  wsO.getCell(2, 1).font = { color: { argb: 'FF6B7280' } };
  for (let r = 3; r <= CHOICE_LAST_ROW; r++) wsO.getCell(r, 1).fill = fill(INPUT);
  trades.forEach((t, i) => (wsO.getCell(3 + i, 1).value = t.name));
  // B：施工者（自社・—・協力会社）
  const performers = [OWN_LABEL, NO_PERFORMER_LABEL, ...partners.map((p) => p.name)];
  performers.forEach((name, i) => (wsO.getCell(2 + i, 2).value = name));
  ITEM_LABELS.forEach((name, i) => (wsO.getCell(2 + i, 3).value = name));
  SECTION_LABELS.forEach((name, i) => (wsO.getCell(2 + i, 4).value = name));
  // E：識別（経費・減分と、A 列の工種を式で写す）
  wsO.getCell(2, 5).value = EXPENSE_LABEL;
  wsO.getCell(3, 5).value = REDUCTION_LABEL;
  for (let r = 3; r <= CHOICE_LAST_ROW; r++) {
    const name = trades[r - 3]?.name;
    wsO.getCell(r + 1, 5).value = {
      formula: `IF(A${r}="","",A${r})`,
      result: name ?? '',
    } as ExcelJS.CellFormulaValue;
  }
  wsO.getCell(1, 7).value =
    'A 列の 3 行目から下が工種です（ここで足す・並べ替えると、取り込みでその順になります）。名前を変えるとアプリでは別の工種として足されます（名前の変更はアプリの画面で）。';
  wsO.getCell(1, 7).alignment = { wrapText: true, vertical: 'top' };
  wsO.getColumn(7).width = 50;
  return performers.length;
}
