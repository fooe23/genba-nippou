import ExcelJS from 'exceljs';
import { buildBudgetModel, type BudgetModel, type BudgetModelInput, type TradeDay } from '@/lib/budget/budget-model';
import {
  budgetPerformerTable,
  budgetReportHeader,
  budgetSiteWideTable,
  budgetSummaryTable,
  BUDGET_REPORT_TITLE,
  type BudgetReportMeta,
} from '@/lib/budget/report-sections';
import { contractItemsTable } from '@/lib/budget/setup-sections';
import { SHEET_BUDGET } from '@/lib/budget/template-format';
import { addBudgetTemplateSheets, type TemplatePartner } from '@/lib/budget/template-xlsx';
import { affiliationLabel } from '@/lib/calc/affiliation';
import { CHANGE_KIND_LABELS } from '@/lib/report/change-labels';
import { cell, cellNumber, col, slashDate, type Cell, type NumFmt, type SectionTable } from '@/lib/reports/cost-sections';
import { neutralizeFormula } from '@/lib/reports/csv';
import { fileNameStem } from '@/lib/export/payload';

// 予算と実績の集計 Excel（社内用・画面より細かい）。シートの順：
// ① 予算と実績 ② 工種×施工者 ③ 日々の実績 ④ 月別の推移 ⑤ 出面 ⑥ 元請けの内訳と数量 ⑦ 実行予算。
// ⑦ は取り込み用の雛形（template-xlsx.ts）と同じ形で、シート名も「実行予算」（このファイルをそのまま「Excel で入れる」に
// 渡すと実行予算だけを取り込み直せる。プルダウンと工種の並びのための「選択肢」のシートを隠して最後に置く）。
// ⑥ はシート名を「元請けの内訳」にしない（取り込みが内訳として読まないように）。
// 数式の注入対策：①〜⑥ の文字は先頭が = + - @ なら ' を付ける（CSV と同じ。neutralizeFormula）。⑦ は取り込み直すと
// 同じ中身になるよう文字をそのまま書く（exceljs は文字を文字のセルとして書くので数式にはならない）。

export const REPORT_SHEET_NAMES = [
  '予算と実績',
  '工種×施工者',
  '日々の実績',
  '月別の推移',
  '出面',
  '元請けの内訳と数量',
  SHEET_BUDGET,
] as const;

const NAVY = 'FF1F3A5F';
const RULE = 'FFC9D1DC';
const BAND = 'FFEEF2F7';
const TOTAL_BAND = 'FFF6F8FB';
const SUB_BAND = 'FFF3F6FA';

const thin = { style: 'thin', color: { argb: RULE } } as const;
const box: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const NUM_FMT: Record<NumFmt, string | undefined> = {
  yen: '#,##0',
  int: '#,##0',
  dec1: '0.0',
  qty: '#,##0.##',
  pct: '0.0%',
};

const { yen, qty, pct } = cell;

/** `現場名_予算と実績_YYYYMMDD.xlsx`。 */
export function budgetReportFileName(siteName: string, today: string, ext: 'xlsx' | 'pdf' = 'xlsx'): string {
  return `${fileNameStem(siteName)}_予算と実績_${today.replaceAll('-', '')}.${ext}`;
}

function writeCell(target: ExcelJS.Cell, c: Cell, numeric: boolean): void {
  if (c === null || (typeof c === 'object' && c.value === null)) {
    target.value = '—';
  } else if (typeof c === 'string') {
    target.value = neutralizeFormula(c);
  } else {
    target.value = cellNumber(c.value as number, c.fmt, false);
    const fmt = NUM_FMT[c.fmt];
    if (fmt) target.numFmt = fmt;
  }
  target.border = box;
  target.alignment = numeric ? { horizontal: 'right', vertical: 'middle' } : { vertical: 'middle', wrapText: true };
}

/** 表（列見出し・行・太字の行・合計行・合計行の下の行）を 1 列目から書く。 */
function writeTable(ws: ExcelJS.Worksheet, t: SectionTable): void {
  const head = ws.addRow(t.columns.map((c) => neutralizeFormula(c.label)));
  t.columns.forEach((c, i) => {
    const h = head.getCell(i + 1);
    h.font = { bold: true };
    h.fill = fill(BAND);
    h.border = box;
    h.alignment = { horizontal: c.num ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  const body = (cells: Cell[]) => {
    const row = ws.addRow([]);
    cells.forEach((c, i) => writeCell(row.getCell(i + 1), c, t.columns[i].num));
    return row;
  };
  t.rows.forEach((r, i) => {
    const row = body(r);
    if (t.boldRows?.includes(i)) {
      row.eachCell((c) => {
        c.font = { bold: true };
        c.fill = fill(SUB_BAND);
      });
    }
  });
  if (t.total) {
    const row = body(t.total);
    row.eachCell((c) => {
      c.font = { bold: true };
      c.fill = fill(TOTAL_BAND);
      c.border = { ...box, top: { style: 'medium', color: { argb: NAVY } } };
    });
  }
  for (const r of t.after ?? []) body(r);
}

function banner(ws: ExcelJS.Worksheet, title: string, model: BudgetModel, meta: BudgetReportMeta, note?: string): void {
  const code = meta.projectNo ? `（工事番号 ${meta.projectNo}）` : '';
  const t = ws.addRow([neutralizeFormula(`${title}　現場：${meta.siteName}${code}`)]);
  t.getCell(1).font = { bold: true, size: 13, color: { argb: NAVY } };
  const sub = ws.addRow([
    `工期全体・${slashDate(model.asOf)} までの日報　作成 ${budgetReportHeader(model, meta).find(([k]) => k === '作成日時')?.[1] ?? ''}　社内用`,
  ]);
  sub.getCell(1).font = { size: 9, color: { argb: 'FF555555' } };
  if (note) {
    const n = ws.addRow([neutralizeFormula(note)]);
    n.getCell(1).font = { size: 9, color: { argb: 'FF555555' } };
  }
  ws.addRow([]);
}

function subHead(ws: ExcelJS.Worksheet, title: string): void {
  ws.addRow([]);
  const r = ws.addRow([title]);
  r.getCell(1).font = { bold: true, size: 11, color: { argb: NAVY } };
}

function sheet(wb: ExcelJS.Workbook, name: string, widths: number[], landscape = false): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    pageSetup: { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = widths.map((width) => ({ width }));
  return ws;
}

// ─── ③ 日々の実績 ───

/** ③ 工種ごとに、日付・作業内容の行・振り分けた人工と労務費。工種ごとの小計（太字）。 */
export function dailyTable(model: BudgetModel): SectionTable {
  const columns = [
    col.text('日付', 1.6),
    col.text('工種', 2),
    col.text('日報の工種の文字', 2),
    col.text('件', 1),
    col.text('作業内容', 4),
    col.num('施工数量', 1.4),
    col.text('単位', 1),
    col.num('投入人工', 1.4),
    col.num('振り分けた人工', 1.6),
    col.num('振り分けた労務費', 2),
    col.num('外注の支払い', 2),
  ];
  const rows: Cell[][] = [];
  const boldRows: number[] = [];
  const add = (name: string, days: TradeDay[], subtotalQty: Cell, subtotalUnit: string) => {
    let manDays = 0;
    let amount = 0;
    let sub = 0;
    let work = 0;
    for (const d of days) {
      manDays += d.manDays;
      amount += d.amount;
      sub += d.subcontract;
      work += d.workManDays;
      const lines = d.lines.length > 0 ? d.lines : [null];
      lines.forEach((l, i) => {
        const first = i === 0;
        rows.push([
          first ? slashDate(d.date) : '',
          name,
          l ? l.trade : '',
          l && l.changeKind !== 'contract' ? CHANGE_KIND_LABELS[l.changeKind] : '',
          l ? l.description : '（作業内容の行なし）',
          l ? qty(l.qty) : '',
          l && l.qty !== null ? l.unit : '',
          l ? qty(l.manDays) : '',
          first ? qty(d.manDays) : '',
          first ? yen(d.amount) : '',
          first && d.subcontract !== 0 ? yen(d.subcontract) : '',
        ]);
      });
    }
    boldRows.push(rows.length);
    rows.push([
      '小計',
      name,
      `${days.length} 日`,
      '',
      '',
      subtotalQty,
      subtotalUnit,
      qty(Math.round(work * 100) / 100),
      qty(Math.round(manDays * 100) / 100),
      yen(amount),
      yen(sub),
    ]);
  };
  for (const t of model.trades) add(t.name, t.days, t.actual.qty === null ? '' : qty(t.actual.qty), t.actual.qty === null ? '' : (t.actual.unit ?? ''));
  add('予算外の作業', model.outside.days, '', '');
  return { columns, rows, boldRows };
}

// ─── ④ 月別の推移 ───

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const monthLabel = (month: string) => `${month.slice(0, 4)}年${month.slice(5, 7)}月`;

/** ④ 月ごとの人工・労務費・外注・燃料・リース・現金・買掛（仕入）と、工種ごとの数量からの進み具合（月末の時点の累計）。 */
export function monthlyTables(input: BudgetModelInput, model: BudgetModel): { costs: SectionTable; progress: SectionTable } | null {
  const reports = input.reports.filter((r) => r.date <= model.asOf);
  if (reports.length === 0) return null;
  const dates = reports.map((r) => r.date).sort();
  const months = monthsBetween(dates[0].slice(0, 7), model.asOf.slice(0, 7));
  const acc = new Map(months.map((m) => [m, { manDays: 0, labor: 0, subcontract: 0, fuel: 0, lease: 0, cash: 0, credit: 0 }]));
  for (const d of [...model.trades.flatMap((t) => t.days), ...model.outside.days]) {
    const a = acc.get(d.date.slice(0, 7));
    if (!a) continue;
    a.manDays += d.manDays;
    a.labor += d.amount;
  }
  for (const r of reports) {
    const a = acc.get(r.date.slice(0, 7));
    if (!a) continue;
    for (const l of r.lines) {
      if (l.kind === 'credit' && l.purchaseKind === 'subcontract') a.subcontract += l.stored.amount;
      else if (l.kind === 'fuel' || l.kind === 'lease' || l.kind === 'cash' || l.kind === 'credit') a[l.kind] += l.stored.amount;
    }
  }
  const costRows: Cell[][] = months.map((m) => {
    const a = acc.get(m)!;
    return [
      monthLabel(m),
      qty(Math.round(a.manDays * 100) / 100),
      yen(a.labor),
      yen(a.subcontract),
      yen(a.fuel),
      yen(a.lease),
      yen(a.cash),
      yen(a.credit),
      yen(a.labor + a.subcontract + a.fuel + a.lease + a.cash + a.credit),
    ];
  });
  const sum = (k: 'manDays' | 'labor' | 'subcontract' | 'fuel' | 'lease' | 'cash' | 'credit') => [...acc.values()].reduce((s, a) => s + a[k], 0);
  const costs: SectionTable = {
    columns: [
      col.text('月', 1.6),
      col.num('人工', 1.4),
      col.num('労務費', 2),
      col.num('外注', 2),
      col.num('燃料', 2),
      col.num('リース', 2),
      col.num('現金', 2),
      col.num('買掛（仕入）', 2),
      col.num('合計', 2),
    ],
    rows: costRows,
    total: [
      '合計',
      qty(Math.round(sum('manDays') * 100) / 100),
      yen(sum('labor')),
      yen(sum('subcontract')),
      yen(sum('fuel')),
      yen(sum('lease')),
      yen(sum('cash')),
      yen(sum('credit')),
      yen(sum('labor') + sum('subcontract') + sum('fuel') + sum('lease') + sum('cash') + sum('credit')),
    ],
  };

  // 数量からの進み具合：月末（最後の月は asOf）の時点で集計し直す
  const progressRows: Cell[][] = months.map((m) => {
    const at = m === model.asOf.slice(0, 7) ? model.asOf : monthEnd(m);
    const mm = buildBudgetModel({ ...input, asOf: at });
    return [monthLabel(m), ...mm.trades.map((t) => pct(t.progress.fromQty === null ? null : t.progress.fromQty / 100))];
  });
  const progress: SectionTable = {
    columns: [col.text('月末の時点', 1.6), ...model.trades.map((t) => col.num(t.name, 1.6))],
    rows: progressRows,
  };
  return { costs, progress };
}

// ─── ⑤ 出面 ───

/** ⑤ 作業員 × 日付の人工（労務の行の人工。所属はその作業員の最後の行の写し）。 */
export function attendanceTable(input: BudgetModelInput, asOf: string): SectionTable | null {
  const reports = input.reports.filter((r) => r.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const dates: string[] = [];
  const workers = new Map<string, { name: string; affiliation: string; byDate: Map<string, number>; total: number }>();
  // 会社の名前：取引先の名前、無ければ現場の協力会社の名前
  const names = { ...Object.fromEntries(input.sitePartners.map((p) => [p.supplierId, p.name])), ...(input.supplierNames ?? {}) };
  for (const r of reports) {
    let any = false;
    for (const l of r.lines) {
      if (l.kind !== 'labor') continue;
      any = true;
      const key = l.workerId ? `id:${l.workerId}` : `name:${l.workerName.trim()}`;
      const w = workers.get(key) ?? { name: l.workerName.trim(), affiliation: '', byDate: new Map<string, number>(), total: 0 };
      w.name = l.workerName.trim() || w.name;
      w.affiliation = affiliationLabel(l.affiliation, l.supplierId, names);
      w.byDate.set(r.date, (w.byDate.get(r.date) ?? 0) + l.stored.manDays);
      w.total += l.stored.manDays;
      workers.set(key, w);
    }
    if (any && !dates.includes(r.date)) dates.push(r.date);
  }
  if (workers.size === 0) return null;
  const order = (a: string) => (a === '自社' ? 0 : a === '所属なし' ? 2 : 1);
  const list = [...workers.values()].sort(
    (a, b) => order(a.affiliation) - order(b.affiliation) || a.affiliation.localeCompare(b.affiliation, 'ja') || a.name.localeCompare(b.name, 'ja'),
  );
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    columns: [col.text('所属', 2), col.text('作業員', 2), col.num('合計', 1.2), ...dates.map((d) => col.num(d.slice(5).replace('-', '/'), 0.8))],
    rows: list.map((w) => [w.affiliation, w.name, qty(r2(w.total)), ...dates.map((d) => (w.byDate.has(d) ? qty(r2(w.byDate.get(d)!)) : ''))]),
    total: [
      '合計',
      `${list.length} 人`,
      qty(r2(list.reduce((s, w) => s + w.total, 0))),
      ...dates.map((d) => qty(r2(list.reduce((s, w) => s + (w.byDate.get(d) ?? 0), 0)))),
    ],
  };
}

// ─── ⑥ 元請けの内訳と数量の進み具合 ───

export function quantityProgressTable(model: BudgetModel): SectionTable {
  return {
    columns: [
      col.text('工種', 2.4),
      col.text('単位', 1),
      col.num('内訳の数量（当初＋変更）', 2),
      col.num('日報の数量の合計', 2),
      col.num('数量から', 1.4),
      col.num('上書き', 1.4),
      col.num('使っている進み具合', 1.6),
    ],
    rows: model.trades.map((t) => [
      t.name,
      t.actual.contractQty === null ? '—' : (t.actual.unit ?? ''),
      qty(t.actual.contractQty),
      qty(t.actual.qty),
      pct(t.progress.fromQty === null ? null : t.progress.fromQty / 100),
      pct(t.progress.override === null ? null : t.progress.override / 100),
      pct(t.progress.used === null ? null : t.progress.used / 100),
    ]),
  };
}

// ─── 本体 ───

/**
 * 予算と実績の集計 Excel を作る。input は loadBudgetModelInput の結果（集計は中で buildBudgetModel する）。
 * partners は ⑦ 実行予算の施工者の名前とプルダウン（協力会社の印のある会社）。
 */
export async function buildBudgetReportXlsx(
  input: BudgetModelInput,
  meta: BudgetReportMeta,
  partners: TemplatePartner[],
): Promise<Buffer> {
  const model = buildBudgetModel(input);
  const wb = new ExcelJS.Workbook();
  wb.creator = '現場日報アプリ';
  wb.created = new Date(meta.outputAt);
  const [s1, s2, s3, s4, s5, s6] = REPORT_SHEET_NAMES;

  // ① 予算と実績
  const ws1 = sheet(wb, s1, [34, 14, 14, 10, 14, 10, 14, 10, 14, 14, 22], true);
  banner(ws1, `① ${BUDGET_REPORT_TITLE}`, model, meta, '見込み＝請負の見込み（請負額。外注の支払いが超えたら支払い）＋ 人工の実績 ÷ 進み具合、見込みの粗利＝内訳の金額 − 見込み。進み具合は上書きがあればそれ、なければ数量から。外注の買掛は工種の実績に入れ、現場全体には入れない。');
  writeTable(ws1, budgetSummaryTable(model));
  subHead(ws1, '現場全体の内わけ');
  writeTable(ws1, budgetSiteWideTable(model));
  ws1.views = [{ state: 'frozen', ySplit: 5, xSplit: 1 }];

  // ② 工種×施工者
  const ws2 = sheet(wb, s2, [18, 26, 8, 10, 14, 10, 14, 14, 14, 36], true);
  banner(ws2, '② 工種×施工者の明細', model, meta, '労務・常用の実績は日報の労務費・人工を工種に振り分けた分（請負の会社の人工はうち常用の時間の分だけ。請負の人工は出面だけ）。請負の行は 実行予算の請負額・外注の買掛の支払い・見込み（請負額。支払いが超えたら支払い）。');
  writeTable(ws2, budgetPerformerTable(model));
  ws2.views = [{ state: 'frozen', ySplit: 5 }];

  // ③ 日々の実績
  const ws3 = sheet(wb, s3, [12, 14, 16, 8, 36, 10, 8, 10, 12, 14, 14], true);
  banner(ws3, '③ 工種別の日々の実績', model, meta, '振り分けた人工・労務費は、その日の労務費・人工を作業内容の行の投入人工の比などで工種に分けた分（日の最初の行に出す）。外注の支払いは、その日の外注の買掛のうちその工種の分。');
  writeTable(ws3, dailyTable(model));
  ws3.views = [{ state: 'frozen', ySplit: 5 }];

  // ④ 月別の推移
  const ws4 = sheet(wb, s4, [14, ...Array.from({ length: Math.max(7, model.trades.length) }, () => 13)], true);
  banner(ws4, '④ 月別の推移', model, meta, '繰越初期値は月に分けられないので含めない。進み具合は数量から（上書きの % は履歴の時点が月と合わないので出さない）。');
  const monthly = monthlyTables(input, model);
  if (monthly) {
    writeTable(ws4, monthly.costs);
    if (model.trades.length > 0) {
      subHead(ws4, '数量からの進み具合（月末の時点の累計）');
      writeTable(ws4, monthly.progress);
    }
  } else {
    ws4.addRow(['日報がありません']);
  }

  // ⑤ 出面
  const attendance = attendanceTable(input, model.asOf);
  const ws5 = sheet(wb, s5, [16, 16, 9, ...(attendance ? attendance.columns.slice(3).map(() => 6.5) : [])], true);
  banner(ws5, '⑤ 出面（作業員 × 日付の人工）', model, meta, '所属はその作業員の最後の日報の行の写し。繰越初期値は含めない。');
  if (attendance) {
    writeTable(ws5, attendance);
    ws5.views = [{ state: 'frozen', ySplit: 5, xSplit: 3 }];
  } else {
    ws5.addRow(['労務の行がありません']);
  }

  // ⑥ 元請けの内訳と数量の進み具合
  const ws6 = sheet(wb, s6, [14, 36, 18, 12, 12, 12, 14, 18], true);
  banner(ws6, '⑥ 元請けの内訳と数量の進み具合', model, meta, '経費・減分は工種に入れず、内訳の金額の合計にだけ数える。数量から＝日報の数量の合計 ÷ 単位が同じ内訳の行の数量の合計。');
  writeTable(ws6, contractItemsTable(input.data));
  subHead(ws6, '工種ごとの数量の進み具合');
  writeTable(ws6, quantityProgressTable(model));

  // ⑦ 実行予算（取り込み用と同じ形）＋ 隠した選択肢
  addBudgetTemplateSheets(
    wb,
    { trades: input.data.trades, budgetLines: input.data.budgetLines },
    { name: meta.siteName, code: meta.projectNo, dailyRate: input.dailyRate },
    partners,
    { contract: false, hideChoices: true },
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
