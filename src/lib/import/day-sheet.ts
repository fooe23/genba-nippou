import { cellNumber } from '@/lib/import/parse-sheet';
import type { TimeSpec } from '@/lib/types';

// 1 日分の雛形（templates/現場管理日報_1日追加用_雛形.xlsm）の「1回目」シートを読む（純関数）。
// 位置は DAY_LAYOUT が唯一の正（雛形の実ファイルで確かめる。tests/import/day-sheet.test.ts）。
// 読むのは入力セルだけ（J 列の日当・F 列のリース単価は VLOOKUP の計算済みの値を参考に読む）。署名欄は読まない。

export const DAY_LAYOUT = {
  sheet: '1回目',
  cells: {
    date: 'F2',
    weather: 'F3',
    supervisor: 'F4',
    commonStart: 'B6',
    commonEnd: 'C6',
    commonBreakMin: 'D6',
    commonGapMin: 'E6',
    cumulativeCost: 'E60',
    outputTotal: 'H60',
    issues: 'A71',
    notes: 'A76',
  },
  tables: {
    labor: { label: '作業員', firstRow: 8, lastRow: 17, columns: { name: 'B', start: 'C', end: 'D', breakMin: 'E', gapMin: 'F', note: 'L', dailyRate: 'J' } },
    fuel: { label: '車両', firstRow: 21, lastRow: 23, columns: { name: 'B', distanceKm: 'D', pricePerL: 'E', note: 'H' } },
    lease: { label: 'リース', firstRow: 27, lastRow: 32, columns: { name: 'B', spec: 'C', unit: 'D', qty: 'E', note: 'H', unitPrice: 'F' } },
    cash: { label: '現金購入', firstRow: 36, lastRow: 41, columns: { name: 'B', spec: 'C', unit: 'D', qty: 'E', unitPrice: 'F', vendor: 'H' } },
    credit: { label: '買掛購入', firstRow: 45, lastRow: 50, columns: { name: 'B', spec: 'C', unit: 'D', qty: 'E', unitPrice: 'F', vendor: 'H' } },
    work: { label: '作業内容', firstRow: 63, lastRow: 68, columns: { trade: 'B', description: 'C', qty: 'E', unit: 'F', manDays: 'G', unitPrice: 'I' } },
  },
} as const;

export type DayLayout = typeof DAY_LAYOUT;

export interface DaySheetLabor { name: string; time: TimeSpec; dailyRate: number | null; note: string; }
export interface DaySheetFuel { name: string; distanceKm: number | null; pricePerL: number | null; note: string; }
export interface DaySheetLease { name: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; note: string; }
export interface DaySheetPurchase { name: string; spec: string; unit: string; qty: number | null; unitPrice: number | null; vendor: string; }
export interface DaySheetWork { trade: string; description: string; qty: number | null; unit: string; manDays: number | null; unitPrice: number | null; }

export interface DaySheetParse {
  date: string | null;
  weather: string | null;
  supervisor: string | null;
  common: TimeSpec;
  labor: DaySheetLabor[];
  fuel: DaySheetFuel[];
  lease: DaySheetLease[];
  cash: DaySheetPurchase[];
  credit: DaySheetPurchase[];
  work: DaySheetWork[];
  issuesText: string;
  notesText: string;
  /** 読み取れずに空欄にした値などの注記。 */
  notes: string[];
}

/** 取り込める 1 日分のブックか（「1回目」シートがある）。 */
export function isDaySheetWorkbook(sheetNames: string[]): boolean {
  return sheetNames.includes(DAY_LAYOUT.sheet);
}

export type Coerced<T> = { ok: true; value: T | null } | { ok: false };

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function hhmm(totalMinutes: number): string {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 時刻：Excel のシリアル値（小数部が時刻）・Date・"H:MM"（秒は無視、全角可）。 */
export function cellTime(v: unknown): Coerced<string> {
  if (isBlank(v)) return { ok: true, value: null };
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return { ok: false };
    return { ok: true, value: hhmm(Math.round((v - Math.floor(v)) * 1440)) };
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false };
    const seconds = v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds() + v.getMilliseconds() / 1000;
    return { ok: true, value: hhmm(Math.round(seconds / 60)) };
  }
  if (typeof v !== 'string') return { ok: false };
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.normalize('NFKC').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false };
  return { ok: true, value: `${pad(Number(m[1]))}:${m[2]}` };
}

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 日付：Excel のシリアル値・Date・"YYYY-MM-DD"／"YYYY/M/D"（全角可）。 */
export function cellDate(v: unknown): Coerced<string> {
  if (isBlank(v)) return { ok: true, value: null };
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return { ok: false };
    const dt = new Date(EXCEL_EPOCH_MS + Math.floor(v) * DAY_MS);
    const s = ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    return s ? { ok: true, value: s } : { ok: false };
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false };
    const s = ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return s ? { ok: true, value: s } : { ok: false };
  }
  if (typeof v !== 'string') return { ok: false };
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v.normalize('NFKC').trim());
  const s = m ? ymd(Number(m[1]), Number(m[2]), Number(m[3])) : null;
  return s ? { ok: true, value: s } : { ok: false };
}

/** 休憩・中抜（分）：0 以上の整数・「30分」・"H:MM"・時刻のシリアル値（1 未満の小数）。 */
export function cellMinutes(v: unknown): Coerced<number> {
  if (isBlank(v)) return { ok: true, value: null };
  if (typeof v === 'string') {
    const s = v.normalize('NFKC').trim().replace(/分$/, '');
    const t = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (t) return Number(t[2]) > 59 ? { ok: false } : { ok: true, value: Number(t[1]) * 60 + Number(t[2]) };
    return cellMinutes(s === '' ? null : Number(s));
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { ok: false };
  if (v > 0 && v < 1) return { ok: true, value: Math.round(v * 1440) };
  return Number.isInteger(v) ? { ok: true, value: v } : { ok: false };
}

/** 文字：前後の空白を除く。空なら null。数値は文字にする。 */
function cellText(v: unknown): string | null {
  if (isBlank(v)) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function display(v: unknown): string {
  const s = v instanceof Date ? v.toISOString() : String(v).trim();
  return s.length > 20 ? `${s.slice(0, 20)}…` : s;
}

const NOTES_PREFIX = /^【通算\d+回目】\n?/;

/** "B8" の値を grid（grid[0] が 1 行目、grid[r][0] が A 列）から取り出す。 */
function at(grid: unknown[][], cell: string): unknown {
  const m = /^([A-Z]+)(\d+)$/.exec(cell);
  if (!m) return null;
  const col = m[1].split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  return grid[Number(m[2]) - 1]?.[col] ?? null;
}

/**
 * 「1回目」シートの grid（SheetJS の sheet_to_json(header:1, raw:true) を A1 始まりにしたもの）を読む。
 * 名前（作業内容は工種・施工内容）が空の行は飛ばす。読めない値は空欄にして notes に書く。
 */
export function parseDaySheet(grid: unknown[][], layout: DayLayout = DAY_LAYOUT): DaySheetParse {
  const notes: string[] = [];
  const c = layout.cells;

  const coerce = <T>(fn: (v: unknown) => Coerced<T>, cell: string, label: string): T | null => {
    const raw = at(grid, cell);
    const r = fn(raw);
    if (r.ok) return r.value;
    notes.push(`${label}（${cell}）を読み取れないため空欄にしました（${display(raw)}）`);
    return null;
  };
  const num = (v: unknown): Coerced<number> => cellNumber(v);

  const date = coerce(cellDate, c.date, '日付');
  const common: TimeSpec = {
    start: coerce(cellTime, c.commonStart, '共通時間の開始'),
    end: coerce(cellTime, c.commonEnd, '共通時間の終了'),
    breakMin: coerce(cellMinutes, c.commonBreakMin, '共通時間の休憩'),
    gapMin: coerce(cellMinutes, c.commonGapMin, '共通時間の中抜'),
  };

  /** 表の各行を読む。read は行の値の取り出し方（null を返した行は飛ばす）。 */
  function table<T>(
    t: { label: string; firstRow: number; lastRow: number },
    read: (cell: (col: string) => unknown, field: <V>(fn: (v: unknown) => Coerced<V>, col: string, label: string) => V | null) => T | null,
  ): T[] {
    const out: T[] = [];
    for (let r = t.firstRow; r <= t.lastRow; r++) {
      const field = <V>(fn: (v: unknown) => Coerced<V>, col: string, label: string) =>
        coerce(fn, `${col}${r}`, `${t.label}の ${r} 行目：${label}`);
      const row = read((col) => at(grid, `${col}${r}`), field);
      if (row !== null) out.push(row);
    }
    return out;
  }

  const T = layout.tables;
  const text = (v: unknown) => cellText(v) ?? '';

  const labor = table(T.labor, (cell, field) => {
    const name = cellText(cell(T.labor.columns.name));
    if (name === null) return null;
    const k = T.labor.columns;
    // J 列は VLOOKUP の計算済みの値（マスターに無い名前の日当に使う）。読めなければ黙って空欄。
    const rate = cellNumber(cell(k.dailyRate));
    return {
      name,
      time: {
        start: field(cellTime, k.start, '開始'),
        end: field(cellTime, k.end, '終了'),
        breakMin: field(cellMinutes, k.breakMin, '休憩'),
        gapMin: field(cellMinutes, k.gapMin, '中抜'),
      },
      dailyRate: rate.ok ? rate.value : null,
      note: text(cell(k.note)),
    };
  });

  const fuel = table(T.fuel, (cell, field) => {
    const k = T.fuel.columns;
    const name = cellText(cell(k.name));
    if (name === null) return null;
    return { name, distanceKm: field(num, k.distanceKm, '走行距離'), pricePerL: field(num, k.pricePerL, '燃料単価'), note: text(cell(k.note)) };
  });

  const lease = table(T.lease, (cell, field) => {
    const k = T.lease.columns;
    const name = cellText(cell(k.name));
    if (name === null) return null;
    const price = cellNumber(cell(k.unitPrice));
    return {
      name,
      spec: text(cell(k.spec)),
      unit: text(cell(k.unit)),
      qty: field(num, k.qty, '数量'),
      unitPrice: price.ok ? price.value : null,
      note: text(cell(k.note)),
    };
  });

  const purchase = (t: DayLayout['tables']['cash'] | DayLayout['tables']['credit']) =>
    table(t, (cell, field) => {
      const k = t.columns;
      const name = cellText(cell(k.name));
      if (name === null) return null;
      return {
        name,
        spec: text(cell(k.spec)),
        unit: text(cell(k.unit)),
        qty: field(num, k.qty, '数量'),
        unitPrice: field(num, k.unitPrice, '単価'),
        vendor: text(cell(k.vendor)),
      };
    });
  const cash = purchase(T.cash);
  const credit = purchase(T.credit);

  const work = table(T.work, (cell, field) => {
    const k = T.work.columns;
    const trade = text(cell(k.trade));
    const description = text(cell(k.description));
    if (trade === '' && description === '') return null;
    return {
      trade,
      description,
      qty: field(num, k.qty, '施工数量'),
      unit: text(cell(k.unit)),
      manDays: field(num, k.manDays, '投入人工'),
      unitPrice: field(num, k.unitPrice, '施工単価'),
    };
  });

  // 累計原価・本日出来高はアプリが明細から計算する。値が入っていても取り込まない。
  const hasValue = (v: unknown) => !isBlank(v) && v !== 0;
  if (hasValue(at(grid, c.cumulativeCost)) || hasValue(at(grid, c.outputTotal))) {
    notes.push(`ファイルの累計原価（${c.cumulativeCost}）・本日出来高（${c.outputTotal}）は取り込みません（アプリが明細から計算します）`);
  }

  return {
    date,
    weather: cellText(at(grid, c.weather)),
    supervisor: cellText(at(grid, c.supervisor)),
    common,
    labor,
    fuel,
    lease,
    cash,
    credit,
    work,
    issuesText: text(at(grid, c.issues)),
    notesText: text(at(grid, c.notes)).replace(NOTES_PREFIX, '').trim(),
    notes,
  };
}
