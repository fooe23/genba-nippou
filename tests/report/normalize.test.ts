import { describe, expect, it } from 'vitest';
import { reportWarnings, validateReport, type SaveInput } from '@/lib/report/schema';

const base: SaveInput = {
  siteId: '11111111-1111-4111-8111-111111111111',
  date: '2026-11-05',
  weather: '晴れ',
  supervisor: '大堀',
  common: { start: '08:00', end: '17:00', breakMin: 60, gapMin: 0 },
  issuesText: '',
  notesText: '',
  lines: [],
};

describe('validateReport の正規化', () => {
  it('現金・買掛の「金額のみ」は qty=1・unitPrice=金額 になり、amountOnly は消える', () => {
    const r = validateReport({
      ...base,
      lines: [
        { kind: 'cash', itemName: '雑費', spec: '', unit: '', qty: null, unitPrice: null, vendor: '', amountOnly: 1500 },
        { kind: 'credit', itemName: 'タイル', spec: '', unit: '枚', qty: 50, unitPrice: 250, supplierId: null, vendor: 'ABC建材' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.lines[0]).toEqual({ kind: 'cash', itemName: '雑費', spec: '', unit: '', qty: 1, unitPrice: 1500, vendor: '' });
    expect(r.value.lines[1]).toEqual({ kind: 'credit', itemName: 'タイル', spec: '', unit: '枚', qty: 50, unitPrice: 250, supplierId: null, vendor: 'ABC建材' });
  });

  it('現金で数量・単価も金額のみも無ければエラー（行の位置つき）', () => {
    const r = validateReport({
      ...base,
      lines: [{ kind: 'cash', itemName: '養生テープ', spec: '', unit: '巻', qty: 5, unitPrice: null, vendor: '' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toBe('現金の1行目：単価を入力してください（または「金額のみ入力」）');
  });

  it('金額のみ入力で金額が空なら「金額を入力してください」の1件だけ', () => {
    for (const amountOnly of [null, '']) {
      const r = validateReport({
        ...base,
        lines: [{ kind: 'cash', itemName: '雑費', spec: '', unit: '', qty: null, unitPrice: null, vendor: '', amountOnly }],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toEqual(['現金の1行目：金額を入力してください']);
    }
  });

  it('空文字の時刻・数値・ID・天候は null になる', () => {
    const r = validateReport({
      ...base,
      weather: '',
      common: { start: '', end: '', breakMin: '', gapMin: null },
      lines: [{ kind: 'labor', workerId: '', workerName: ' 田中 ', time: { start: '', end: '', breakMin: '', gapMin: '' }, dailyRate: '', note: '' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.weather).toBeNull();
    expect(r.value.common).toEqual({ start: null, end: null, breakMin: null, gapMin: null });
    expect(r.value.lines[0]).toEqual({
      kind: 'labor', workerId: null, workerName: '田中', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: null, note: '',
    });
  });

  it('負の数量・燃費・休憩、不正な時刻は不可', () => {
    const lease = { kind: 'lease', itemId: null, itemName: '足場材', spec: '', unit: '式', qty: -1, unitPrice: 3500, note: '' };
    expect(validateReport({ ...base, lines: [lease] }).ok).toBe(false);
    const fuel = { kind: 'fuel', vehicleId: null, vehicleName: 'ダンプ', kmPerL: -5, distanceKm: 10, pricePerL: 170, note: '' };
    expect(validateReport({ ...base, lines: [fuel] }).ok).toBe(false);
    expect(validateReport({ ...base, common: { ...base.common, breakMin: -10 } }).ok).toBe(false);
    expect(validateReport({ ...base, common: { ...base.common, start: '24:00' } }).ok).toBe(false);
    expect(validateReport({ ...base, date: '2026-02-30' }).ok).toBe(false);
  });

  it('燃料行の走行距離が空ならその旨のエラー', () => {
    const r = validateReport({
      ...base,
      lines: [{ kind: 'fuel', vehicleId: null, vehicleName: 'ハイエース', kmPerL: 10, distanceKm: null, pricePerL: 170, note: '' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(['車両の1行目：走行距離を入力してください']);
  });
});

describe('reportWarnings（追加）', () => {
  it('リース単価が未設定なら警告し、未選択の行には日当・燃費の警告を出さない', () => {
    const w = reportWarnings({
      ...base,
      lines: [
        { kind: 'lease', itemId: null, itemName: '足場材', spec: '', unit: '式', qty: 1, unitPrice: null, note: '' },
        { kind: 'labor', workerId: null, workerName: '', time: { start: null, end: null, breakMin: null, gapMin: null }, dailyRate: null, note: '' },
        { kind: 'fuel', vehicleId: null, vehicleName: '', kmPerL: null, distanceKm: null, pricePerL: null, note: '' },
      ],
    });
    expect(w).toEqual(['リース「足場材」：単価が未設定です（リース費が0円になります）']);
  });
});
