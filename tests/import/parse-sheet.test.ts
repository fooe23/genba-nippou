import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { cellNumber, normalizeHeader, parseMasterSheet } from '@/lib/import/parse-sheet';

const ROW1 = ['作業員マスター', null, null, null, null, null, '取引先マスター（仕入先）', null, null, null, null, null, '車両マスター', null, null, null, null, null, 'リース品マスター', null, null, null, null];
const V34_HEADER = ['No.', '作業員名', '区分（職種）', '設定日当（円）', '残業単価（円/H）', '備考', 'No.', '取引先名', '区分', '担当者', '備考', null, 'No.', '車両名／ナンバー', '種別', '燃費(km/L)', '備考', null, 'No.', '品目名', '規格', 'リース単価（円/日）', '備考'];
const V33_HEADER = ['No.', '作業員名', '区分（職種）', '設定日当（円）', '備考', null, 'No.', '取引先名', '区分', '担当者', '備考', null, 'No.', '車両名／ナンバー', '種別', '燃費(km/L)', '備考', null, 'No.', '品目名', '規格', 'リース単価（円/日）', '備考'];

function row(cells: Record<number, unknown>, no?: number): unknown[] {
  const r: unknown[] = Array(23).fill(null);
  if (no !== undefined) [0, 6, 12, 18].forEach((c) => (r[c] = no));
  for (const [k, v] of Object.entries(cells)) r[Number(k)] = v;
  return r;
}

describe('parseMasterSheet（V34）', () => {
  const grid = [
    ROW1,
    V34_HEADER,
    row({ 1: '山田 太郎', 2: '大工', 3: 18000, 4: 2800, 5: 'ベテラン', 7: '○○建材', 8: '仕入', 9: '佐藤', 13: 'ハイエース 1234', 14: 'バン', 15: 9.5, 19: '発電機', 20: '2kVA', 21: 3000 }, 1),
    row({ 1: '  鈴木 次郎 ', 2: '鳶', 3: '19,000', 4: 0 }, 2),
    row({}, 3),
    row({ 1: '佐藤', 3: 'abc' }, 4),
    row({ 1: '山田 太郎', 3: 20000 }, 5),
    row({ 3: 15000 }, 6),
    ['■ 作業員別 当月集計'],
    ['No.', '作業員名', '前月繰越 人工'],
    [1, '山田 太郎', 0, 0],
  ];
  const r = parseMasterSheet(grid);

  it('4 ブロックを見出しで認識して読む', () => {
    expect(r.source).toBe('xlsx');
    expect(r.detected).toEqual(['workers', 'suppliers', 'vehicles', 'leaseItems']);
    expect(r.rows.workers[0]).toEqual({ name: '山田 太郎', trade: '大工', dailyRate: 18000, overtimeRate: 2800, note: 'ベテラン' });
    expect(r.rows.suppliers).toEqual([{ name: '○○建材', category: '仕入', contact: '佐藤', note: null }]);
    expect(r.rows.vehicles).toEqual([{ name: 'ハイエース 1234', kind: 'バン', kmPerL: 9.5, note: null }]);
    expect(r.rows.leaseItems).toEqual([{ name: '発電機', spec: '2kVA', unitPrice: 3000, note: null }]);
  });

  it('名前の前後の空白を除き、桁区切りの数値を読み、残業単価 0 は null', () => {
    expect(r.rows.workers[1]).toEqual({ name: '鈴木 次郎', trade: '鳶', dailyRate: 19000, overtimeRate: null, note: null });
  });

  it('No. だけの空行は読み飛ばし、集計表（■ の行）以降は読まない', () => {
    expect(r.rows.workers.map((w) => w.name)).toEqual(['山田 太郎', '鈴木 次郎']);
    expect(r.errors.every((e) => e.rowNo <= 8)).toBe(true);
  });

  it('数値でない日当・重複名・名前が空の行はエラー（Excel の行番号つき）', () => {
    expect(r.errors).toEqual([
      { kind: 'workers', rowNo: 6, name: '佐藤', message: '設定日当が数値ではありません（abc）' },
      { kind: 'workers', rowNo: 7, name: '山田 太郎', message: '同じ名前が 3 行目にもあります（後の行は取り込みません）' },
      { kind: 'workers', rowNo: 8, name: '', message: '名前が空です' },
    ]);
  });

  it('負の数値はエラー', () => {
    const g = [ROW1, V34_HEADER, row({ 19: '足場', 21: -1 }, 1)];
    expect(parseMasterSheet(g).errors).toEqual([{ kind: 'leaseItems', rowNo: 3, name: '足場', message: 'リース単価は0以上の数値にしてください' }]);
  });
});

describe('parseMasterSheet（V33）', () => {
  it('作業員の E 列が備考なら、残業単価は null・備考を読む', () => {
    const g = [ROW1, V33_HEADER, row({ 1: '田中', 2: '左官', 3: 17000, 4: '月末精算' }, 1)];
    const r = parseMasterSheet(g);
    expect(r.errors).toEqual([]);
    expect(r.rows.workers).toEqual([{ name: '田中', trade: '左官', dailyRate: 17000, overtimeRate: null, note: '月末精算' }]);
  });

  it('見出しが無ければ detected は空', () => {
    expect(parseMasterSheet([['a', 'b'], ['c', 'd']]).detected).toEqual([]);
  });
});

describe('見出しと数値の正規化', () => {
  it('全角半角・空白の違いを吸収する', () => {
    expect(normalizeHeader(' 燃費（ｋｍ／Ｌ） ')).toBe(normalizeHeader('燃費(km/L)'));
    expect(normalizeHeader('車両名 / ナンバー')).toBe(normalizeHeader('車両名／ナンバー'));
  });
  it('空・ハイフンは null、¥・円・全角数字は読む', () => {
    expect(cellNumber('')).toEqual({ ok: true, value: null });
    expect(cellNumber('-')).toEqual({ ok: true, value: null });
    expect(cellNumber('－')).toEqual({ ok: true, value: null });
    expect(cellNumber('¥18,000')).toEqual({ ok: true, value: 18000 });
    expect(cellNumber('１８０００円')).toEqual({ ok: true, value: 18000 });
    expect(cellNumber('十八')).toEqual({ ok: false });
    expect(cellNumber(true)).toEqual({ ok: false });
  });
});

describe('実ファイル（templates/現場管理台帳_V34_原本.xlsm）', () => {
  it.each(['現場管理台帳_V34_原本.xlsm', '現場管理台帳_V33_原本.xlsm'])('%s を例外なく読み、4 ブロックの見出しを認識する', (file) => {
    const path = fileURLToPath(new URL(`../../templates/${file}`, import.meta.url));
    const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
    const ws = wb.Sheets['マスター'] ?? wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    const r = parseMasterSheet(grid);
    expect(r.detected).toEqual(['workers', 'suppliers', 'vehicles', 'leaseItems']);
    expect(r.errors).toEqual([]);
  });
});
