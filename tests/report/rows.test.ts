import { describe, expect, it } from 'vitest';
import { DEFAULT_LABOR_RULE } from '@/lib/calc/report';
import { copyableLines, fromLineRow, saveErrorMessage, toLineRow, toLineRows, toReportRow, withoutSaved } from '@/lib/report/rows';
import type { LaborLine, ReportLine, TimeSpec } from '@/lib/types';

const common: TimeSpec = { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 };
const W = '11111111-1111-4111-8111-111111111111';
const lines: ReportLine[] = [
  { kind: 'labor', workerId: W, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 19000, note: '', overtimeRate: null },
  { kind: 'fuel', vehicleId: W, vehicleName: 'ハイエース', kmPerL: 10, distanceKm: 40, pricePerL: 170, note: '給油' },
  { kind: 'lease', itemId: W, itemName: '足場材', spec: '', unit: '式', qty: 1, unitPrice: 3500, note: '' },
  { kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: 280, vendor: 'ホームセンター' },
  { kind: 'credit', itemName: 'タイル', spec: '300角', unit: '枚', qty: 50, unitPrice: 250, supplierId: W, vendor: 'ABC建材' },
  { kind: 'work', estimateItemId: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', manDays: 1.6, unitPrice: 1200, source: 'extra' },
];

describe('toLineRows', () => {
  const rows = toLineRows(lines, common, DEFAULT_LABOR_RULE);
  it('全行が26列ぶんのキーを持ち、空値は null（"" を送らない）', () => {
    for (const r of rows) {
      expect(Object.keys(r)).toHaveLength(26);
      expect(Object.values(r)).not.toContain('');
    }
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('労務: ref_id=作業員、unit_price=日当、計算値をサーバーで入れる', () => {
    expect(rows[0]).toMatchObject({
      kind: 'labor', ref_id: W, name: '田中', start_time: null, end_time: null, break_min: null, gap_min: null,
      hours: 8, man_days: 1, unit_price: 19000, amount: 19000, note: null, overtime_hours: 0, overtime_rate: null,
    });
  });
  it('労務: 残業時間と残業単価（0 は null で送る）。労務以外は null', () => {
    const labor = lines[0] as LaborLine;
    const nine = { ...labor, time: { start: '08:00', end: '18:00', breakMin: null, gapMin: null } }; // 共通の休憩60 → 9H
    expect(toLineRow({ ...nine, overtimeRate: 3000 }, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({
      hours: 9, man_days: 1, overtime_hours: 1, overtime_rate: 3000, amount: 19000 + 3000,
    });
    expect(toLineRow({ ...nine, overtimeRate: 0 }, common, 0, DEFAULT_LABOR_RULE)).toMatchObject({
      overtime_hours: 1, overtime_rate: null, amount: 19000 + 2969, // ROUND(19000 ÷ 8 × 1.25) = 2969
    });
    for (const r of rows.slice(1)) expect(r).toMatchObject({ overtime_hours: null, overtime_rate: null });
  });
  it('燃料・リース・現金・買掛・作業内容の列対応', () => {
    expect(rows[1]).toMatchObject({ ref_id: W, name: 'ハイエース', km_per_l: 10, distance_km: 40, price_per_l: 170, amount: 680, note: '給油' });
    expect(rows[2]).toMatchObject({ ref_id: W, name: '足場材', spec: null, unit: '式', qty: 1, unit_price: 3500, amount: 3500 });
    expect(rows[3]).toMatchObject({ ref_id: null, name: '養生テープ', unit: '巻', qty: 5, unit_price: 280, amount: 1400, vendor: 'ホームセンター' });
    expect(rows[4]).toMatchObject({ ref_id: W, name: 'タイル', spec: '300角', qty: 50, unit_price: 250, amount: 12500, vendor: 'ABC建材' });
    expect(rows[5]).toMatchObject({
      ref_id: null, trade: '塗装工事', description: '外壁下塗り', qty: 35, unit: '㎡', man_days: 1.6, unit_price: 1200,
      amount: 42000, productivity: 21.875, source: 'extra', name: null,
    });
  });
  it('読み戻すと元の明細になる（空文字は "" に戻る。労務行は DB の計算値 saved も付く）', () => {
    const back = rows.map((r) => fromLineRow(r));
    expect(back.map((l) => (l?.kind === 'labor' ? withoutSaved(l) : l))).toEqual(lines);
    expect(back[0]).toMatchObject({ saved: { hours: 8, manDays: 1, overtimeHours: 0, cost: 19000 } });
    expect(fromLineRow({ kind: 'lease', qty: '2', unit_price: '3500.00' })).toMatchObject({ qty: 2, unitPrice: 3500 });
    expect(fromLineRow({ kind: 'labor', overtime_rate: '3000' })).toMatchObject({ overtimeRate: 3000 });
    expect(fromLineRow({ kind: 'labor', overtime_rate: null })).toMatchObject({ overtimeRate: null });
  });
  it('労務の saved は DB の文字列の数値から作り、実働・人工・金額のどれかが null なら付けない。保存の列には送らない', () => {
    const r = { kind: 'labor' as const, hours: '8.5', man_days: '1', overtime_hours: '0.5', amount: '19406.5' };
    expect(fromLineRow(r)).toMatchObject({ saved: { hours: 8.5, manDays: 1, overtimeHours: 0.5, cost: 19406.5 } });
    // 移行前に保存された行（残業列が無い）は残業 0 とみなして saved を付ける
    expect(fromLineRow({ ...r, overtime_hours: null })).toMatchObject({ saved: { hours: 8.5, manDays: 1, overtimeHours: 0, cost: 19406.5 } });
    expect(fromLineRow({ ...r, amount: null })).not.toHaveProperty('saved');
    const withSaved = fromLineRow(r) as LaborLine;
    expect(Object.keys(toLineRow(withSaved, common, 0, DEFAULT_LABOR_RULE))).not.toContain('saved');
    expect(copyableLines([withSaved])[0]).not.toHaveProperty('saved');
  });
});

describe('toReportRow', () => {
  it('空文字は null にして送る', () => {
    expect(
      toReportRow({ siteId: W, date: '2026-11-05', weather: '', supervisor: '大堀', common: { start: null, end: null, breakMin: null, gapMin: null }, issuesText: '', notesText: 'メモ', lines: [] }),
    ).toEqual({
      site_id: W, report_date: '2026-11-05', weather: null, supervisor: '大堀', common_start: null, common_end: null,
      common_break_min: null, common_gap_min: null, issues_text: null, notes_text: 'メモ',
    });
  });
});

describe('copyableLines', () => {
  it('作業員・車両・リースのみ。個別時間と走行距離は空、リース数量と残業単価は残す', () => {
    const withTime: ReportLine[] = [
      { ...(lines[0] as LaborLine), time: { start: '08:00', end: '12:00', breakMin: 0, gapMin: 0 }, overtimeRate: 3000 },
      ...lines.slice(1),
    ];
    const c = copyableLines(withTime);
    expect(c.map((l) => l.kind)).toEqual(['labor', 'fuel', 'lease']);
    expect(c[0]).toMatchObject({ time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: 19000, overtimeRate: 3000 });
    expect(c[1]).toMatchObject({ distanceKm: null, kmPerL: 10, pricePerL: 170 });
    expect(c[2]).toMatchObject({ qty: 1 });
  });
});

describe('saveErrorMessage', () => {
  it('ガードの文言を日本語にする', () => {
    expect(saveErrorMessage('approved_report_locked')).toBe('承認済みのため編集できません');
    expect(saveErrorMessage('not_reviewer')).toBe('この現場の確認者・承認者ではありません');
    expect(saveErrorMessage('site_closed')).toBe('この現場は完了（または削除）されているため変更できません。管理者が進行中に戻すと入力できます。');
    expect(saveErrorMessage('stale_report')).toBe('他の端末で更新されています。画面を再読み込みしてから保存してください。');
    expect(saveErrorMessage('new row violates row-level security')).toContain('保存に失敗しました');
  });
});
