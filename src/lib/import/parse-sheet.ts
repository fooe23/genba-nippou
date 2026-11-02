import type {
  ImportKind, LeaseItemRow, ParsedRows, ParseResult, RowError, SupplierRow, VehicleRow, WorkerRow,
} from './types';

// Excel 雛形（V33／V34）の「マスター」シートの読み取り。xlsx には依存せず、
// SheetJS の sheet_to_json(ws, { header: 1 }) の結果（行ごとの配列。grid[0] が Excel の 1 行目）を受け取る。
// 列は位置ではなく見出しの文字で決める（見出しの空白・全角半角の違いは正規化して比較）。

export const NAME_MAX = 200;
export const TEXT_MAX = 500;

/** 見出しの正規化：NFKC（全角英数・括弧・スラッシュを半角に）→ 空白をすべて除く → 小文字。 */
export function normalizeHeader(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

type FieldType = 'text' | 'number';
interface FieldSpec { field: string; label: string; type: FieldType; headers: string[]; }
interface KindSpec { nameHeaders: string[]; fields: FieldSpec[]; }

// 見出しの候補（先頭が雛形の見出し。正規化して比較するので全角・半角どちらでもよい）。
export const KIND_SPECS: Record<ImportKind, KindSpec> = {
  workers: {
    nameHeaders: ['作業員名'],
    fields: [
      { field: 'trade', label: '区分（職種）', type: 'text', headers: ['区分（職種）', '職種', '区分'] },
      { field: 'dailyRate', label: '設定日当', type: 'number', headers: ['設定日当（円）', '設定日当', '日当（円）', '日当'] },
      { field: 'overtimeRate', label: '残業単価', type: 'number', headers: ['残業単価（円/H）', '残業単価'] },
      { field: 'note', label: '備考', type: 'text', headers: ['備考', 'メモ'] },
    ],
  },
  suppliers: {
    nameHeaders: ['取引先名'],
    fields: [
      { field: 'category', label: '区分', type: 'text', headers: ['区分'] },
      { field: 'contact', label: '担当者', type: 'text', headers: ['担当者', '連絡先'] },
      { field: 'note', label: '備考', type: 'text', headers: ['備考', 'メモ'] },
    ],
  },
  vehicles: {
    nameHeaders: ['車両名／ナンバー', '車両名'],
    fields: [
      { field: 'kind', label: '種別', type: 'text', headers: ['種別', '区分'] },
      { field: 'kmPerL', label: '燃費', type: 'number', headers: ['燃費(km/L)', '燃費'] },
      { field: 'note', label: '備考', type: 'text', headers: ['備考', 'メモ'] },
    ],
  },
  leaseItems: {
    nameHeaders: ['品目名'],
    fields: [
      { field: 'spec', label: '規格', type: 'text', headers: ['規格'] },
      { field: 'unitPrice', label: 'リース単価', type: 'number', headers: ['リース単価（円/日）', 'リース単価', '単価（円/日）', '単価'] },
      { field: 'note', label: '備考', type: 'text', headers: ['備考', 'メモ'] },
    ],
  },
};

const KIND_ORDER: ImportKind[] = ['workers', 'suppliers', 'vehicles', 'leaseItems'];
const NO_HEADER = normalizeHeader('No.');

/** 見出し行のうち、その種別の名前列の位置（無ければ -1）。 */
export function findNameColumn(kind: ImportKind, headerRow: readonly unknown[]): number {
  const names = KIND_SPECS[kind].nameHeaders.map(normalizeHeader);
  return headerRow.findIndex((h) => names.includes(normalizeHeader(h)));
}

export interface Block { kind: ImportKind; nameCol: number; cols: Record<string, number>; }

/**
 * 見出し行からブロック（種別ごとの列の範囲）を決める。kinds で対象を絞れる（CSV は 1 種別）。
 * ブロックの範囲は「名前列」から「次のブロックの開始（No. 列があればそこ）」の手前まで。
 */
export function findBlocks(headerRow: readonly unknown[], kinds: readonly ImportKind[] = KIND_ORDER): Block[] {
  const found = kinds
    .map((kind) => ({ kind, nameCol: findNameColumn(kind, headerRow) }))
    .filter((b) => b.nameCol >= 0)
    .sort((a, b) => a.nameCol - b.nameCol);
  return found.map((b, i) => {
    const next = found[i + 1];
    let end = headerRow.length;
    if (next) end = normalizeHeader(headerRow[next.nameCol - 1]) === NO_HEADER ? next.nameCol - 1 : next.nameCol;
    const cols: Record<string, number> = {};
    for (const spec of KIND_SPECS[b.kind].fields) {
      const want = spec.headers.map(normalizeHeader);
      for (let c = b.nameCol + 1; c < end; c++) {
        if (want.includes(normalizeHeader(headerRow[c]))) {
          cols[spec.field] = c;
          break;
        }
      }
    }
    return { kind: b.kind, nameCol: b.nameCol, cols };
  });
}

/** 文字列セル：前後の空白を除き、空なら null。数値などは文字列にする。 */
export function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

type NumResult = { ok: true; value: number | null } | { ok: false };

/** 数値セル：空・ハイフンは null。桁区切りのカンマ・「¥」「円」・全角数字は許す。数値にならなければ ok: false。 */
export function cellNumber(v: unknown): NumResult {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { ok: true, value: v } : { ok: false };
  if (typeof v !== 'string') return { ok: false };
  const s = v.normalize('NFKC').trim().replace(/[,，]/g, '').replace(/^[¥￥]/, '').replace(/円$/, '').trim();
  if (s === '' || /^[-‐‑–—―ーｰ]+$/.test(s)) return { ok: true, value: null };
  const n = Number(s);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

function display(v: unknown): string {
  const s = String(v).trim();
  return s.length > 20 ? `${s.slice(0, 20)}…` : s;
}

/** 雛形の下にある「■ 作業員別 当月集計」などの集計表に入ったら読むのをやめる（A 列が「■」で始まる行、または見出し行の繰り返し）。 */
function isSectionBreak(row: readonly unknown[]): boolean {
  const first = row[0];
  if (typeof first === 'string' && first.trim().startsWith('■')) return true;
  return normalizeHeader(first) === NO_HEADER && KIND_ORDER.some((k) => findNameColumn(k, row) >= 0);
}

export function emptyRows(): ParsedRows {
  return { workers: [], suppliers: [], vehicles: [], leaseItems: [] };
}

/**
 * 見出し行の次の行からデータを読む（parseMasterSheet と csvToRows で共通の検証）。
 * - 名前が空で他も空の行は読み飛ばす（No. だけの空行）。名前が空で他に値がある行はエラー。
 * - 数値にならない・負の数値はエラー。残業単価の 0 は「空」（標準の計算式）として null。
 * - 同じ名前が 2 回出たら後の行をエラー（重複）。
 */
export function readBlocks(
  grid: readonly (readonly unknown[] | null | undefined)[],
  headerIndex: number,
  blocks: readonly Block[],
  opts: { stopAtSection: boolean },
): { rows: ParsedRows; errors: RowError[] } {
  const rows = emptyRows();
  const errors: RowError[] = [];
  const seen: Record<ImportKind, Map<string, number>> = {
    workers: new Map(), suppliers: new Map(), vehicles: new Map(), leaseItems: new Map(),
  };

  for (let r = headerIndex + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (opts.stopAtSection && isSectionBreak(row)) break;
    const rowNo = r + 1;
    for (const block of blocks) {
      const spec = KIND_SPECS[block.kind];
      const name = cellText(row[block.nameCol]);
      const hasOther = spec.fields.some((f) => block.cols[f.field] !== undefined && cellText(row[block.cols[f.field]]) !== null);
      if (name === null) {
        if (hasOther) errors.push({ kind: block.kind, rowNo, name: '', message: '名前が空です' });
        continue;
      }
      const rowErrors: string[] = [];
      if (name.length > NAME_MAX) rowErrors.push(`名前が長すぎます（${NAME_MAX}文字まで）`);
      const values: Record<string, string | number | null> = {};
      for (const f of spec.fields) {
        const c = block.cols[f.field];
        const raw = c === undefined ? null : row[c];
        if (f.type === 'text') {
          const t = cellText(raw);
          if (t !== null && t.length > TEXT_MAX) rowErrors.push(`${f.label}が長すぎます（${TEXT_MAX}文字まで）`);
          values[f.field] = t;
        } else {
          const n = cellNumber(raw);
          if (!n.ok) rowErrors.push(`${f.label}が数値ではありません（${display(raw)}）`);
          else if (n.value !== null && n.value < 0) rowErrors.push(`${f.label}は0以上の数値にしてください`);
          values[f.field] = n.ok ? n.value : null;
        }
      }
      const prev = seen[block.kind].get(name);
      if (prev !== undefined) rowErrors.push(`同じ名前が ${prev} 行目にもあります（後の行は取り込みません）`);
      if (rowErrors.length > 0) {
        errors.push({ kind: block.kind, rowNo, name, message: rowErrors.join('／') });
        continue;
      }
      seen[block.kind].set(name, rowNo);
      pushRow(rows, block.kind, name, values);
    }
  }
  return { rows, errors };
}

function pushRow(rows: ParsedRows, kind: ImportKind, name: string, v: Record<string, string | number | null>) {
  const text = (k: string) => (v[k] as string | null) ?? null;
  const num = (k: string) => (v[k] as number | null) ?? null;
  switch (kind) {
    case 'workers': {
      const overtime = num('overtimeRate');
      const row: WorkerRow = { name, trade: text('trade'), dailyRate: num('dailyRate'), overtimeRate: overtime === 0 ? null : overtime, note: text('note') };
      rows.workers.push(row);
      break;
    }
    case 'suppliers': {
      const row: SupplierRow = { name, category: text('category'), contact: text('contact'), note: text('note') };
      rows.suppliers.push(row);
      break;
    }
    case 'vehicles': {
      const row: VehicleRow = { name, kind: text('kind'), kmPerL: num('kmPerL'), note: text('note') };
      rows.vehicles.push(row);
      break;
    }
    case 'leaseItems': {
      const row: LeaseItemRow = { name, spec: text('spec'), unitPrice: num('unitPrice'), note: text('note') };
      rows.leaseItems.push(row);
      break;
    }
  }
}

/**
 * 「マスター」シートの grid を読む。見出しは 2 行目（見つからなければ先頭 5 行のうち最初に名前列がある行）。
 * 見出しが 1 つも無ければ detected が空（呼び出し側で「マスターの見出しが見つかりません」と出す）。
 */
export function parseMasterSheet(grid: unknown[][]): ParseResult {
  const candidates = [1, 0, 2, 3, 4].filter((i) => i < grid.length);
  const headerIndex = candidates.find((i) => findBlocks(grid[i] ?? []).length > 0);
  if (headerIndex === undefined) return { rows: emptyRows(), errors: [], source: 'xlsx', detected: [] };
  const blocks = findBlocks(grid[headerIndex] ?? []);
  const { rows, errors } = readBlocks(grid, headerIndex, blocks, { stopAtSection: true });
  return { rows, errors, source: 'xlsx', detected: blocks.map((b) => b.kind) };
}
