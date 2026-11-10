import { describe, expect, it } from 'vitest';
import { EMPTY_WORK_CHANGE } from '@/lib/report/change-labels';
import type { ReportMasters } from '@/components/report/form-state';
import type { DaySheetParse } from '@/lib/import/day-sheet';
import { toSaveInput } from '@/lib/import/day-sheet-to-input';
import { reportInputSchema } from '@/lib/report/schema';

const SITE = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NONE = { start: null, end: null, breakMin: null, gapMin: null };

const masters: ReportMasters = {
  workers: [
    { id: id(1), name: '山田 太郎', active: true, rates: [{ amount: 18000, effectiveFrom: '2026-01-01' }, { amount: 19000, effectiveFrom: '2026-12-01' }], overtimeRate: 2800 },
    { id: id(2), name: '佐藤', active: true, rates: [], overtimeRate: null },
    { id: id(3), name: '佐藤', active: true, rates: [], overtimeRate: null },
    { id: id(4), name: '田中', active: false, rates: [{ amount: 15000, effectiveFrom: '2026-01-01' }], overtimeRate: null },
    { id: id(5), name: '田中', active: true, rates: [{ amount: 16000, effectiveFrom: '2026-01-01' }], overtimeRate: null },
  ],
  vehicles: [{ id: id(11), name: 'ハイエース 1234', active: true, kmPerL: 9.5 }],
  leaseItems: [{ id: id(21), name: '発電機', spec: '2kVA', active: true, rates: [{ amount: 3000, effectiveFrom: '2026-01-01' }] }],
  suppliers: [{ id: id(31), name: '○○建材', active: true }],
  units: ['枚', '日'],
  weather: ['晴れ', '雨'],
};

function parse(over: Partial<DaySheetParse> = {}): DaySheetParse {
  return {
    date: null,
    weather: null,
    supervisor: null,
    common: { ...NONE },
    labor: [],
    fuel: [],
    lease: [],
    cash: [],
    credit: [],
    work: [],
    issuesText: '',
    notesText: '',
    notes: [],
    ...over,
  };
}

describe('toSaveInput', () => {
  it('全部の表を SaveInput にする（マスターの名前と一致すれば ID と単価を入れる）', () => {
    const { input, notes } = toSaveInput(
      parse({
        date: '2026-11-03',
        weather: '晴れ',
        supervisor: '山田',
        common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: null },
        labor: [{ name: '山田 太郎', time: { ...NONE, start: '07:00' }, dailyRate: 17000, note: '早出' }],
        fuel: [{ name: 'ハイエース 1234', distanceKm: 40, pricePerL: 165, note: '' }],
        lease: [{ name: '発電機', spec: '', unit: '日', qty: 1, unitPrice: 2500, note: '' }],
        cash: [{ name: 'ビス', spec: '', unit: '箱', qty: 2, unitPrice: 1200, vendor: 'ホームセンター' }],
        credit: [{ name: '合板', spec: '12mm', unit: '枚', qty: 10, unitPrice: 1500, vendor: '○○建材' }],
        work: [{ trade: '大工', description: '床下地', qty: 20, unit: '㎡', manDays: 1.5, unitPrice: 3000 }],
        issuesText: '足場の点検',
        notesText: '明日は雨天中止',
      }),
      SITE,
      '2026-11-03',
      masters,
    );
    expect(notes).toEqual([]);
    expect(input).toEqual({
      siteId: SITE,
      date: '2026-11-03',
      weather: '晴れ',
      supervisor: '山田',
      common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: null },
      issuesText: '足場の点検',
      notesText: '明日は雨天中止',
      lines: [
        { kind: 'labor', workerId: id(1), workerName: '山田 太郎', time: { ...NONE, start: '07:00' }, dailyRate: 18000, overtimeRate: 2800, note: '早出' },
        { kind: 'fuel', vehicleId: id(11), vehicleName: 'ハイエース 1234', kmPerL: 9.5, distanceKm: 40, pricePerL: 165, note: '', issueId: null },
        { kind: 'lease', itemId: id(21), itemName: '発電機', spec: '2kVA', unit: '日', qty: 1, unitPrice: 3000, note: '', issueId: null },
        { kind: 'cash', itemName: 'ビス', spec: '', unit: '箱', qty: 2, unitPrice: 1200, vendor: 'ホームセンター', issueId: null },
        { kind: 'credit', itemName: '合板', spec: '12mm', unit: '枚', qty: 10, unitPrice: 1500, supplierId: id(31), vendor: '○○建材', purchaseKind: 'material', siteTradeId: null, issueId: null },
        { kind: 'work', estimateItemId: null, trade: '大工', description: '床下地', qty: 20, unit: '㎡', manDays: 1.5, unitPrice: 3000, source: 'extra', ...EMPTY_WORK_CHANGE, siteTradeId: null },
      ],
    });
    expect(reportInputSchema.safeParse(input).success).toBe(true);
  });

  it('マスターに無い・同名が複数ある名前は手入力の行にして注記する', () => {
    const { input, notes } = toSaveInput(
      parse({
        labor: [
          { name: '新人', time: { ...NONE }, dailyRate: 14000, note: '' },
          { name: '佐藤', time: { ...NONE }, dailyRate: 0, note: '' },
          { name: '田中', time: { ...NONE }, dailyRate: null, note: '' },
        ],
        fuel: [{ name: '軽トラ', distanceKm: 10, pricePerL: 170, note: '' }],
        lease: [{ name: '投光器', spec: 'LED', unit: '日', qty: 2, unitPrice: 800, note: '' }],
        credit: [
          { name: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 500, vendor: '△△商店' },
          { name: '砂', spec: '', unit: '袋', qty: 1, unitPrice: 300, vendor: '' },
        ],
      }),
      SITE,
      '2026-11-03',
      masters,
    );
    const labor = input.lines.filter((l) => l.kind === 'labor');
    expect(labor).toEqual([
      { kind: 'labor', workerId: null, workerName: '新人', time: NONE, dailyRate: 14000, overtimeRate: null, note: '' },
      { kind: 'labor', workerId: null, workerName: '佐藤', time: NONE, dailyRate: null, overtimeRate: null, note: '' },
      // 同名の無効な人より、有効な人を選ぶ。
      { kind: 'labor', workerId: id(5), workerName: '田中', time: NONE, dailyRate: 16000, overtimeRate: null, note: '' },
    ]);
    expect(input.lines.find((l) => l.kind === 'fuel')).toEqual({
      kind: 'fuel', vehicleId: null, vehicleName: '軽トラ', kmPerL: null, distanceKm: 10, pricePerL: 170, note: '', issueId: null,
    });
    expect(input.lines.find((l) => l.kind === 'lease')).toEqual({
      kind: 'lease', itemId: null, itemName: '投光器', spec: 'LED', unit: '日', qty: 2, unitPrice: 800, note: '', issueId: null,
    });
    expect(input.lines.filter((l) => l.kind === 'credit')).toEqual([
      { kind: 'credit', itemName: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 500, supplierId: null, vendor: '△△商店', purchaseKind: 'material', siteTradeId: null, issueId: null },
      { kind: 'credit', itemName: '砂', spec: '', unit: '袋', qty: 1, unitPrice: 300, supplierId: null, vendor: '', purchaseKind: 'material', siteTradeId: null, issueId: null },
    ]);
    expect(notes).toEqual([
      '作業員「新人」はマスターに無いので手入力として取り込みました',
      '作業員「佐藤」はマスターに同じ名前が複数あるため手入力として取り込みました',
      '車両「軽トラ」はマスターに無いため手入力として取り込みました（燃費を入れるか、一覧から選び直してください）',
      'リース品「投光器」はマスターに無いため手入力として取り込みました（単価を確かめるか、一覧から選び直してください）',
      '買掛の仕入先「△△商店」はマスターに無いので手入力として取り込みました',
    ]);
    expect(reportInputSchema.safeParse(input).success).toBe(true);
  });

  it('マスターの単価が無ければファイルの日当・リース単価を使う', () => {
    const { input } = toSaveInput(
      parse({
        labor: [{ name: '佐藤', time: { ...NONE }, dailyRate: 15000, note: '' }],
        lease: [{ name: '発電機', spec: '3kVA', unit: '日', qty: 1, unitPrice: 2500, note: '' }],
      }),
      SITE,
      '2025-12-01',
      { ...masters, workers: [masters.workers[1]] },
    );
    expect(input.lines).toEqual([
      { kind: 'labor', workerId: id(2), workerName: '佐藤', time: NONE, dailyRate: 15000, overtimeRate: null, note: '' },
      // マスターの単価は 2026-01-01 から。ファイルの規格はそのまま。
      { kind: 'lease', itemId: id(21), itemName: '発電機', spec: '3kVA', unit: '日', qty: 1, unitPrice: 2500, note: '', issueId: null },
    ]);
  });

  it('ファイルに日付が無ければ画面の日付', () => {
    const { input, notes } = toSaveInput(parse(), SITE, '2026-11-04', masters);
    expect(input.date).toBe('2026-11-04');
    expect(notes).toEqual([]);
    expect(reportInputSchema.safeParse(input).success).toBe(true);
  });

  it('ファイルの日付が画面と違えば、画面の日付で取り込んで注記する', () => {
    const { input, notes } = toSaveInput(parse({ date: '2026-11-02' }), SITE, '2026-11-04', masters);
    expect(input.date).toBe('2026-11-04');
    expect(notes).toEqual(['ファイルの日付（2026/11/2）と画面の日付（2026/11/4）が違います。画面の日付で取り込みます']);
  });

  it('天候が選択肢に無ければそのまま取り込んで注記する。読み取りの注記は先頭に残す', () => {
    const { input, notes } = toSaveInput(parse({ weather: '霧', notes: ['読み取りの注記'] }), SITE, '2026-11-03', masters);
    expect(input.weather).toBe('霧');
    expect(notes).toEqual(['読み取りの注記', '天候「霧」は選択肢に無いため、そのまま取り込みました']);
  });

  it('同じ注記は 1 回だけ（同じ知らない仕入先の買掛が 2 行）', () => {
    const { input, notes } = toSaveInput(
      parse({
        credit: [
          { name: '釘', spec: '', unit: '箱', qty: 1, unitPrice: 500, vendor: '△△商店' },
          { name: '砂', spec: '', unit: '袋', qty: 1, unitPrice: 300, vendor: '△△商店' },
        ],
      }),
      SITE,
      '2026-11-03',
      masters,
    );
    expect(input.lines.filter((l) => l.kind === 'credit')).toHaveLength(2);
    expect(notes).toEqual(['買掛の仕入先「△△商店」はマスターに無いので手入力として取り込みました']);
  });

  it('施工内容が空の作業内容は注記する（保存の前に入れてもらう）', () => {
    const { notes } = toSaveInput(
      parse({ work: [{ trade: '大工', description: '', qty: null, unit: '', manDays: 1, unitPrice: null }] }),
      SITE,
      '2026-11-03',
      masters,
    );
    expect(notes).toEqual(['作業内容の 1 行目（大工）は施工内容が空です。保存の前に入れてください']);
  });

  it('作業内容の工種は読み替え表 → 工種名で実行予算の工種に決め、決まらなければ注記して文字のまま', () => {
    const w = (trade: string) => ({ trade, description: '作業', qty: null, unit: '', manDays: 1, unitPrice: null });
    const budget = {
      trades: [{ id: id(41), name: '塗装', sortOrder: 0 }, { id: id(42), name: 'ブラスト', sortOrder: 1 }],
      aliases: [{ tradeText: 'ブラスト工', tradeId: id(42) }],
    };
    const { input, notes } = toSaveInput(parse({ work: [w(' ブラスト工'), w('塗装'), w('足場'), w('')] }), SITE, '2026-11-03', masters, budget);
    const work = input.lines.filter((l) => l.kind === 'work');
    expect(work.map((l) => [l.trade, l.siteTradeId])).toEqual([
      [' ブラスト工', id(42)],
      ['塗装', id(41)],
      ['足場', null],
      ['', null],
    ]);
    expect(notes).toEqual(['工種「足場」は実行予算の工種に当てはまらないため、文字のまま取り込みました（工種の欄で選び直せます）']);
  });

  it('現場に工種が無ければ工種を決めず、注記もしない', () => {
    const { input, notes } = toSaveInput(
      parse({ work: [{ trade: '足場', description: '作業', qty: null, unit: '', manDays: 1, unitPrice: null }] }),
      SITE,
      '2026-11-03',
      masters,
      { trades: [], aliases: [{ tradeText: '足場', tradeId: id(42) }] },
    );
    expect(input.lines[0]).toMatchObject({ kind: 'work', siteTradeId: null });
    expect(notes).toEqual([]);
  });
});
